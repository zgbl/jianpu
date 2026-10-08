// Accept this server's own LAN address when explicitly bound for home-network use.
// Host and Origin must still identify the same page; cross-site browser requests stay blocked.
export function localPageRequest(req){
 const host=req.headers?.host||'';
 const address=host.match(/^((?:\d{1,3}\.){3}\d{1,3}|localhost)(?::\d{1,5})?$/)?.[1];
 if(!address||req.headers['sec-fetch-site']==='cross-site')return false;
 const local=req.socket?.localAddress;
 if(local&&['localhost','127.0.0.1'].includes(address)&&local!=='127.0.0.1')return false;
 if(!['localhost','127.0.0.1'].includes(address)&&address!==local)return false;
 return !req.headers.origin||req.headers.origin===`http://${host}`;
}

export function serverDeviceRequest(req){
 if(!localPageRequest(req))return false;
 const remote=req.socket?.remoteAddress,local=req.socket?.localAddress;
 // Stream mocks used by unit tests have no socket; only loopback Hosts qualify.
 if(!remote)return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'');
 return remote==='127.0.0.1'||remote===local;
}
