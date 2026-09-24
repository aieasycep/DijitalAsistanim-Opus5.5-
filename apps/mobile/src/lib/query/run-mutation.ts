/**
 * Runs a `@da/api-client` mutation option factory outside a `useMutation` hook (imperative flows
 * that outlive a screen: delayed approvals, reminder replays, share uploads).
 */
export function runMutation<V, R>(
  options: { readonly mutationFn?: (variables: V, context: never) => Promise<R> },
  variables: V,
): Promise<R> {
  const fn = options.mutationFn;
  if (fn === undefined) return Promise.reject(new Error('[runMutation] missing mutationFn'));
  return fn(variables, undefined as never);
}
