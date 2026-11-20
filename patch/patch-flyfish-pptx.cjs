'use strict';

// Flyfish 3.3.4 can treat DrawingML text insets (EMUs) as arbitrary group
// coordinates. Some real presentations use a 635:1 group coordinate system,
// turning a normal 9.6 px inset into 6096 px. Keep normal group scaling, but
// fall back to the ungrouped EMU conversion when that ratio is implausible.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'node_modules', '@file-viewer', 'pptx', 'package.json')).version;
if (version !== '3.3.4') throw new Error(`Reassess the PPTX inset patch for Flyfish ${version}.`);
const worker = path.join(root, 'build', 'dist', 'file-viewer', 'vendor', 'pptx', 'pptx.worker.js');
let source = fs.readFileSync(worker, 'utf8');
const marker = 'function __slowLookPptxInset(';
const notice = '/* QuickLook Fast modified this Flyfish PPTX Worker: text, progressive styles, shape geometry, gradients and chart metadata; see THIRD_PARTY.md and patch/patch-flyfish-pptx.cjs. */\n';
const expression = /"box-sizing:border-box;padding:"\+([\w$]+)\(([\w$]+)\.top,"y",([\w$]+)\)\+"px "\+\1\(\2\.right,"x",\3\)\+"px "\+\1\(\2\.bottom,"y",\3\)\+"px "\+\1\(\2\.left,"x",\3\)\+"px;"/g;
if (!source.includes(marker)) {
  const matches = [...source.matchAll(expression)];
  if (matches.length !== 1) throw new Error(`Expected one Flyfish PPTX inset expression, found ${matches.length}.`);
  const [, mapper, metrics, group] = matches[0];
  const helper = `function __slowLookPptxInset(v,a,g){const m=${mapper}(v,a,g),n=${mapper}(v,a,void 0);return g&&n>0&&m/n>64?n:m}\n`;
  const replacement = `"box-sizing:border-box;padding:"+__slowLookPptxInset(${metrics}.top,"y",${group})+"px "+__slowLookPptxInset(${metrics}.right,"x",${group})+"px "+__slowLookPptxInset(${metrics}.bottom,"y",${group})+"px "+__slowLookPptxInset(${metrics}.left,"x",${group})+"px;"`;
  source = helper + source.replace(expression, replacement);
}

// The same exaggerated group scaling was also subtracted from paragraph
// width. That made otherwise visible Chinese headings and dates 0px wide.
const paragraphInsets = 'l=o===void 0?Ma(c.left+c.right,"x",d):0';
const repairedParagraphInsets = 'l=o===void 0?__slowLookPptxInset(c.left+c.right,"x",d):0';
if (!source.includes(repairedParagraphInsets)) {
  if (source.split(paragraphInsets).length !== 2) throw new Error('The Flyfish PPTX paragraph width calculation changed; reassess the inset repair.');
  source = source.replace(paragraphInsets, repairedParagraphInsets);
}

// DrawingML eaVert is upright East Asian vertical writing, not a 90-degree
// rotation of the glyphs. Keep real shape rotation and use CSS vertical text.
const verticalDirection = 'direction:T.vert,upright:yf(T.upright)';
const repairedDirection = 'direction:T.vert==="eaVert"?"horz":T.vert,upright:yf(T.upright)';
const verticalTail = '__slowLookPptxInset(X.left,"x",_)+"px;";if(y!==void 0';
const repairedTail = '__slowLookPptxInset(X.left,"x",_)+"px;"+(T.vert==="eaVert"?"writing-mode:vertical-rl;text-orientation:upright;":"");if(y!==void 0';
for (const [before, after] of [[verticalDirection, repairedDirection], [verticalTail, repairedTail]]) {
  if (source.includes(after)) continue;
  if (source.split(before).length !== 2) throw new Error('The Flyfish PPTX vertical text handling changed; reassess this repair.');
  source = source.replace(before, after);
}

// Upstream normally posts generated CSS only after parsing every slide, even
// though it displays the first slide progressively. Send new rules before the
// corresponding slide so large presentations are not temporarily unstyled.
// The original complete CSS message remains as a final consistency fallback.
if (!source.includes('function __slowLookPptxCssDelta(')) {
  const definition = 'function R5(){var e="";for(var r of Object.keys(Ea))';
  const loop = 'let _=l.length,v=0;for(let m=0;m<_;m++)';
  const delivery = 'f===y?(r(I),o(++f)):d[y]=I,r({type:"progress-update"';
  for (const target of [definition, loop, delivery]) {
    if (source.split(target).length !== 2) throw new Error('The Flyfish PPTX worker changed; reassess progressive styles.');
  }
  const helper = 'var __slowLookPptxCssCursor=0;function __slowLookPptxCssDelta(){var keys=Object.keys(Ea),css="";for(;__slowLookPptxCssCursor<keys.length;__slowLookPptxCssCursor++){var v=Ea[keys[__slowLookPptxCssCursor]];if(v&&typeof v.name==="string"&&typeof v.text==="string")css+=" ."+v.name+(v.suffix||"")+"{"+v.text+"}\\n"}return css}\n';
  source = source.replace(definition, helper + definition)
    .replace(loop, 'let _=l.length,v=0;__slowLookPptxCssCursor=0;for(let m=0;m<_;m++)')
    .replace(delivery, 'let __slowLookStyles=__slowLookPptxCssDelta();__slowLookStyles&&r({type:"globalCSS",data:__slowLookStyles});' + delivery);
}

// DrawingML stops may be deliberately very close or at the same position to
// make a hard edge. The upstream worker discards positions and spaces every
// stop evenly, turning a narrow coloured border into a broad gradient.
if (!source.includes('function __slowLookGradientOffset(')) {
  const replacements = [
    ['s[i]=d}var f=e["a:lin"]', 's[i]=d,n[i]=Number(L(a[i],["attrs","pos"]))/1e5}var f=e["a:lin"]'],
    ['c=Lk(c,t),{color:s,rot:c}', 'c=Lk(c,t),{color:s,rot:c,pos:n}'],
    ['Y=Bk(u,h,pe,Ee,b)', 'Y=Bk(u,h,pe,Ee,b,ee.pos)'],
    ['function Bk(e,r,t,a,s){var n=', 'function Bk(e,r,t,a,s,positions){var n='],
    ['Math.round(parseFloat(n[M])/100*g)/g', '__slowLookGradientOffset(positions,M,m)'],
    ['b+="#"+Y[r]+");":b+="#"+Y[r]+", "', 'b+="#"+Y[r]+__slowLookGradientCss(g[0].pos,r,Y.length)+");":b+="#"+Y[r]+__slowLookGradientCss(g[0].pos,r,Y.length)+", "'],
    ['p+="#"+ge[u]+");":p+="#"+ge[u]+", "', 'p+="#"+ge[u]+__slowLookGradientCss(H[0].pos,u,ge.length)+");":p+="#"+ge[u]+__slowLookGradientCss(H[0].pos,u,ge.length)+", "'],
    ['m+="#"+_[g]+");":m+="#"+_[g]+", "', 'm+="#"+_[g]+__slowLookGradientCss(i.pos,g,_.length)+");":m+="#"+_[g]+__slowLookGradientCss(i.pos,g,_.length)+", "'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('The Flyfish PPTX gradient implementation changed; reassess stop handling.');
    source = source.replace(before, after);
  }
  source = 'function __slowLookGradientOffset(p,i,n){var v=p&&p[i];return Number.isFinite(v)?Math.max(0,Math.min(1,v)):n>1?i/(n-1):0}function __slowLookGradientCss(p,i,n){return " "+(__slowLookGradientOffset(p,i,n)*100)+"%"}\n' + source;
}

// qu() converts DrawingML angles for CSS. The SVG helper uses an upward Y
// axis, so translate the angle and reverse its sign for SVG's downward Y axis.
const reversedGradient = 'pe=ee.rot+90,Y=Bk(u,h,pe,Ee,b,ee.pos)';
const priorGradient = 'pe=ee.rot-90,Y=Bk(u,h,pe,Ee,b,ee.pos)';
const correctGradient = 'pe=90-ee.rot,Y=Bk(u,h,pe,Ee,b,ee.pos)';
if (!source.includes(correctGradient)) {
  const target = source.split(reversedGradient).length === 2 ? reversedGradient : priorGradient;
  if (source.split(target).length !== 2) throw new Error('The Flyfish SVG gradient direction changed; reassess this repair.');
  source = source.replace(target, correctGradient);
}

// The default DrawingML arrowhead is half the shorter side, not half the
// shape width. Wide arrows otherwise grow an enormous triangular head.
if (!source.includes('/* __slowLookArrowGeometry */')) {
  const replacements = [
    ['case"rightArrow":var C=L(e,["p:spPr","a:prstGeom","a:avLst","a:gd"]),Se,je=.25,Te,et=.5,Fn=u/h;', 'case"rightArrow":var C=L(e,["p:spPr","a:prstGeom","a:avLst","a:gd"]),Se,je=.25,Te,et=1-.5*Math.min(u,h)/u,Fn=u/h;C!==void 0&&(C=_r(C));'],
    ['case"leftArrow":var C=L(e,["p:spPr","a:prstGeom","a:avLst","a:gd"]),Se,je=.25,Te,et=.5,Fn=u/h;', 'case"leftArrow":var C=L(e,["p:spPr","a:prstGeom","a:avLst","a:gd"]),Se,je=.25,Te,et=.5*Math.min(u,h)/u,Fn=u/h;C!==void 0&&(C=_r(C));'],
    ['et=1-Qn/Fn}}p+=" <polygon points=\'"+u+" "+h/2', 'et=1-Math.min(u,h)*Qn/u}}p+=" <polygon points=\'"+u+" "+h/2'],
    ['et=Qn/Fn}}p+=" <polygon points=\'0 "+h/2+","+et*u+" "+h+","+et*u+" "+(1-je)*h+","+u+', 'et=Math.min(u,h)*Qn/u}}p+=" <polygon points=\'0 "+h/2+","+et*u+" "+h+","+et*u+" "+(1-je)*h+","+u+'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error(`The Flyfish PPTX arrow implementation changed: ${before.slice(0, 100)}`);
    source = source.replace(before, after);
  }
  source = '/* __slowLookArrowGeometry */\n' + source;
}

// DrawingML uses the shorter side for preset corner and skew adjustments.
// Scaling the adjustment separately by width and height stretches rounded
// corners and makes a wide, shallow parallelogram excessively slanted.
if (!source.includes('function __slowLookRoundRect(')) {
  const roundedCall = 'var ze=Ag(u,h,je,et,B0,D0);';
  const parallelogram = 'U1=.25,H1;if(u>h?H1=u/h:H1=h/u,ye!==void 0){var A5=parseInt(ye.substr(4))/1e5;U1=A5/H1}';
  const correctedParallelogram = 'U1=.25*Math.min(u,h)/Math.max(u,Number.EPSILON),H1;if(u>h?H1=u/h:H1=h/u,ye!==void 0){var A5=parseInt(ye.substr(4))/1e5;U1=Math.max(0,Math.min(1,A5*Math.min(u,h)/Math.max(u,Number.EPSILON)))}';
  for (const target of [roundedCall, parallelogram]) {
    if (source.split(target).length !== 2) throw new Error('The Flyfish PPTX preset geometry changed; reassess corner and skew dimensions.');
  }
  const rounded = String.raw`function __slowLookRoundRect(e,r,t,a,s,n){var i,o,d,f;n==="cornr1"?(i=0,o=0,d=0,f=t):n==="cornr2"?(i=t,o=a,d=a,f=t):n==="cornrAll"?(i=t,o=t,d=t,f=t):n==="diag"&&(i=t,o=a,d=t,f=a);var k=Math.min(Math.max(e,0),Math.max(r,0))/2;return s==="round"?"M0,"+(r-o*k)+" Q0,"+r+" "+o*k+","+r+" L"+(e-d*k)+","+r+" Q"+e+","+r+" "+e+","+(r-d*k)+" L"+e+","+f*k+" Q"+e+",0 "+(e-f*k)+",0 L"+i*k+",0 Q0,0 0,"+i*k+" z":s==="snip"?"M0,"+i*k+" L0,"+(r-o*k)+" L"+o*k+","+r+" L"+(e-d*k)+","+r+" L"+e+","+(r-d*k)+" L"+e+","+f*k+" L"+(e-f*k)+",0 L"+i*k+",0 z":void 0}`;
  source = rounded + '\n' + source.replace(roundedCall, 'var ze=__slowLookRoundRect(u,h,je,et,B0,D0);')
    .replace(parallelogram, correctedParallelogram);
}

// Preserve a gradient line and its end caps on open arcs. Draw the elliptical
// arc around the correct centre instead of rotating a circle-shaped path.
if (!source.includes('function __slowLookArcPath(')) {
  const line = 'var E=Si(e,r,!0,"shape",f),Be=';
  const arc = `var ev=$g(rc,u,F,te,Bf);p+="<path   d='"+ev[0]+"' transform='"+ev[1]+"' fill='"+(oe?"url(#imgPtrn_"+b+")":fe?"url(#linGrd_"+b+")":ee)+"' stroke='"+E.color+"' stroke-width='"+E.width+"' stroke-dasharray='"+E.strokeDasharray+"' />";break;case"chord":`;
  for (const target of [line, arc]) {
    if (source.split(target).length !== 2) throw new Error('The Flyfish PPTX arc rendering changed; reassess line gradients and geometry.');
  }
  const helpers = String.raw`var __slowLookArcNextId=0;function __slowLookArcPath(w,h,start,end){var x=w/2,y=h/2,s=start*Math.PI/180,span=((end-start)%360+360)%360,full=span===0&&end!==start,point=function(a){return[x+x*Math.cos(a),y+y*Math.sin(a)]},p=point(s),q=point((start+(full?180:span))*Math.PI/180),d="M"+p[0]+","+p[1];if(full)d+=" A"+x+","+y+" 0 0,1 "+q[0]+","+q[1]+" A"+x+","+y+" 0 0,1 "+p[0]+","+p[1];else if(span)d+=" A"+x+","+y+" 0 "+(span>180?1:0)+",1 "+q[0]+","+q[1];return[d,""]}function __slowLookArcCap(e){var cap=L(e,["p:spPr","a:ln","attrs","cap"]);return cap==="rnd"?"round":cap==="sq"?"square":"butt"}function __slowLookArcGradient(e,theme,w,h,id){var fill=L(e,["p:spPr","a:ln","a:gradFill"]);if(!fill||!L(fill,["a:gsLst","a:gs"]))return;var gradient=qu(fill,theme,e);if(!gradient||!Array.isArray(gradient.color)||gradient.color.length<2)return;var stops=gradient.color.map(function(color,i){return{color:color,pos:__slowLookGradientOffset(gradient.pos,i,gradient.color.length)}});if(stops.some(function(stop){return!/^[\da-f]{6}(?:[\da-f]{2})?$/i.test(String(stop.color))}))return;stops.sort(function(a,b){return a.pos-b.pos});return Bk(w,h,90-gradient.rot,stops.map(function(stop){return stop.color}),id,stops.map(function(stop){return stop.pos}))}`;
  const lineWithGradient = 'var E=Si(e,r,!0,"shape",f);if(y==="arc"&&E&&typeof E==="object"){var __slowLookArcId="slowlook_arc_"+(++__slowLookArcNextId),__slowLookArcDefs=__slowLookArcGradient(e,f,u,h,__slowLookArcId);if(__slowLookArcDefs){p+=__slowLookArcDefs;E.color="url(#linGrd_"+__slowLookArcId+")"}}var Be=';
  const repairedArc = `var ev=y==="arc"?__slowLookArcPath(u,h,F,te):$g(rc,u,F,te,Bf);p+="<path   d='"+ev[0]+"' transform='"+ev[1]+"' fill='"+(oe?"url(#imgPtrn_"+b+")":fe?"url(#linGrd_"+b+")":ee)+"' stroke='"+E.color+"' stroke-width='"+E.width+"' stroke-dasharray='"+E.strokeDasharray+"' stroke-linecap='"+(y==="arc"?__slowLookArcCap(e):"butt")+"' />";break;case"chord":`;
  source = helpers + '\n' + source.replace(line, lineWithGradient).replace(arc, repairedArc);
}

// WPS writes chart axis IDs as signed 32-bit values. Office accepts these as
// unsigned IDs; dropping them also discards axis fonts, bounds and direction.
const unsignedAxisId = 'Bh=e=>/^\\d{1,10}$/.test(String(e))&&Number(e)<=4294967295?String(Number(e)):void 0';
const compatibleAxisId = 'Bh=e=>{let s=String(e),n=Number(s);return /^-?\\d{1,10}$/.test(s)&&n>=-2147483648&&n<=4294967295?String(n<0?n+4294967296:n):void 0}';
if (!source.includes(compatibleAxisId)) {
  if (source.split(unsignedAxisId).length !== 2) throw new Error('The Flyfish PPTX axis ID parser changed; reassess signed chart IDs.');
  source = source.replace(unsignedAxisId, compatibleAxisId);
}

// XML character references in cached chart labels reach the model encoded.
// Decode once as XML (not HTML), so a literal &amp;#10; stays literal text.
if (!source.includes('function __slowLookChartText(')) {
  const cacheValue = 'r.set(n,i!=null&&typeof i=="object"?"":i)';
  if (source.split(cacheValue).length !== 2) throw new Error('The Flyfish PPTX chart cache parser changed; reassess line breaks.');
  const helper = String.raw`function __slowLookChartText(s){const names={amp:"&",lt:"<",gt:">",quot:'"',apos:"'"};return s.replace(/&(amp|lt|gt|quot|apos|#(?:[xX][\da-fA-F]{1,6}|\d{1,7}));/g,(all,ref)=>{if(ref[0]!=="#")return names[ref];const n=ref[1].toLowerCase()==="x"?parseInt(ref.slice(2),16):Number(ref.slice(1));return n>0&&n<=1114111&&(n<55296||n>57343)?String.fromCodePoint(n):all})}`;
  source = helper + '\n' +
    source.replace(cacheValue, 'r.set(n,i!=null&&typeof i==="object"?"":typeof i==="string"?__slowLookChartText(i):i)');
}

// Line charts specify their series color on a:ln rather than a:solidFill.
if (!source.includes('/* __slowLookLineSeriesColor */')) {
  const replacements = [
    ['function Dm(e,r,t,a){', 'function Dm(e,r,t,a,chartType){'],
    ['M=Dm(g,s,r,t);', 'M=Dm(g,s,r,t,m);'],
    ['color:o(d==null?void 0:d["c:spPr"]),...d!=null&&d["c:dLbls"]',
      'color:chartType==="lineChart"?(o(d?.["c:spPr"]?.["a:ln"])??o(d?.["c:spPr"])):o(d?.["c:spPr"]),...d!=null&&d["c:dLbls"]'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('The Flyfish PPTX chart color parser changed; reassess line series.');
    source = source.replace(before, after);
  }
  source = '/* __slowLookLineSeriesColor */\n' + source;
}

// Preserve the optional background behind Office data labels, e.g. line
// values drawn over a dark bar in a combination chart.
if (!source.includes('function __slowLookLabelFill(')) {
  const labelStart = 'return{...e["c:txPr"]?{font:lf(e["c:txPr"],r,t)}:{},showValue:a("c:showVal")';
  if (source.split(labelStart).length !== 2) throw new Error('The Flyfish PPTX label parser changed; reassess label fills.');
  source = 'function __slowLookLabelFill(e,r){const f=e?.["c:spPr"]?.["a:solidFill"],v=f&&r?.(f);return /^(?:[\\da-f]{6}|[\\da-f]{8})$/i.test(String(v))?"#"+v:void 0}\n' +
    source.replace(labelStart, 'return{backgroundColor:__slowLookLabelFill(e,r),...e["c:txPr"]?{font:lf(e["c:txPr"],r,t)}:{},showValue:a("c:showVal")');
}
if (!source.startsWith(notice)) source = notice + source.replace(/^\/\* (?:SlowLook|QuickLook Fast) modified this Flyfish PPTX Worker:[^\n]*\*\/\n/, '');
fs.writeFileSync(worker, source);
console.log('Applied Flyfish PPTX text, shape, progressive-style and chart metadata repairs.');
