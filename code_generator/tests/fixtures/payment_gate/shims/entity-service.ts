// Fixture-only stand-in for the generated lib/paid_widget/service.ts and
// lib/paid_gadget/service.ts (payment-gate check). lib/payment/
// payment_webhook_dispatch.ts imports one delete function per x-payment
// entity; the real service files pull in the whole authz/validation/audit
// stack, which this minimal fixture does not carry. Only the two signatures
// the dispatcher calls are declared, identical to what the generator emits
// for a non-audited entity: delete{Entity}(ids: string[]).
export async function deletePaidWidget(_ids: string[]): Promise<void> {
  throw new Error('fixture stub');
}

export async function deletePaidGadget(_ids: string[]): Promise<void> {
  throw new Error('fixture stub');
}
