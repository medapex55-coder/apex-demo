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
  window.dispatchEvent(new CustomEvent('apex-bridge-local-change'));
}

// callback(list) est appelé chaque fois qu'une autre app (autre onglet, même
// origine) écrit dans la passerelle — ainsi que pour les écritures locales.
function apexBridgeOnChange(callback){
  window.addEventListener('storage', (e) => {
    if(e.key === APEX_BRIDGE_KEY) callback(apexBridgeLoad());
  });
  window.addEventListener('apex-bridge-local-change', () => callback(apexBridgeLoad()));
}
