/* =============================================================
   auth.js — login do admin (Supabase Auth, e-mail + senha).
   Só entra quem tem app_metadata.role = 'admin' (mesmo padrão da loja).
   Modo demonstração: qualquer e-mail com a senha "demo".
   ============================================================= */
const Auth = (() => {
  async function login(email, password) {
    if (DEMO) {
      if (password !== 'demo') return { st: 'bad', msg: 'No modo demonstração a senha é "demo".' };
      Store.set(KEY.demoAuth, { at: Date.now() });
      return { st: 'ok' };
    }
    if (!SB) return { st: 'bad', msg: ERR.network };
    const { data, error } = await SB.auth.signInWithPassword({ email, password });
    if (error) return { st: 'bad', msg: /invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message };
    if (data.user?.app_metadata?.role !== 'admin') {
      await SB.auth.signOut();
      return { st: 'bad', msg: 'Esta conta não tem permissão de administrador.' };
    }
    return { st: 'ok' };
  }

  async function logout() {
    if (DEMO) return Store.del(KEY.demoAuth);
    if (SB) await SB.auth.signOut();
  }

  async function getSession() {
    if (DEMO) return Store.get(KEY.demoAuth) ? { user: { email: 'demo', app_metadata: { role: 'admin' } } } : null;
    if (!SB) return null;
    try {
      const { data, error } = await SB.auth.getSession();
      if (error) {
        await SB.auth.signOut(); // token inválido: limpa a sessão
        return null;
      }
      return data.session;
    } catch (e) {
      return null;
    }
  }

  const isAdmin = async () => (await getSession())?.user?.app_metadata?.role === 'admin';

  async function changePassword(pw) {
    if (DEMO) return { st: 'bad', msg: 'No modo demonstração a senha é sempre "demo".' };
    const { error } = await SB.auth.updateUser({ password: pw });
    if (error) return { st: 'bad', msg: /same/i.test(error.message) ? 'A nova senha precisa ser diferente da atual.' : 'Não foi possível alterar a senha. Entre de novo e tente outra vez.' };
    return { st: 'ok' };
  }

  return { login, logout, getSession, isAdmin, changePassword };
})();
