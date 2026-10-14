/** YouTube M9 status reconciliation; never retries uploaded bytes implicitly. */
import {officialUrl} from "./publishHttpsTransport.js";
type Reply={status:number;headers?:Record<string,string>;json?:unknown};
type ProbeReq={method:"PUT";url:string;headers:Record<string,string>};
export function interpretYoutubeUploadStatus(response:Reply,total:number){
 if(!Number.isSafeInteger(total)||total<=0)throw Error("YT_SIZE_INVALID");
 if(response.status===308){
  const text=Object.entries(response.headers??{})
   .find(([k])=>k.toLowerCase()==="range")?.[1];
  if(text===undefined)return {state:"RESUME_REQUIRED" as const,nextByte:0};
  const m=/^bytes=0-(\d+)$/.exec(text);
  if(!m)throw Error("YT_RANGE_INVALID");
  const nextByte=Number(m[1])+1;
  if(!Number.isSafeInteger(nextByte)||nextByte>=total)
   throw Error("YT_RANGE_OUT_OF_BOUNDS");
  return {state:"RESUME_REQUIRED" as const,nextByte};
 }
 if(response.status===200||response.status===201){
  const result=response.json;
  const videoId=result&&typeof result==="object"&&"id" in result?result.id:null;
  if(typeof videoId!=="string"||!/^[A-Za-z0-9_-]{1,100}$/.test(videoId))
   throw Error("YT_COMPLETION_ID_INVALID");
  return {state:"COMPLETED_UNVERIFIED" as const,videoId};
 }
 return {state:"UNKNOWN" as const,reason:"HTTP_"+response.status};
}
/** Queries the server-reported offset with an empty PUT, never sends file bytes.
 * Returned information is not a new publication permission.
 */
export async function probeYoutubeUploadStatus(options:{
 sessionUrl:string;mediaSize:number;accessToken:string;
 request:(request:ProbeReq)=>Promise<Reply>;
}){
 const url=officialUrl(options.sessionUrl);
 if(url.hostname!=="www.googleapis.com"||url.pathname!=="/upload/youtube/v3/videos")
  throw Error("YT_SESSION_URL_DENIED");
 if(!Number.isSafeInteger(options.mediaSize)||options.mediaSize<1||!options.accessToken)
  throw Error("YT_STATUS_PROBE_INVALID");
 const response=await options.request({
  method:"PUT",url:url.toString(),
  headers:{Authorization:"Bearer "+options.accessToken,
   "Content-Length":"0","Content-Range":"bytes */"+options.mediaSize},
 });
 return interpretYoutubeUploadStatus(response,options.mediaSize);
}
