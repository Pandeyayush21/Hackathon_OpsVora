// ============================================
// Vora Database Types
// Source of truth: /docs/DATA_MODELS.md
// ============================================

// ---- Agency Invites (Super-Admin) ----

export type InviteStatus = 'pending' | 'claimed' | 'expired' | 'revoked';

export interface AgencyInvite {
    id: string;
    token: string;
    agency_name: string;
    founder_email: string;
    is_used: boolean;
    is_revoked: boolean;
    expires_at: string;
    created_at: string;
    plan_id?: string | null;
    plans?: { id: string; key: string; name: string } | null;
}

// Computed status based on business logic
export function getInviteStatus(invite: AgencyInvite): InviteStatus {
    if (invite.is_revoked) return 'revoked';
    if (invite.is_used) return 'claimed';
    if (new Date(invite.expires_at) < new Date()) return 'expired';
    return 'pending';
}

// ---- Team Member Invites ----

export type TeamInviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export type TeamRole = 'admin' | 'manager' | 'creator';

export interface TeamMemberInvite {
    id: string;
    token: string;
    agency_id: string;
    email: string;
    role: TeamRole;
    invited_by: string;
    is_used: boolean;
    is_revoked: boolean;
    expires_at: string;
    created_at: string;
}

export function getTeamInviteStatus(invite: TeamMemberInvite): TeamInviteStatus {
    if (invite.is_revoked) return 'revoked';
    if (invite.is_used) return 'accepted';
    if (new Date(invite.expires_at) < new Date()) return 'expired';
    return 'pending';
}

// ---- Team Member (joined profile + user email) ----

export interface TeamMember {
    id: string;
    full_name: string;
    avatar_url: string | null;
    role: UserRole;
    email: string;
    updated_at: string;
}

// ---- Agency ----

export interface Agency {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    theme_primary_color: string | null;
    payment_instructions: string | null;
    created_at: string;
    plan_id: string;
    is_suspended: boolean;
    subscription_status: SubscriptionStatus;
    current_period_end: string | null;
}

// ---- Plans, registry & RBAC (migration 029; see src/lib/registry/catalog.ts) ----

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface Plan {
    id: string;
    key: string;
    name: string;
    description: string | null;
    price_monthly_cents: number;
    price_yearly_cents: number;
    currency: string;
    trial_days: number;
    is_public: boolean;
    is_archived: boolean;
    is_default: boolean;
    sort_order: number;
    created_at: string;
    updated_at: string;
}

export interface FeatureRecord {
    key: string;
    name: string;
    description: string | null;
    category: string;
    portals: string[];
    status: 'available' | 'beta' | 'coming_soon' | 'deprecated';
    is_core: boolean;
    sort_order: number;
}

export interface PermissionRecord {
    key: string;
    feature_key: string;
    label: string;
    description: string | null;
}

export interface RoleRecord {
    key: UserRole;
    name: string;
    description: string | null;
    portal: 'agency' | 'team' | 'client';
}

export type { Entitlements } from '@/lib/access/resolve';

// ---- Profiles ----

export type UserRole = 'admin' | 'manager' | 'creator' | 'client';

export interface Profile {
    id: string;
    agency_id: string;
    full_name: string;
    avatar_url: string | null;
    role: UserRole;
    updated_at: string;
}

// ---- Clients ----

export type OnboardingStatus = 'pending' | 'in_progress' | 'completed';

export type ClientStatus = 'active' | 'archived';
export type PortalAccessStatus = 'none' | 'invited' | 'active' | 'disabled';

export interface Client {
    id: string;
    agency_id: string;
    company_name: string;
    contact_email: string | null;
    logo_url: string | null;
    onboarding_status: OnboardingStatus;
    social_links: Record<string, string> | null;
    phone: string | null;
    notes: string | null;
    tags: string[];
    website_url: string | null;
    industry: string | null;
    status: ClientStatus;
    owner_id: string | null;
    created_by: string | null;
    archived_at: string | null;
    updated_at: string;
    deleted_at: string | null;
    created_at: string;
}

export interface ClientContact {
    id: string;
    agency_id: string;
    client_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    title: string | null;
    is_primary: boolean;
    user_id: string | null;
    portal_status: PortalAccessStatus;
    created_at: string;
    updated_at: string;
}

export interface ClientPortalInvite {
    id: string;
    token: string;
    agency_id: string;
    client_id: string;
    contact_id: string;
    email: string;
    invited_by: string | null;
    expires_at: string;
    is_used: boolean;
    is_revoked: boolean;
    accepted_by: string | null;
    accepted_at: string | null;
    created_at: string;
}

export interface ClientCreateInput {
    company_name: string;
    contact_email?: string;
    phone?: string;
    notes?: string;
    tags?: string[];
    onboarding_status?: OnboardingStatus;
    logo_url?: string;
    social_links?: Record<string, string>;
}

export type ClientUpdateInput = Partial<ClientCreateInput>;

// ---- Projects ----

export type ProjectStatus = 'draft' | 'active' | 'on_hold' | 'completed' | 'cancelled';
export type ProjectPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Project {
    id: string;
    agency_id: string;
    client_id: string;
    name: string;
    description: string | null;
    client_summary: string | null;
    status: ProjectStatus;
    priority: ProjectPriority;
    start_date: string | null;
    due_date: string | null;
    color: string | null;
    owner_id: string | null;
    created_by: string | null;
    created_at: string;
    completed_at: string | null;
    updated_at: string;
    deleted_at: string | null;
    client_name?: string;
}

export interface ProjectMember {
    project_id: string;
    user_id: string;
    agency_id: string;
    added_by: string | null;
    created_at: string;
}

export interface ProjectCreateInput {
    name: string;
    client_id: string;
    description?: string;
    status?: ProjectStatus;
    priority?: ProjectPriority;
    start_date?: string;
    due_date?: string;
    color?: string;
}

export type ProjectUpdateInput = Partial<ProjectCreateInput>;

// ---- Tasks ----

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
    id: string;
    agency_id: string;
    client_id: string;
    project_id: string;
    assigned_spoc_id: string | null;
    created_by: string | null;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    labels: string[];
    position: number;
    parent_task_id: string | null;
    is_visible_to_client: boolean;
    due_date: string | null;
    created_at: string;
    completed_at: string | null;
    updated_at: string;
    deleted_at: string | null;
    assignee_name?: string;
}

export interface TaskCreateInput {
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    labels?: string[];
    assigned_spoc_id?: string;
    due_date?: string;
    is_visible_to_client?: boolean;
    parent_task_id?: string;
}

export type TaskUpdateInput = Partial<TaskCreateInput> & {
    position?: number;
};

// ---- Deliverables ----

export type DeliverableStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'cancelled';

export type DeliverableEventKind =
    | 'created'
    | 'version_added'
    | 'sent'
    | 'viewed'
    | 'approved'
    | 'changes_requested'
    | 'reopened'
    | 'cancelled';

export type DeliverableActorKind = 'staff' | 'client' | 'staff_for_client';

export interface DeliverableLink {
    url: string;
    label: string;
}

export interface Deliverable {
    id: string;
    agency_id: string;
    client_id: string;
    project_id: string;
    task_id: string | null;
    title: string;
    status: DeliverableStatus;
    current_version: number;
    due_date: string | null;
    created_by: string | null;
    submitted_at: string | null;
    decided_at: string | null;
    approved_at: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
}

export interface DeliverableVersion {
    id: string;
    deliverable_id: string;
    agency_id: string;
    version: number;
    note: string | null;
    links: DeliverableLink[];
    created_by: string | null;
    sent_at: string | null;
    sent_by: string | null;
    client_viewed_at: string | null;
    created_at: string;
}

export interface DeliverableFile {
    id: string;
    version_id: string;
    deliverable_id: string;
    agency_id: string;
    storage_path: string;
    file_name: string;
    mime_type: string | null;
    size_bytes: number;
    status: 'pending' | 'ready';
    uploaded_by: string | null;
    created_at: string;
}

export interface DeliverableEvent {
    id: string;
    deliverable_id: string;
    agency_id: string;
    version: number | null;
    kind: DeliverableEventKind;
    actor_id: string | null;
    actor_kind: DeliverableActorKind;
    comment: string | null;
    created_at: string;
}

// ---- Documents ----

export type DocumentCategory = 'contract' | 'brief' | 'brand' | 'report' | 'notes' | 'asset' | 'other' | 'from_client';
export type DocumentVisibility = 'internal' | 'client';

export interface Document {
    id: string;
    agency_id: string;
    client_id: string;
    project_id: string | null;
    name: string;
    description: string | null;
    category: DocumentCategory;
    visibility: DocumentVisibility;
    current_version: number;
    uploaded_by: string | null;
    uploaded_by_kind: 'staff' | 'client';
    file_url: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
}

export interface DocumentFile {
    id: string;
    document_id: string;
    agency_id: string;
    version: number;
    storage_path: string;
    file_name: string;
    mime_type: string | null;
    size_bytes: number;
    status: 'pending' | 'ready';
    uploaded_by: string | null;
    created_at: string;
}

// ---- Invoices ----

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';
export type InvoiceDisplayStatus = 'draft' | 'sent' | 'viewed' | 'partly_paid' | 'overdue' | 'paid' | 'void';
export type InvoiceDiscountKind = 'percent' | 'amount';
export type InvoicePaymentMethod = 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'other';
export type InvoiceReminderStage = 'due' | 'overdue_7';

export interface InvoiceSettings {
    agency_id: string;
    business_name: string;
    business_address: string;
    tax_id: string;
    default_currency: string;
    default_tax_bps: number;
    tax_label: string;
    default_terms_days: number;
    number_prefix: string;
    next_number: number;
    payment_instructions: string;
    footer_note: string;
    reminders_enabled: boolean;
    updated_at: string;
}

export interface Invoice {
    id: string;
    agency_id: string;
    client_id: string;
    project_id: string | null;
    number: string | null;
    status: InvoiceStatus;
    currency: string;
    issue_date: string | null;
    due_date: string | null;
    subtotal_minor: number;
    discount_kind: InvoiceDiscountKind | null;
    discount_value: number;
    discount_minor: number;
    tax_bps: number;
    tax_label: string;
    tax_minor: number;
    total_minor: number;
    paid_minor: number;
    notes: string | null;
    internal_note: string | null;
    payment_link: string | null;
    bill_to: Record<string, unknown> | null;
    from_details: Record<string, unknown> | null;
    pdf_path: string | null;
    sent_at: string | null;
    sent_by: string | null;
    viewed_at: string | null;
    paid_at: string | null;
    voided_at: string | null;
    void_reason: string | null;
    duplicated_from: string | null;
    last_reminder: InvoiceReminderStage | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
}

export interface InvoiceLine {
    id: string;
    invoice_id: string;
    agency_id: string;
    description: string;
    quantity_milli: number;
    unit_minor: number;
    amount_minor: number;
    position: number;
    created_at: string;
}

export interface InvoicePayment {
    id: string;
    invoice_id: string;
    agency_id: string;
    amount_minor: number;
    paid_on: string;
    method: InvoicePaymentMethod;
    reference: string | null;
    note: string | null;
    recorded_by: string | null;
    created_at: string;
}

// ---- Agreements (e-signature) ----

export type AgreementKind = 'offer_letter' | 'client_contract' | 'nda' | 'policy' | 'other';
export type AgreementStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'declined' | 'voided' | 'expired';
export type RecipientKind = 'candidate' | 'team_member' | 'client_contact';
export type AgreementSource = 'template' | 'upload';
export type AgreementFieldType = 'text' | 'date' | 'money' | 'number';
export type AgreementActorKind = 'staff' | 'recipient' | 'system';
export type SignatureMethod = 'drawn' | 'typed';

export type AgreementEventKind =
    | 'created'
    | 'sent'
    | 'resent'
    | 'email_failed'
    | 'viewed'
    | 'code_sent'
    | 'code_verified'
    | 'signed'
    | 'declined'
    | 'voided'
    | 'expired'
    | 'sealed'
    | 'downloaded';

export interface AgreementTemplateField {
    key: string;
    label: string;
    type: AgreementFieldType;
    required: boolean;
}

export interface AgreementTemplate {
    id: string;
    agency_id: string;
    name: string;
    kind: AgreementKind;
    title: string;
    body: string;
    fields: AgreementTemplateField[];
    created_by: string | null;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface Agreement {
    id: string;
    agency_id: string;
    reference: string;
    kind: AgreementKind;
    title: string;
    status: AgreementStatus;
    recipient_kind: RecipientKind;
    recipient_name: string;
    recipient_email: string;
    recipient_user_id: string | null;
    client_id: string | null;
    contact_id: string | null;
    team_invite_id: string | null;
    template_id: string | null;
    merge_values: Record<string, string>;
    source: AgreementSource;
    source_path: string | null;
    source_hash: string | null;
    source_bytes: number;
    sealed_path: string | null;
    sealed_hash: string | null;
    sealed_bytes: number;
    gate_portal: boolean;
    require_code: boolean;
    agency_signer_id: string | null;
    agency_signer_name: string | null;
    agency_signer_title: string | null;
    agency_signed_at: string | null;
    expires_at: string | null;
    sent_at: string | null;
    sent_by: string | null;
    viewed_at: string | null;
    signed_at: string | null;
    declined_at: string | null;
    decline_reason: string | null;
    voided_at: string | null;
    void_reason: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
}

export interface AgreementSignature {
    agreement_id: string;
    agency_id: string;
    signer_user_id: string;
    signer_email: string;
    typed_name: string;
    method: SignatureMethod;
    image_path: string | null;
    consent_text: string;
    document_hash: string;
    ip: string | null;
    user_agent: string | null;
    code_verified: boolean;
    signed_at: string;
}

export interface AgreementEvent {
    id: string;
    agreement_id: string;
    agency_id: string;
    kind: AgreementEventKind;
    actor_id: string | null;
    actor_kind: AgreementActorKind;
    ip: string | null;
    user_agent: string | null;
    detail: Record<string, unknown> | null;
    created_at: string;
}

// ---- Comments + Notifications ----

export type CommentEntityType = 'task' | 'deliverable' | 'document' | 'invoice' | 'project';
export type CommentAuthorKind = 'staff' | 'client';
export type CommentVisibility = 'internal' | 'client';

export interface Comment {
    id: string;
    agency_id: string;
    entity_type: CommentEntityType;
    entity_id: string;
    client_id: string | null;
    project_id: string | null;
    parent_id: string | null;
    author_id: string | null;
    author_kind: CommentAuthorKind;
    visibility: CommentVisibility;
    body: string;
    mentions: string[];
    edited_at: string | null;
    deleted_at: string | null;
    deleted_by: string | null;
    created_at: string;
}

export type NotificationCategory =
    | 'assignment'
    | 'mention'
    | 'comment'
    | 'review'
    | 'client_activity'
    | 'billing'
    | 'team'
    | 'agreements';

export type NotificationEmailMode = 'instant' | 'daily' | 'off';
export type NotificationEmailStatus = 'none' | 'pending_digest' | 'sent' | 'skipped' | 'failed';

export type NotificationKind =
    | 'task.assigned'
    | 'task.status_done'
    | 'task.due_soon'
    | 'comment.mention'
    | 'comment.reply'
    | 'comment.new'
    | 'deliverable.sent'
    | 'deliverable.decided'
    | 'deliverable.viewed'
    | 'document.shared'
    | 'document.client_upload'
    | 'invoice.sent'
    | 'invoice.paid'
    | 'invoice.overdue'
    | 'project.member_added'
    | 'team.joined'
    | 'client.portal_joined'
    | 'agreement.sent'
    | 'agreement.signed'
    | 'agreement.declined'
    | 'agreement.voided'
    | 'agreement.expired'
    | 'agreement.expiring'
    | 'agreement.completed';

export interface Notification {
    id: string;
    agency_id: string;
    user_id: string;
    kind: NotificationKind | string;
    category: NotificationCategory | string;
    title: string;
    body: string | null;
    link: string;
    entity_type: string | null;
    entity_id: string | null;
    actor_id: string | null;
    read_at: string | null;
    email_status: NotificationEmailStatus;
    created_at: string;
}

export interface NotificationPreference {
    user_id: string;
    agency_id: string;
    category: NotificationCategory | string;
    in_app: boolean;
    email: NotificationEmailMode;
    updated_at: string;
}

