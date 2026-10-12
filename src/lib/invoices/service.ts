import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/agency/activity';
import { computeTotals, displayStatus, formatMoney } from './money';
import { editableFields, validateInvoiceInput, validatePayment, validateSettings } from './rules';
import { renderInvoicePdf } from './pdf';
import { sendInvoiceEmail, sendInvoiceReminder, sendPaymentReceipt } from '@/lib/email/invoices';
import { notify } from '@/lib/notifications/service';
import type { InvoiceSettings } from '@/lib/types/database';

type Gate = { agencyId: string; userId: string; role: string };

function today() {
    return new Date().toISOString().slice(0, 10);
}

function mapRpcError(message: string) {
    if (message.includes('OVERPAYMENT')) return NextResponse.json({ error: 'That is more than the remaining balance.', code: 'OVERPAYMENT' }, { status: 400 });
    if (message.includes('ALREADY_PAID')) return NextResponse.json({ error: 'This invoice is already paid.', code: 'ALREADY_PAID' }, { status: 409 });
    if (message.includes('NOT_PAYABLE')) return NextResponse.json({ error: 'This invoice cannot accept payments.', code: 'NOT_PAYABLE' }, { status: 409 });
    if (message.includes('HAS_PAYMENTS')) return NextResponse.json({ error: 'Void payments first, or delete them.', code: 'HAS_PAYMENTS' }, { status: 409 });
    if (message.includes('INVOICE_LOCKED')) return NextResponse.json({ error: 'Sent invoices are locked.', code: 'INVOICE_LOCKED' }, { status: 409 });
    if (message.includes('NOT_DRAFT')) return NextResponse.json({ error: 'Only drafts can be sent.', code: 'BAD_STATE' }, { status: 409 });
    if (message.includes('NOT_SENT')) return NextResponse.json({ error: 'Only sent invoices accept this action.', code: 'BAD_STATE' }, { status: 409 });
    if (message.includes('TOTAL_ZERO') || message.includes('NO_LINES')) return NextResponse.json({ error: 'Add lines with a total above zero.', code: 'BAD_REQUEST' }, { status: 400 });
    if (message.includes('REASON_REQUIRED')) return NextResponse.json({ error: 'Add a void reason.', code: 'BAD_REQUEST' }, { status: 400 });
    if (message.includes('CLIENT_NOT_FOUND')) return NextResponse.json({ error: 'Choose an active client.', code: 'BAD_CLIENT' }, { status: 400 });
    if (message.includes('PROJECT_NOT_IN_CLIENT')) return NextResponse.json({ error: 'That project does not belong to this client.', code: 'BAD_REQUEST' }, { status: 400 });
    if (message.includes('NOT_FOUND')) return NextResponse.json({ error: 'Invoice not found.', code: 'NOT_FOUND' }, { status: 404 });
    return null;
}

export { mapRpcError };

export async function getOrCreateSettings(agencyId: string): Promise<InvoiceSettings> {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase.from('invoice_settings').select('*').eq('agency_id', agencyId).maybeSingle();
    if (data) return data as InvoiceSettings;
    const { data: created, error } = await supabase.from('invoice_settings').insert({ agency_id: agencyId }).select('*').single();
    if (error || !created) throw new Error(error?.message ?? 'Could not create invoice settings.');
    return created as InvoiceSettings;
}

export async function updateSettings(gate: Gate, body: Record<string, unknown>) {
    const current = await getOrCreateSettings(gate.agencyId);
    const parsed = validateSettings(body, current.next_number);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: 'BAD_REQUEST' }, { status: 400 });
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.from('invoice_settings').update(parsed.value).eq('agency_id', gate.agencyId).select('*').single();
    if (error) throw new Error(error.message);
    await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'invoices.settings', target: data.business_name || 'Invoice settings' });
    return NextResponse.json({ settings: data });
}

function matchesDisplay(status: string, filter: string | null) {
    if (!filter || filter === 'all') return true;
    if (filter === 'drafts') return status === 'draft';
    if (filter === 'outstanding') return status === 'sent' || status === 'viewed' || status === 'partly_paid' || status === 'overdue';
    if (filter === 'overdue') return status === 'overdue';
    if (filter === 'paid') return status === 'paid';
    if (filter === 'void') return status === 'void';
    return status === filter;
}

export async function listInvoices(
    gate: Gate,
    filters: { status?: string | null; client?: string | null; project?: string | null; q?: string | null; from?: string | null; to?: string | null }
) {
    const supabase = createServerSupabaseClient();
    let query = supabase
        .from('invoices')
        .select('*, clients(company_name), projects(name)')
        .eq('agency_id', gate.agencyId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
    if (filters.client) query = query.eq('client_id', filters.client);
    if (filters.project) query = query.eq('project_id', filters.project);
    if (filters.from) query = query.gte('issue_date', filters.from);
    if (filters.to) query = query.lte('issue_date', filters.to);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const day = today();
    const rows = (data ?? []).map((row) => {
        const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
        const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
        const display = displayStatus(row, day);
        return {
            id: row.id,
            number: row.number,
            status: row.status,
            display_status: display,
            currency: row.currency,
            issue_date: row.issue_date,
            due_date: row.due_date,
            total_minor: row.total_minor,
            paid_minor: row.paid_minor,
            balance_minor: Math.max(0, Number(row.total_minor) - Number(row.paid_minor)),
            client_id: row.client_id,
            client_name: client?.company_name ?? 'Client',
            project_id: row.project_id,
            project_name: project?.name ?? null,
            created_at: row.created_at,
        };
    }).filter((row) => {
        if (filters.q) {
            const q = filters.q.toLowerCase();
            if (!(row.number ?? '').toLowerCase().includes(q) && !row.client_name.toLowerCase().includes(q)) return false;
        }
        return matchesDisplay(row.display_status, filters.status ?? null);
    });

    const summary = new Map<string, { outstanding: number; overdue: number; paid_month: number }>();
    const monthStart = `${day.slice(0, 7)}-01`;
    for (const row of data ?? []) {
        const cur = row.currency as string;
        if (!summary.has(cur)) summary.set(cur, { outstanding: 0, overdue: 0, paid_month: 0 });
        const bucket = summary.get(cur)!;
        const display = displayStatus(row, day);
        const balance = Math.max(0, Number(row.total_minor) - Number(row.paid_minor));
        if (display === 'sent' || display === 'viewed' || display === 'partly_paid' || display === 'overdue') bucket.outstanding += balance;
        if (display === 'overdue') bucket.overdue += balance;
        if (row.status === 'paid' && row.paid_at && String(row.paid_at).slice(0, 10) >= monthStart) bucket.paid_month += Number(row.total_minor);
    }

    return {
        invoices: rows,
        summary: [...summary.entries()].map(([currency, amounts]) => ({ currency, ...amounts })),
    };
}

async function loadInvoice(agencyId: string, id: string) {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
        .from('invoices')
        .select('*, clients(company_name, website_url, industry), projects(name)')
        .eq('agency_id', agencyId)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();
    return data;
}

export async function invoiceDetail(gate: Gate, id: string) {
    const row = await loadInvoice(gate.agencyId, id);
    if (!row) return null;
    const supabase = createServerSupabaseClient();
    const [{ data: lines }, { data: payments }, { data: activity }] = await Promise.all([
        supabase.from('invoice_line_items').select('*').eq('invoice_id', id).order('position'),
        supabase.from('invoice_payments').select('*').eq('invoice_id', id).order('paid_on', { ascending: false }),
        supabase.from('agency_activity_logs').select('id, action, actor_id, target, created_at, metadata').eq('agency_id', gate.agencyId).contains('metadata', { invoice_id: id }).order('created_at', { ascending: false }).limit(40),
    ]);
    const { clients, projects, ...invoice } = row;
    const client = Array.isArray(clients) ? clients[0] : clients;
    const project = Array.isArray(projects) ? projects[0] : projects;
    return {
        invoice: {
            ...invoice,
            client_name: client?.company_name ?? 'Client',
            project_name: project?.name ?? null,
            display_status: displayStatus(row, today()),
            balance_minor: Math.max(0, Number(row.total_minor) - Number(row.paid_minor)),
        },
        lines: lines ?? [],
        payments: payments ?? [],
        activity: activity ?? [],
        settings: await getOrCreateSettings(gate.agencyId),
    };
}

function applyTotals(update: Record<string, unknown>, lines: { amount_minor: number }[], discount_kind: string | null, discount_value: number, tax_bps: number) {
    const totals = computeTotals({
        lines,
        discount: discount_kind === 'percent'
            ? { kind: 'percent', valueBps: discount_value }
            : discount_kind === 'amount'
                ? { kind: 'amount', valueMinor: discount_value }
                : null,
        taxBps: tax_bps,
    });
    update.subtotal_minor = Number(totals.subtotal);
    update.discount_minor = Number(totals.discountMinor);
    update.tax_minor = Number(totals.taxMinor);
    update.total_minor = Number(totals.total);
}

/** A project can go on an invoice only if it's a live project of that client in this agency. */
async function projectFitsClient(agencyId: string, clientId: string, projectId: string) {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase.from('projects').select('id, client_id, deleted_at').eq('agency_id', agencyId).eq('id', projectId).maybeSingle();
    return !!data && !data.deleted_at && data.client_id === clientId;
}

export async function createInvoice(gate: Gate, body: Record<string, unknown>) {
    const parsed = validateInvoiceInput(body, { create: true });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: 'BAD_REQUEST' }, { status: 400 });
    const settings = await getOrCreateSettings(gate.agencyId);
    const supabase = createServerSupabaseClient();
    const { data: client } = await supabase.from('clients').select('id, status, deleted_at').eq('agency_id', gate.agencyId).eq('id', parsed.value.client_id!).maybeSingle();
    if (!client || client.deleted_at || client.status !== 'active') {
        return NextResponse.json({ error: 'Choose an active client.', code: 'BAD_REQUEST' }, { status: 400 });
    }
    if (parsed.value.project_id && !(await projectFitsClient(gate.agencyId, parsed.value.client_id!, parsed.value.project_id))) {
        return NextResponse.json({ error: 'That project does not belong to this client.', code: 'BAD_REQUEST' }, { status: 400 });
    }
    const currency = parsed.value.currency ?? settings.default_currency;
    const tax_bps = parsed.value.tax_bps ?? settings.default_tax_bps;
    const tax_label = parsed.value.tax_label ?? settings.tax_label;
    const discount_kind = parsed.value.discount_kind ?? null;
    const discount_value = parsed.value.discount_value ?? 0;
    const lines = parsed.value.lines ?? [];
    const insert: Record<string, unknown> = {
        agency_id: gate.agencyId,
        client_id: parsed.value.client_id,
        project_id: parsed.value.project_id ?? null,
        currency,
        issue_date: parsed.value.issue_date ?? null,
        due_date: parsed.value.due_date ?? null,
        notes: parsed.value.notes ?? null,
        internal_note: parsed.value.internal_note ?? null,
        payment_link: parsed.value.payment_link ?? null,
        discount_kind,
        discount_value,
        tax_bps,
        tax_label,
        created_by: gate.userId,
        status: 'draft',
    };
    applyTotals(insert, lines, discount_kind, discount_value, tax_bps);
    const { data, error } = await supabase.from('invoices').insert(insert).select('id').single();
    if (error) {
        const mapped = mapRpcError(error.message);
        if (mapped) return mapped;
        throw new Error(error.message);
    }
    if (lines.length) {
        const { error: lineError } = await supabase.from('invoice_line_items').insert(
            lines.map((line) => ({ ...line, invoice_id: data.id, agency_id: gate.agencyId }))
        );
        if (lineError) {
            // Don't leave a draft whose totals count lines that were never saved.
            await supabase.from('invoices').delete().eq('id', data.id).eq('agency_id', gate.agencyId);
            throw new Error(lineError.message);
        }
    }
    await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'invoices.create', target: 'Draft invoice', metadata: { invoice_id: data.id } });
    return NextResponse.json({ invoice: { id: data.id } }, { status: 201 });
}

export async function updateInvoice(gate: Gate, id: string, body: Record<string, unknown>) {
    const row = await loadInvoice(gate.agencyId, id);
    if (!row) return NextResponse.json({ error: 'Invoice not found.', code: 'NOT_FOUND' }, { status: 404 });
    const allowed = editableFields(row.status);
    const parsed = validateInvoiceInput(body, { partial: true });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: 'BAD_REQUEST' }, { status: 400 });
    for (const key of Object.keys(parsed.value)) {
        if (!allowed.has(key)) return NextResponse.json({ error: 'That field is locked on this invoice.', code: 'INVOICE_LOCKED' }, { status: 409 });
    }
    // Ignore any client-sent money totals.
    const supabase = createServerSupabaseClient();
    const update: Record<string, unknown> = {};
    const nextClientId = 'client_id' in parsed.value ? parsed.value.client_id! : (row.client_id as string);
    if ('client_id' in parsed.value) {
        const { data: client } = await supabase
            .from('clients')
            .select('id, status, deleted_at')
            .eq('agency_id', gate.agencyId)
            .eq('id', parsed.value.client_id!)
            .maybeSingle();
        if (!client || client.deleted_at || client.status === 'archived') {
            return NextResponse.json({ error: 'Choose an active client.', code: 'BAD_CLIENT' }, { status: 400 });
        }
        update.client_id = parsed.value.client_id;
        // A project of the old client can't stay on the invoice.
        if (!('project_id' in parsed.value) && parsed.value.client_id !== row.client_id) update.project_id = null;
    }
    if ('project_id' in parsed.value) {
        if (parsed.value.project_id) {
            const { data: project } = await supabase
                .from('projects')
                .select('id, client_id, deleted_at')
                .eq('agency_id', gate.agencyId)
                .eq('id', parsed.value.project_id)
                .maybeSingle();
            if (!project || project.deleted_at || project.client_id !== nextClientId) {
                return NextResponse.json({ error: 'That project does not belong to this client.', code: 'BAD_REQUEST' }, { status: 400 });
            }
        }
        update.project_id = parsed.value.project_id;
    }
    if ('currency' in parsed.value) update.currency = parsed.value.currency;
    if ('issue_date' in parsed.value) update.issue_date = parsed.value.issue_date;
    if ('due_date' in parsed.value) update.due_date = parsed.value.due_date;
    if ('notes' in parsed.value) update.notes = parsed.value.notes;
    if ('internal_note' in parsed.value) update.internal_note = parsed.value.internal_note;
    if ('payment_link' in parsed.value) update.payment_link = parsed.value.payment_link;
    if ('tax_bps' in parsed.value) update.tax_bps = parsed.value.tax_bps;
    if ('tax_label' in parsed.value) update.tax_label = parsed.value.tax_label;
    if ('discount_kind' in parsed.value) update.discount_kind = parsed.value.discount_kind;
    if ('discount_value' in parsed.value) update.discount_value = parsed.value.discount_value;

    let newLines: { description: string; quantity_milli: number; unit_minor: number; amount_minor: number }[] | null = null;
    if (row.status === 'draft' && ('lines' in parsed.value || 'tax_bps' in parsed.value || 'discount_kind' in parsed.value || 'discount_value' in parsed.value)) {
        let lines = parsed.value.lines;
        if (lines) {
            newLines = lines.map((line) => ({
                description: line.description,
                quantity_milli: line.quantity_milli,
                unit_minor: line.unit_minor,
                amount_minor: line.amount_minor,
            }));
        } else {
            const { data } = await supabase.from('invoice_line_items').select('amount_minor').eq('invoice_id', id).order('position');
            lines = (data ?? []).map((line, position) => ({ description: '', quantity_milli: 1000, unit_minor: 0, amount_minor: line.amount_minor, position }));
        }
        applyTotals(
            update,
            lines,
            ('discount_kind' in parsed.value ? parsed.value.discount_kind : row.discount_kind) as string | null,
            ('discount_value' in parsed.value ? parsed.value.discount_value : row.discount_value) as number,
            ('tax_bps' in parsed.value ? parsed.value.tax_bps : row.tax_bps) as number
        );
    }

    if (!Object.keys(update).length && !newLines) return NextResponse.json({ error: 'Nothing to update.', code: 'BAD_REQUEST' }, { status: 400 });

    let data: { id: string; status: string; total_minor: number; due_date: string | null } | null = null;
    if (row.status === 'draft') {
        // Lines, fields and totals in one transaction (migration 045).
        const saved = await supabase.rpc('save_invoice_draft', { p_invoice: id, p_agency: gate.agencyId, p_lines: newLines, p_fields: update });
        if (saved.error) {
            const mapped = mapRpcError(saved.error.message);
            if (mapped) return mapped;
            throw new Error(saved.error.message);
        }
        data = saved.data as typeof data;
    } else {
        // Sent invoices: only the fields editableFields() allows. The stored PDF no longer
        // matches, so drop it; the next download regenerates it with the new details.
        if (row.pdf_path) update.pdf_path = null;
        const result = await supabase.from('invoices').update(update).eq('id', id).eq('agency_id', gate.agencyId).select('id, status, total_minor, due_date').single();
        if (result.error) {
            const mapped = mapRpcError(result.error.message);
            if (mapped) return mapped;
            throw new Error(result.error.message);
        }
        data = result.data;
        if (row.pdf_path) await supabase.storage.from('invoices').remove([row.pdf_path as string]);
    }
    await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'invoices.update', target: row.number ?? 'Draft', metadata: { invoice_id: id } });
    return NextResponse.json({ invoice: data });
}

export async function deleteInvoice(gate: Gate, id: string) {
    const row = await loadInvoice(gate.agencyId, id);
    if (!row) return NextResponse.json({ error: 'Invoice not found.', code: 'NOT_FOUND' }, { status: 404 });
    if (row.status !== 'draft') return NextResponse.json({ error: 'Only drafts can be deleted. Void sent invoices instead.', code: 'BAD_STATE' }, { status: 409 });
    const supabase = createServerSupabaseClient();
    const { error } = await supabase.from('invoices').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('agency_id', gate.agencyId);
    if (error) throw new Error(error.message);
    await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'invoices.delete', target: 'Draft', metadata: { invoice_id: id } });
    return NextResponse.json({ ok: true });
}

async function agencyBrand(agencyId: string) {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase.from('agencies').select('name, slug, logo_url, theme_primary_color').eq('id', agencyId).maybeSingle();
    return data;
}

async function recipientEmails(clientId: string) {
    const supabase = createServerSupabaseClient();
    const { data: contacts } = await supabase.from('client_contacts').select('email, portal_status, is_primary').eq('client_id', clientId);
    const active = (contacts ?? []).filter((c) => c.portal_status === 'active' && c.email).map((c) => c.email as string);
    if (active.length) return [...new Set(active)];
    const primary = (contacts ?? []).find((c) => c.is_primary && c.email)?.email;
    return primary ? [primary] : [];
}

async function recipientUserIds(clientId: string) {
    const supabase = createServerSupabaseClient();
    const { data: contacts } = await supabase
        .from('client_contacts')
        .select('user_id')
        .eq('client_id', clientId)
        .eq('portal_status', 'active');
    return (contacts ?? []).map((c) => c.user_id).filter((id): id is string => !!id);
}

async function agencyAdminIds(agencyId: string) {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
        .from('agency_members')
        .select('user_id')
        .eq('agency_id', agencyId)
        .eq('role', 'admin')
        .eq('status', 'active');
    return (data ?? []).map((r) => r.user_id as string);
}

export async function sendInvoice(gate: Gate, id: string) {
    const detail = await invoiceDetail(gate, id);
    if (!detail) return NextResponse.json({ error: 'Invoice not found.', code: 'NOT_FOUND' }, { status: 404 });
    if (detail.invoice.status !== 'draft') return NextResponse.json({ error: 'Only drafts can be sent.', code: 'BAD_STATE' }, { status: 409 });
    if (!detail.lines.length || Number(detail.invoice.total_minor) <= 0) {
        return NextResponse.json({ error: 'Add lines with a total above zero.', code: 'BAD_REQUEST' }, { status: 400 });
    }
    const settings = detail.settings;
    if (!settings.business_name?.trim()) {
        return NextResponse.json({ error: 'Add your business name in invoice settings before sending.', code: 'SETTINGS_INCOMPLETE' }, { status: 400 });
    }
    const brand = await agencyBrand(gate.agencyId);
    const bill_to = { name: detail.invoice.client_name, email: null as string | null };
    const from_details = {
        name: settings.business_name,
        address: settings.business_address,
        tax_id: settings.tax_id,
        payment_instructions: settings.payment_instructions,
        footer_note: settings.footer_note,
    };
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.rpc('send_invoice', {
        p_invoice: id,
        p_actor: gate.userId,
        p_bill_to: bill_to,
        p_from_details: from_details,
    });
    if (error) {
        const mapped = mapRpcError(error.message);
        if (mapped) return mapped;
        throw new Error(error.message);
    }
    const sent = data as { number: string; issue_date: string; due_date: string };
    let pdf_stored = false;
    let email_sent = false;
    try {
        const pdf = await renderInvoicePdf({
            agency: brand ?? { name: settings.business_name, logo_url: null, theme_primary_color: null },
            number: sent.number,
            currency: detail.invoice.currency,
            issue_date: sent.issue_date,
            due_date: sent.due_date,
            from: from_details,
            bill_to: { name: detail.invoice.client_name },
            lines: detail.lines,
            subtotal_minor: detail.invoice.subtotal_minor,
            discount_minor: detail.invoice.discount_minor,
            tax_label: detail.invoice.tax_label,
            tax_minor: detail.invoice.tax_minor,
            total_minor: detail.invoice.total_minor,
            notes: detail.invoice.notes,
            payment_instructions: settings.payment_instructions,
            payment_link: detail.invoice.payment_link,
            footer_note: settings.footer_note,
        });
        const path = `agencies/${gate.agencyId}/invoices/${id}/${sent.number}.pdf`;
        const uploaded = await supabase.storage.from('invoices').upload(path, pdf, { contentType: 'application/pdf', upsert: true });
        if (!uploaded.error) {
            await supabase.from('invoices').update({ pdf_path: path }).eq('id', id).eq('agency_id', gate.agencyId);
            pdf_stored = true;
        } else {
            console.error('[invoices] pdf upload failed:', uploaded.error.message);
        }
        const to = await recipientEmails(detail.invoice.client_id);
        email_sent = to.length > 0 && await sendInvoiceEmail({
            to,
            agency: brand ?? { name: settings.business_name, slug: '', logo_url: null, theme_primary_color: null },
            number: sent.number,
            totalMinor: detail.invoice.total_minor,
            currency: detail.invoice.currency,
            dueDate: sent.due_date,
            invoiceId: id,
            pdf,
        });
    } catch (err) {
        console.error('[invoices] post-send pdf/email failed:', err);
    }
    await notify({
        agencyId: gate.agencyId,
        kind: 'invoice.sent',
        actorId: gate.userId,
        entity: { type: 'invoice', id },
        recipients: await recipientUserIds(detail.invoice.client_id),
        vars: { number: sent.number, entityId: id, entityTitle: sent.number },
    });
    await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'invoices.send', target: sent.number, metadata: { invoice_id: id } });
    return NextResponse.json({
        ok: true,
        invoice: { id, number: sent.number, status: 'sent', issue_date: sent.issue_date, due_date: sent.due_date },
        pdf_stored,
        email_sent,
    });
}

export async function resendInvoice(gate: Gate, id: string) {
    const detail = await invoiceDetail(gate, id);
    if (!detail || detail.invoice.status === 'draft' || detail.invoice.status === 'void') {
        return NextResponse.json({ error: 'Invoice not found.', code: 'NOT_FOUND' }, { status: 404 });
    }
    const supabase = createServerSupabaseClient();
    const day = today();
    const { count } = await supabase
        .from('agency_activity_logs')
        .select('id', { count: 'exact', head: true })
        .eq('agency_id', gate.agencyId)
        .eq('action', 'invoices.resend')
        .gte('created_at', `${day}T00:00:00.000Z`)
        .contains('metadata', { invoice_id: id });
    if ((count ?? 0) >= 5) return NextResponse.json({ error: 'Resend limit reached for today.', code: 'RATE_LIMIT' }, { status: 429 });

    let pdfBytes: Uint8Array;
    if (detail.invoice.pdf_path) {
        const downloaded = await supabase.storage.from('invoices').download(detail.invoice.pdf_path);
        if (downloaded.error || !downloaded.data) return NextResponse.json({ error: 'Could not load the PDF.', code: 'PDF_MISSING' }, { status: 500 });
        pdfBytes = new Uint8Array(await downloaded.data.arrayBuffer());
    } else {
        const regenerated = await regeneratePdf(gate.agencyId, detail);
        pdfBytes = regenerated;
    }
    const brand = await agencyBrand(gate.agencyId);
    const to = await recipientEmails(detail.invoice.client_id);
    await sendInvoiceEmail({
        to,
        agency: brand ?? { name: 'Agency', slug: '', logo_url: null, theme_primary_color: null },
        number: detail.invoice.number!,
        totalMinor: detail.invoice.total_minor,
        currency: detail.invoice.currency,
        dueDate: detail.invoice.due_date,
        invoiceId: id,
        pdf: pdfBytes,
    });
    await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'invoices.resend', target: detail.invoice.number, metadata: { invoice_id: id } });
    return NextResponse.json({ ok: true });
}

async function regeneratePdf(agencyId: string, detail: NonNullable<Awaited<ReturnType<typeof invoiceDetail>>>) {
    const settings = detail.settings;
    const brand = await agencyBrand(agencyId);
    const from = (detail.invoice.from_details as { name?: string; address?: string; tax_id?: string; payment_instructions?: string; footer_note?: string } | null) ?? {
        name: settings.business_name,
        address: settings.business_address,
        tax_id: settings.tax_id,
        payment_instructions: settings.payment_instructions,
        footer_note: settings.footer_note,
    };
    const pdf = await renderInvoicePdf({
        draft: detail.invoice.status === 'draft',
        agency: brand ?? { name: from.name ?? 'Agency', logo_url: null, theme_primary_color: null },
        number: detail.invoice.number,
        currency: detail.invoice.currency,
        issue_date: detail.invoice.issue_date,
        due_date: detail.invoice.due_date,
        from: { name: from.name ?? 'Agency', address: from.address, tax_id: from.tax_id },
        bill_to: { name: detail.invoice.client_name },
        lines: detail.lines,
        subtotal_minor: detail.invoice.subtotal_minor,
        discount_minor: detail.invoice.discount_minor,
        tax_label: detail.invoice.tax_label,
        tax_minor: detail.invoice.tax_minor,
        total_minor: detail.invoice.total_minor,
        paid_minor: detail.invoice.paid_minor,
        notes: detail.invoice.notes,
        payment_instructions: from.payment_instructions ?? settings.payment_instructions,
        payment_link: detail.invoice.payment_link,
        footer_note: from.footer_note ?? settings.footer_note,
    });
    if (detail.invoice.status !== 'draft' && detail.invoice.number) {
        const supabase = createServerSupabaseClient();
        const path = `agencies/${agencyId}/invoices/${detail.invoice.id}/${detail.invoice.number}.pdf`;
        const uploaded = await supabase.storage.from('invoices').upload(path, pdf, { contentType: 'application/pdf', upsert: true });
        // Only point at the stored copy if it was actually stored; otherwise just serve these bytes.
        if (!uploaded.error) await supabase.from('invoices').update({ pdf_path: path }).eq('id', detail.invoice.id).eq('agency_id', agencyId);
        else console.error('[invoices] storing PDF failed:', uploaded.error.message);
    }
    return pdf;
}

/** PDF bytes for a sent invoice whose stored copy is missing (portal use; the caller has already checked access). */
export async function regenerateSentPdf(agencyId: string, id: string) {
    const detail = await invoiceDetail({ agencyId, userId: '', role: 'admin' }, id);
    if (!detail || detail.invoice.status === 'draft') return null;
    return { bytes: await regeneratePdf(agencyId, detail), number: detail.invoice.number };
}

export async function invoicePdfResponse(gate: Gate, id: string) {
    const detail = await invoiceDetail(gate, id);
    if (!detail) return NextResponse.json({ error: 'Invoice not found.', code: 'NOT_FOUND' }, { status: 404 });
    if (detail.invoice.status === 'draft' || !detail.invoice.pdf_path) {
        const bytes = await regeneratePdf(gate.agencyId, detail);
        return new NextResponse(Buffer.from(bytes), {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${detail.invoice.number ?? 'draft'}.pdf"`,
            },
        });
    }
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.storage.from('invoices').createSignedUrl(detail.invoice.pdf_path, 60);
    if (error || !data?.signedUrl) {
        const bytes = await regeneratePdf(gate.agencyId, detail);
        return new NextResponse(Buffer.from(bytes), {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="${detail.invoice.number}.pdf"`,
            },
        });
    }
    return NextResponse.redirect(data.signedUrl, 302);
}

export async function recordPayment(gate: Gate, id: string, body: Record<string, unknown>) {
    const row = await loadInvoice(gate.agencyId, id);
    if (!row) return NextResponse.json({ error: 'Invoice not found.', code: 'NOT_FOUND' }, { status: 404 });
    const remaining = Math.max(0, Number(row.total_minor) - Number(row.paid_minor));
    const parsed = validatePayment(body, remaining);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: 'BAD_REQUEST' }, { status: 400 });
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.rpc('record_payment', {
        p_invoice: id,
        p_amount: parsed.value.amount_minor,
        p_paid_on: parsed.value.paid_on,
        p_method: parsed.value.method,
        p_reference: parsed.value.reference,
        p_note: parsed.value.note,
        p_actor: gate.userId,
    });
    if (error) {
        const mapped = mapRpcError(error.message);
        if (mapped) return mapped;
        throw new Error(error.message);
    }
    await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'invoices.payment', target: row.number, metadata: { invoice_id: id, amount_minor: parsed.value.amount_minor } });
    const paidRecipients = [...new Set([row.sent_by, row.created_by, ...(await agencyAdminIds(gate.agencyId))].filter((x): x is string => !!x))];
    const payment = data as { paid_minor?: number; status?: string } | null;
    if (payment?.status === 'paid' || (payment && Number(payment.paid_minor) >= Number(row.total_minor))) {
        await notify({
            agencyId: gate.agencyId,
            kind: 'invoice.paid',
            actorId: gate.userId,
            entity: { type: 'invoice', id },
            recipients: paidRecipients,
            vars: { number: row.number ?? '', entityId: id },
        });
    }
    if (body.send_receipt !== false) {
        const brand = await agencyBrand(gate.agencyId);
        const to = await recipientEmails(row.client_id);
        await sendPaymentReceipt({
            to,
            agency: brand ?? { name: 'Agency', slug: '', logo_url: null, theme_primary_color: null },
            number: row.number!,
            amountMinor: parsed.value.amount_minor,
            currency: row.currency,
            invoiceId: id,
        });
    }
    return NextResponse.json({ payment: data });
}

export async function deletePayment(gate: Gate, invoiceId: string, paymentId: string) {
    const row = await loadInvoice(gate.agencyId, invoiceId);
    if (!row) return NextResponse.json({ error: 'Invoice not found.', code: 'NOT_FOUND' }, { status: 404 });
    const supabase = createServerSupabaseClient();
    const { data: payment } = await supabase
        .from('invoice_payments')
        .select('id')
        .eq('id', paymentId)
        .eq('invoice_id', invoiceId)
        .eq('agency_id', gate.agencyId)
        .maybeSingle();
    if (!payment) return NextResponse.json({ error: 'Payment not found.', code: 'NOT_FOUND' }, { status: 404 });
    const { data, error } = await supabase.rpc('delete_payment', { p_payment: paymentId, p_actor: gate.userId });
    if (error) {
        const mapped = mapRpcError(error.message);
        if (mapped) return mapped;
        throw new Error(error.message);
    }
    await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'invoices.payment_delete', target: paymentId, metadata: { invoice_id: invoiceId } });
    return NextResponse.json({ payment: data });
}

export async function voidInvoice(gate: Gate, id: string, body: Record<string, unknown>) {
    const row = await loadInvoice(gate.agencyId, id);
    if (!row) return NextResponse.json({ error: 'Invoice not found.', code: 'NOT_FOUND' }, { status: 404 });
    const reason = typeof body.reason === 'string' ? body.reason : '';
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase.rpc('void_invoice', { p_invoice: id, p_reason: reason, p_actor: gate.userId });
    if (error) {
        const mapped = mapRpcError(error.message);
        if (mapped) return mapped;
        throw new Error(error.message);
    }
    await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'invoices.void', target: row.number ?? id, metadata: { invoice_id: id } });
    return NextResponse.json({ invoice: data });
}

export async function duplicateInvoice(gate: Gate, id: string) {
    const detail = await invoiceDetail(gate, id);
    if (!detail) return NextResponse.json({ error: 'Invoice not found.', code: 'NOT_FOUND' }, { status: 404 });
    // Keep the project only if it's still a live project of the same client.
    const projectId = detail.invoice.project_id && (await projectFitsClient(gate.agencyId, detail.invoice.client_id, detail.invoice.project_id))
        ? detail.invoice.project_id
        : null;
    const created = await createInvoice(gate, {
        client_id: detail.invoice.client_id,
        project_id: projectId,
        currency: detail.invoice.currency,
        notes: detail.invoice.notes,
        tax_bps: detail.invoice.tax_bps,
        tax_label: detail.invoice.tax_label,
        discount_kind: detail.invoice.discount_kind,
        discount_value: detail.invoice.discount_value,
        lines: detail.lines.map((line) => ({
            description: line.description,
            quantity_milli: line.quantity_milli,
            unit_minor: line.unit_minor,
        })),
    });
    if (created.status !== 201) return created;
    const body = await created.json();
    const supabase = createServerSupabaseClient();
    await supabase.from('invoices').update({ duplicated_from: id }).eq('id', body.invoice.id);
    await logActivity({ agencyId: gate.agencyId, actorId: gate.userId, action: 'invoices.duplicate', target: detail.invoice.number ?? id, metadata: { invoice_id: body.invoice.id, from: id } });
    return NextResponse.json({ invoice: body.invoice }, { status: 201 });
}

export async function overdueForDashboard(agencyId: string, limit = 5) {
    const { invoices } = await listInvoices({ agencyId, userId: '', role: 'admin' }, { status: 'overdue' });
    return invoices
        .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
        .slice(0, limit);
}

function shiftDay(isoDay: string, days: number) {
    const d = new Date(`${isoDay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export async function runInvoiceReminders() {
    const supabase = createServerSupabaseClient();
    const day = today();
    const overdueDay = new Date();
    overdueDay.setUTCDate(overdueDay.getUTCDate() - 7);
    const overdue = overdueDay.toISOString().slice(0, 10);
    // Windows rather than exact days, so a reminder whose email failed is retried on the next run.
    const dueFrom = shiftDay(day, -6);
    const overdueFrom = shiftDay(day, -30);
    const { getEntitlements } = await import('@/lib/access/entitlements');
    const { accessMode } = await import('@/lib/access/modes');

    const { data: settingsRows } = await supabase.from('invoice_settings').select('agency_id').eq('reminders_enabled', true);
    const eligible: string[] = [];
    for (const settings of settingsRows ?? []) {
        const ent = await getEntitlements(settings.agency_id);
        if (!ent || ent.features.invoices !== true) continue;
        const mode = accessMode(ent);
        if (mode !== 'full' && mode !== 'grace') continue;
        eligible.push(settings.agency_id);
    }
    if (!eligible.length) return { sent: 0 };

    // Filter by stage in the query, so older open invoices can't crowd today's reminders out of the batch.
    const columns = 'id, number, total_minor, paid_minor, currency, due_date, last_reminder, client_id, agency_id';
    const [dueToday, overdueWeek] = await Promise.all([
        supabase.from('invoices').select(columns).in('agency_id', eligible).eq('status', 'sent').is('deleted_at', null)
            .gte('due_date', dueFrom).lte('due_date', day).is('last_reminder', null).order('due_date').limit(200),
        supabase.from('invoices').select(columns).in('agency_id', eligible).eq('status', 'sent').is('deleted_at', null)
            .gte('due_date', overdueFrom).lte('due_date', overdue).or('last_reminder.is.null,last_reminder.eq.due').order('due_date').limit(200),
    ]);
    const batch = [
        ...(dueToday.data ?? []).map((inv) => ({ inv, stage: 'due' as const })),
        ...(overdueWeek.data ?? []).map((inv) => ({ inv, stage: 'overdue_7' as const })),
    ].slice(0, 200);

    let sent = 0;
    for (const { inv, stage } of batch) {
        if (Number(inv.paid_minor) >= Number(inv.total_minor)) continue;
        const brand = await agencyBrand(inv.agency_id);
        const to = await recipientEmails(inv.client_id);
        if (!to.length) continue;
        const balance = Math.max(0, Number(inv.total_minor) - Number(inv.paid_minor));
        // Claim the reminder first so an overlapping run can't email the same invoice twice.
        const previous = (inv.last_reminder as string | null) ?? null;
        let claim = supabase.from('invoices').update({ last_reminder: stage }).eq('id', inv.id).eq('agency_id', inv.agency_id);
        claim = previous === null ? claim.is('last_reminder', null) : claim.eq('last_reminder', previous);
        const { data: claimed } = await claim.select('id');
        if (!claimed?.length) continue;
        const delivered = await sendInvoiceReminder({
            to,
            agency: brand ?? { name: 'Agency', slug: '', logo_url: null, theme_primary_color: null },
            number: inv.number!,
            totalMinor: balance,
            currency: inv.currency,
            dueDate: inv.due_date,
            invoiceId: inv.id,
            stage,
        });
        // Only a delivered email counts; release the claim so a failed one is retried on the next run.
        if (!delivered) {
            await supabase.from('invoices').update({ last_reminder: previous }).eq('id', inv.id).eq('agency_id', inv.agency_id).eq('last_reminder', stage);
            continue;
        }
        sent += 1;
    }
    return { sent };
}

export { formatMoney };
