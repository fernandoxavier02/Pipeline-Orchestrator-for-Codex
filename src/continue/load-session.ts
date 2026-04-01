export async function loadSession(runtime: {
  stores: {
    session: { load: () => Promise<unknown> };
  };
}) {
  return runtime.stores.session.load();
}
