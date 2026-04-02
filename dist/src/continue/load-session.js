export async function loadSession(runtime) {
    return runtime.stores.session.load();
}
