/** Legacy Stripe overage scaffold is disabled. Paystack subscriptions are the active billing path.
 * Do not schedule a job or charge a customer until an approved overage policy is implemented.
 */
export async function processWorkspaceOverage(_workspaceId: string, _customerId: string): Promise<never> {
    throw new Error('Automatic overage billing is not configured');
}
export function startOverageBillingJob(): never {
    throw new Error('Automatic overage billing is not configured');
}
