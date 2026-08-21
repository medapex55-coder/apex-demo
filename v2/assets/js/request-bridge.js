/* APEX — passerelle de demandes Client <-> Concierge
   Prototype sans backend : les deux apps doivent être servies depuis la
   même origine (ex. le même serveur local, ou le même site une fois déployé)
   pour que le partage via localStorage fonctionne entre onglets. */

const APEX_BRIDGE_KEY = 'apex_shared_requests_v1';

function apexBridgeLoad(){
  try {
    const raw = localStorage.getItem(APEX_BRIDGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e){
    return [];
  }
}

function apexBridgeSave(list){
  localStorage.setItem(APEX_BRIDGE_KEY, JSON.stringify(list));
  // Le storage event ne se déclenche pas dans l'onglet émetteur lui-même :
  // on prévient donc aussi les listeners locaux de cet onglet.
  window.dispatchEvent(new CustomEvent('apex-bridge-local-change'));
}

function apexBridgeSubmitRequest({ client, tier, accountType, service }){
  const list = apexBridgeLoad();
  const req = {
    id: 'live-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    client: client || 'Client APEX',
    tier: tier || '',
    accountType: accountType || 'particulier',
    service: service,
    status: 'new',
    concierge: null,
    createdAt: new Date().toISOString(),
  };
  list.unshift(req);
  apexBridgeSave(list);
  return req;
}

function apexBridgeUpdateStatus(id, status, extra){
  const list = apexBridgeLoad();
  const req = list.find(r => r.id === id);
  if(req){
    req.status = status;
    if(extra) Object.assign(req, extra);
    apexBridgeSave(list);
  }
  return req;
}

function apexBridgeClear(){
  localStorage.removeItem(APEX_BRIDGE_KEY);
  localStorage.removeItem(APEX_MESSAGES_KEY);
  window.dispatchEvent(new CustomEvent('apex-bridge-local-change'));
}

/* ===== Messagerie liée à une demande ===== */
const APEX_MESSAGES_KEY = 'apex_shared_messages_v1';

function apexBridgeLoadAllMessages(){
  try {
    const raw = localStorage.getItem(APEX_MESSAGES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch(e){
    return {};
  }
}

function apexBridgeLoadMessages(requestId){
  const all = apexBridgeLoadAllMessages();
  return all[requestId] || [];
}

function apexBridgeSendMessage(requestId, sender, text){
  if(!requestId || !text) return null;
  const all = apexBridgeLoadAllMessages();
  if(!all[requestId]) all[requestId] = [];
  const msg = { sender, text, time: new Date().toISOString() };
  all[requestId].push(msg);
  localStorage.setItem(APEX_MESSAGES_KEY, JSON.stringify(all));
  window.dispatchEvent(new CustomEvent('apex-bridge-local-change'));
  return msg;
}

// callback() est appelé chaque fois qu'une autre app (autre onglet, même
// origine) écrit une demande ou un message — ainsi que pour les écritures
// faites localement dans cet onglet.
function apexBridgeOnChange(callback){
  window.addEventListener('storage', (e) => {
    if(e.key === APEX_BRIDGE_KEY || e.key === APEX_MESSAGES_KEY) callback();
  });
  window.addEventListener('apex-bridge-local-change', () => callback());
}
