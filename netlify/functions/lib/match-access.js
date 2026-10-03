/*
  Lógica de control de acceso compartida por scan-access.js (QR),
  manual-admit.js (alta manual buscando a la persona) y revert-access.js
  (anular). Un único sitio decide "¿da esta credencial acceso a este
  partido?" — así el alta manual pasa siempre por las mismas reglas que
  el escáner, nunca las salta (ni por error ni a propósito).
*/

// ¿Esta cuenta (por email) está en app_admins? Vale tanto para admin
// como para staff — cualquiera de los dos puede usar el escáner y el
// alta manual; algunas acciones más sensibles exigen además role==='admin'.
async function cuentaAutorizada(supabase, email) {
  const { data } = await supabase.from("app_admins").select("email, role").ilike("email", email).maybeSingle();
  return data || null;
}

// Mensajes en español llano, nunca el error crudo del backend.
async function evaluarCredencial(supabase, credencial, matchId) {
  let etiqueta = "";
  let valida = false;
  let motivo = "";

  if (credencial.membership_id) {
    const { data: membership } = await supabase
      .from("memberships")
      .select("*, ticket_products(nombre)")
      .eq("id", credencial.membership_id)
      .single();
    const { data: match } = await supabase.from("matches").select("team_id").eq("id", matchId).single();
    etiqueta = `${membership.ticket_products.nombre} · Nº ${String(membership.member_number).padStart(4, "0")}`;
    if (membership.estado !== "activa") {
      motivo = "Carné no activo.";
    } else if (membership.team_id && match && membership.team_id !== match.team_id) {
      motivo = "Este carné no da acceso a este partido.";
    } else {
      valida = true;
    }
  } else if (credencial.ticket_id) {
    const { data: ticket } = await supabase.from("tickets").select("*, matches(rival)").eq("id", credencial.ticket_id).single();
    etiqueta = `Entrada vs ${ticket.matches.rival}`;
    if (ticket.estado !== "valido") {
      motivo = "Entrada anulada.";
    } else if (ticket.match_id !== matchId) {
      motivo = "Entrada para otro partido.";
    } else {
      valida = true;
    }
  } else {
    motivo = "Credencial sin carné ni entrada asociada.";
  }

  return { valida, motivo, etiqueta };
}

module.exports = { cuentaAutorizada, evaluarCredencial };
