import { isClerkDevInstance } from "@/lib/clerk-dev";

/** True on client when using a Clerk dev publishable key. */
export function isClerkDevPkClient(): boolean {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  return pk.includes("pk_test_") || pk.includes("test_");
}

/** Skip Smart CAPTCHA mount on Clerk dev instances — testing token handles bot checks. */
export function shouldSkipClerkCaptcha(): boolean {
  return isClerkDevInstance() || isClerkDevPkClient();
}

function fapiMatches(url: string, fapiHost: string): boolean {
  const u = String(url);
  return u.includes(fapiHost) || u.includes("clerk.accounts.dev");
}

/** Mirrors @clerk/testing — tells clerk-js to skip Turnstile when using a testing token. */
export function patchCaptchaBypass(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const record = body as Record<string, unknown>;
  const response = record.response;
  if (response && typeof response === "object") {
    const r = response as Record<string, unknown>;
    if (r.captcha_bypass === false) r.captcha_bypass = true;
  }
  const client = record.client;
  if (client && typeof client === "object") {
    const c = client as Record<string, unknown>;
    if (c.captcha_bypass === false) c.captcha_bypass = true;
  }
}

/**
 * Inline script: inject testing token (server-preloaded), patch fetch/XHR before
 * Clerk boots, and flip `captcha_bypass` on FAPI responses.
 */
export function buildClerkDevBypassInitScript(
  fapiHost: string,
  preloadedToken?: string,
): string {
  const host = JSON.stringify(fapiHost);
  const seed = preloadedToken ? JSON.stringify(preloadedToken) : "null";
  return `(function(){
var fapi=${host};
if(window.__clerkDevBypassInit)return;
window.__clerkDevBypassInit=true;

function storeToken(raw){
  if(!raw)return;
  window.__clerkTestingToken=raw;
  document.documentElement.classList.add("clerk-dev-bypass");
}

function patchCaptchaBypass(body){
  if(!body||typeof body!=="object")return;
  if(body.response&&body.response.captcha_bypass===false)body.response.captcha_bypass=true;
  if(body.client&&body.client.captcha_bypass===false)body.client.captcha_bypass=true;
}

function fapiMatches(url,fapi){
  var u=String(url);
  return u.indexOf(fapi)>=0||u.indexOf("clerk.accounts.dev")>=0;
}

function refreshTokenAsync(){
  fetch("/api/clerk/testing-token",{cache:"no-store"}).then(function(r){
    if(!r.ok)return null;
    return r.json();
  }).then(function(d){
    if(d&&d.token)storeToken(d.token);
  }).catch(function(){});
}

var preloaded=${seed};
if(preloaded)storeToken(preloaded);
else refreshTokenAsync();
if(!window.__clerkTokenRefresh){
  window.__clerkTokenRefresh=setInterval(refreshTokenAsync,25000);
}

function attach(url){
  if(!url||!fapiMatches(String(url),fapi))return url;
  var tok=window.__clerkTestingToken;
  if(!tok)return url;
  var u=String(url),sep=u.indexOf("?")>=0?"&":"?";
  return u+sep+"__clerk_testing_token="+encodeURIComponent(tok);
}

function patchXhrResponse(xhr){
  if(!xhr._clerkUrl||!fapiMatches(String(xhr._clerkUrl),fapi))return;
  if(xhr.responseType&&xhr.responseType!=="text"&&xhr.responseType!=="")return;
  try{
    var body=JSON.parse(xhr.responseText);
    patchCaptchaBypass(body);
    Object.defineProperty(xhr,"responseText",{value:JSON.stringify(body)});
    Object.defineProperty(xhr,"response",{value:xhr.responseText});
  }catch(e){}
}

window.__clerkDevBypassReady=Promise.resolve();

var origFetch=window.fetch.bind(window);
window.fetch=function(input,init){
  var url="";
  if(typeof input==="string")url=input;
  else if(input instanceof URL)url=input.href;
  else if(input&&input.url)url=input.url;
  var patched=attach(url);
  var req=patched===url?input:(input instanceof Request?new Request(patched,input):patched);
  return origFetch(req,init).then(function(res){
    if(!fapiMatches(patched,fapi))return res;
    return res.clone().text().then(function(text){
      try{
        var body=JSON.parse(text);
        patchCaptchaBypass(body);
        return new Response(JSON.stringify(body),{
          status:res.status,
          statusText:res.statusText,
          headers:res.headers
        });
      }catch(e){
        return res;
      }
    });
  });
};

var origOpen=XMLHttpRequest.prototype.open;
var origSend=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open=function(method,url){
  this._clerkUrl=url;
  this._clerkOpenArgs=Array.prototype.slice.call(arguments);
  this._clerkDefer=fapiMatches(String(url),fapi);
  if(!this._clerkDefer)return origOpen.apply(this,arguments);
};
XMLHttpRequest.prototype.send=function(body){
  var self=this;
  if(this._clerkDefer){
    var args=this._clerkOpenArgs.slice();
    args[1]=attach(args[1]);
    this._clerkUrl=args[1];
    origOpen.apply(this,args);
    this._clerkDefer=false;
  }else if(this._clerkOpenArgs&&!this._clerkOpened){
    origOpen.apply(this,this._clerkOpenArgs);
    this._clerkOpened=true;
  }
  this.addEventListener("load",function(){patchXhrResponse(self);});
  return origSend.call(this,body);
};

/* Block Turnstile script injection on dev — testing token should be enough */
var origCreateElement=document.createElement.bind(document);
document.createElement=function(tag){
  var el=origCreateElement(tag);
  if(String(tag).toLowerCase()==="script"){
    var desc=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,"src");
    if(desc&&desc.set){
      var nativeSet=desc.set;
      Object.defineProperty(el,"src",{
        set:function(v){
          if(v&&String(v).indexOf("challenges.cloudflare.com")>=0)return;
          nativeSet.call(this,v);
        },
        get:desc.get?function(){return desc.get.call(this);}:undefined,
        configurable:true
      });
    }
  }
  return el;
};
})();`;
}

declare global {
  interface Window {
    __clerkDevBypassInit?: boolean;
    __clerkDevBypassReady?: Promise<void>;
    __clerkTestingToken?: string;
    __clerkTokenRefresh?: ReturnType<typeof setInterval>;
  }
}

/** Client fallback — token should already be set by the inline script. */
export async function ensureClerkDevBypassReady(): Promise<void> {
  if (typeof window === "undefined" || !isClerkDevPkClient()) return;
  if (window.__clerkTestingToken) return;

  const res = await fetch("/api/clerk/testing-token", { cache: "no-store" });
  if (!res.ok) throw new Error("clerk_testing_token_unavailable");
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("clerk_testing_token_empty");
  window.__clerkTestingToken = data.token;
  document.documentElement.classList.add("clerk-dev-bypass");
}
