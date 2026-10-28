export const runtime = "nodejs";

/**
 * The script embed: <div data-roadie-shows></div><script src="https://.../embed/{slug}/shows.js" async></script>
 * (optional data-config="<lineup id>" on the script). Renders the list into the div (or right after the script) as plain
 * markup with only light inline layout, so the site's own fonts and colors apply. Reads /api/public/{slug}/shows from
 * the script's own origin.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const js = `(function(){
var s=document.currentScript;if(!s)return;
var origin=new URL(s.src).origin;
var box=document.querySelector("[data-roadie-shows]")||s.insertAdjacentElement("afterend",document.createElement("div"));
var cfg=s.getAttribute("data-config");
var DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function day(d){var p=d.split("-"),x=new Date(Date.UTC(+p[0],+p[1]-1,+p[2]));return DAYS[x.getUTCDay()]+", "+MON[+p[1]-1]+" "+(+p[2]);}
function time(t){var p=t.split(":"),h=+p[0];return ((h+11)%12+1)+":"+p[1]+" "+(h<12?"am":"pm");}
function el(tag,text,css){var e=document.createElement(tag);if(text)e.textContent=text;if(css)e.style.cssText=css;return e;}
fetch(origin+"/api/public/"+encodeURIComponent(${JSON.stringify(slug)})+"/shows"+(cfg?"?config="+encodeURIComponent(cfg):"")).then(function(r){return r.json();}).then(function(d){
box.textContent="";
if(!d.shows||!d.shows.length){var p=el("p","No shows booked right now.");if(d.joinUrl){p.appendChild(document.createTextNode(" "));var a=el("a","Join the mailing list");a.href=origin+d.joinUrl;a.target="_top";p.appendChild(a);}box.appendChild(p);return;}
var ul=el("ul",null,"list-style:none;margin:0;padding:0");
d.shows.forEach(function(x){
var li=el("li",null,"display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid rgba(128,128,128,.3)");
li.appendChild(el("strong",day(x.date),"min-width:110px"));
var w=el("span",null,"flex:1;min-width:160px");w.appendChild(el("span",x.venue,"font-weight:600"));
if(x.city)w.appendChild(document.createTextNode(" \\u00b7 "+x.city));
w.appendChild(document.createElement("br"));
w.appendChild(el("small",[x.time?time(x.time):"",x.billedAs].filter(Boolean).join(" \\u00b7 "),"opacity:.7"));
li.appendChild(w);
if(x.ticketUrl){var t=el("a","Tickets");t.href=x.ticketUrl;t.target="_blank";t.rel="noreferrer";li.appendChild(t);}
ul.appendChild(li);});
box.appendChild(ul);
}).catch(function(){box.textContent="";});
})();`;
  return new Response(js, { headers: { "content-type": "application/javascript; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } });
}
