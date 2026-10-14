/** OWL Publish M9: safe local official HTTPS request port. NOT connected to production. */
import https from "node:https";
import dns from "node:dns/promises";
import {BlockList,isIP} from "node:net";

export type OfficialHttpRequest={
 method:"GET"|"POST"|"PUT";url:string;headers:Record<string,string>;body?:string|Uint8Array;
};
export type OfficialHttpResponse={status:number;headers:Record<string,string>;json?:unknown};
type Dial=(request:OfficialHttpRequest,pinnedIpv4:string)=>Promise<OfficialHttpResponse>;
type Resolver=(host:string)=>Promise<string[]>;
const DENIED=new BlockList();
for(const [addr,prefix] of [
 ["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],
 ["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],
 ["192.88.99.0",24],["192.168.0.0",16],["198.18.0.0",15],
 ["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4],
] as const)DENIED.addSubnet(addr,prefix,"ipv4");
export const publicOfficialIpv4=(ip:string)=>isIP(ip)===4&&!DENIED.check(ip,"ipv4");
export function officialUrl(raw:string){
 let uri:URL;try{uri=new URL(raw);}catch{throw Error("PUBLISH_HTTPS_URL_INVALID");}
 if(uri.protocol!=="https:"||uri.port||uri.username||uri.password||uri.hash||
    raw.length>4096||!["www.googleapis.com","graph.facebook.com","rupload.facebook.com"].includes(uri.hostname))
  throw Error("PUBLISH_HTTPS_HOST_DENIED");
 const allowed=uri.hostname==="www.googleapis.com"
  ?/^\/(?:upload\/youtube\/v3\/videos|youtube\/v3\/videos)$/.test(uri.pathname)
  :uri.hostname==="graph.facebook.com"
  ?/^\/v\d{1,2}\.\d+\/[A-Za-z0-9_-]{1,100}(?:\/media)?$/.test(uri.pathname)
  :/^\/(?:ig-api-upload|video-upload)\/v\d{1,2}\.\d+\/[A-Za-z0-9_-]{1,160}$/.test(uri.pathname);
 if(!allowed)throw Error("PUBLISH_HTTPS_ROUTE_DENIED");
 return uri;
}
function sanitize(req:OfficialHttpRequest){
 const target=officialUrl(req.url);
 if(!["GET","POST","PUT"].includes(req.method))throw Error("PUBLISH_HTTPS_METHOD_DENIED");
 const bytes=req.body===undefined?0:Buffer.byteLength(req.body);
 if(bytes>64*1024*1024)throw Error("PUBLISH_HTTPS_UPLOAD_TOO_LARGE");
 const headers:Record<string,string>={};
 for(const [name,value] of Object.entries(req.headers)){
  if(!/^[A-Za-z0-9-]{1,80}$/.test(name)||typeof value!=="string"||value.length>8192||
     /[\r\n\0]/.test(value)||/^(host|connection|transfer-encoding|proxy-authorization|cookie|accept-encoding)$/i.test(name))
   throw Error("PUBLISH_HTTPS_HEADER_DENIED");
  headers[name]=value;
 }
 const length=Object.entries(headers).find(([name])=>name.toLowerCase()==="content-length")?.[1];
 if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)!==bytes))
  throw Error("PUBLISH_HTTPS_LENGTH_MISMATCH");
 if(req.method==="GET"&&bytes)throw Error("PUBLISH_HTTPS_GET_BODY_DENIED");
 return {...req,url:target.toString(),headers};
}
async function defaultResolver(host:string){
 const result=await dns.lookup(host,{family:4,all:true});
 return result.map(r=>r.address);
}
async function defaultDial(req:OfficialHttpRequest,pinnedIpv4:string){
 const url=new URL(req.url);
 return await new Promise<OfficialHttpResponse>((resolve,reject)=>{
  let finished=false;
  const done=(err?:Error,result?:OfficialHttpResponse)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   if(err)reject(err);else resolve(result!);
  };
  const request=https.request({
   protocol:"https:",hostname:url.hostname,servername:url.hostname,port:443,
   path:url.pathname+url.search,method:req.method,agent:false,rejectUnauthorized:true,
   headers:{...req.headers,Host:url.hostname,"Accept-Encoding":"identity"},
   lookup:(_host,_options,callback)=>callback(null,pinnedIpv4,4),
  },response=>{
   const status=response.statusCode??0;
   if(status>=300&&status<400&&status!==308){
    response.destroy();done(Error("PUBLISH_HTTPS_REDIRECT_DENIED"));return;
   }
   let total=0;const chunks:Buffer[]=[];
   response.on("data",(b:Buffer)=>{
    total+=b.length;
    if(total>512*1024){response.destroy();done(Error("PUBLISH_HTTPS_RESPONSE_TOO_LARGE"));return;}
    chunks.push(b);
   });
   response.on("error",err=>done(err));
   response.on("end",()=>{
    if(finished)return;
    const headers:Record<string,string>={};
    for(const [key,value] of Object.entries(response.headers))
     if(typeof value==="string")headers[key]=value;
    const raw=Buffer.concat(chunks).toString("utf8");
    let json:unknown;
    if(raw.trim()){
     if(!/^\s*[\[{]/.test(raw))return done(Error("PUBLISH_HTTPS_JSON_REQUIRED"));
     try{json=JSON.parse(raw);}catch{return done(Error("PUBLISH_HTTPS_JSON_INVALID"));}
    }
    done(undefined,{status,headers,...(json===undefined?{}:{json})});
   });
  });
  const timer=setTimeout(()=>request.destroy(Error("PUBLISH_HTTPS_TIMEOUT")),90_000);
  request.on("error",err=>done(err));
  request.end(req.body);
 });
}
/** Pin a public IPv4 for the actual TLS socket; redirects are never followed.
 * DNS, Host, SNI and certificate hostname must stay bound to the original API host.
 * IPv6 is intentionally disabled in this initial security-limited transport.
 */
export function createOfficialHttpsPort(opts?:{resolve?:Resolver;dial?:Dial}){
 const resolver=opts?.resolve??defaultResolver,dial=opts?.dial??defaultDial;
 return async(req:OfficialHttpRequest):Promise<OfficialHttpResponse>=>{
  const safe=sanitize(req),host=new URL(safe.url).hostname;
  const ips=await resolver(host),pinned=ips.find(publicOfficialIpv4);
  if(!pinned)throw Error("PUBLISH_HTTPS_DNS_NOT_PUBLIC");
  const response=await dial(safe,pinned);
  if(response.status>=300&&response.status<400&&response.status!==308)
   throw Error("PUBLISH_HTTPS_REDIRECT_DENIED");
  return response;
 };
}
