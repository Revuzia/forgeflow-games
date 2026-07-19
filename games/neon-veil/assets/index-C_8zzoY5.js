var cc=Object.defineProperty;var hc=(s,t,e)=>t in s?cc(s,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):s[t]=e;var T=(s,t,e)=>hc(s,typeof t!="symbol"?t+"":t,e);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))n(i);new MutationObserver(i=>{for(const r of i)if(r.type==="childList")for(const a of r.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&n(a)}).observe(document,{childList:!0,subtree:!0});function e(i){const r={};return i.integrity&&(r.integrity=i.integrity),i.referrerPolicy&&(r.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?r.credentials="include":i.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function n(i){if(i.ep)return;i.ep=!0;const r=e(i);fetch(i.href,r)}})();/**
 * @license
 * Copyright 2010-2024 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const Ca="170",uc=0,to=1,dc=2,Sl=1,fc=2,gn=3,Fn=0,Se=1,he=2,Dn=0,Ei=1,eo=2,no=3,io=4,pc=5,$n=100,mc=101,gc=102,_c=103,vc=104,xc=200,yc=201,Mc=202,Sc=203,kr=204,zr=205,Ec=206,wc=207,bc=208,Tc=209,Ac=210,Rc=211,Cc=212,Pc=213,Lc=214,Hr=0,Vr=1,Gr=2,Ti=3,Wr=4,Xr=5,qr=6,Yr=7,El=0,Ic=1,Dc=2,Un=0,Uc=1,Nc=2,Fc=3,wl=4,Oc=5,Bc=6,kc=7,bl=300,Ai=301,Ri=302,$r=303,Kr=304,Ks=306,jr=1e3,jn=1001,Zr=1002,We=1003,zc=1004,rs=1005,an=1006,nr=1007,Zn=1008,Mn=1009,Tl=1010,Al=1011,ts=1012,Pa=1013,Jn=1014,on=1015,ns=1016,La=1017,Ia=1018,Ci=1020,Rl=35902,Cl=1021,Pl=1022,nn=1023,Ll=1024,Il=1025,wi=1026,Pi=1027,Da=1028,Ua=1029,Dl=1030,Na=1031,Fa=1033,Fs=33776,Os=33777,Bs=33778,ks=33779,Jr=35840,Qr=35841,ta=35842,ea=35843,na=36196,ia=37492,sa=37496,ra=37808,aa=37809,oa=37810,la=37811,ca=37812,ha=37813,ua=37814,da=37815,fa=37816,pa=37817,ma=37818,ga=37819,_a=37820,va=37821,zs=36492,xa=36494,ya=36495,Ul=36283,Ma=36284,Sa=36285,Ea=36286,Hc=3200,Vc=3201,Nl=0,Gc=1,Ln="",Be="srgb",Ii="srgb-linear",js="linear",ee="srgb",ii=7680,so=519,Wc=512,Xc=513,qc=514,Fl=515,Yc=516,$c=517,Kc=518,jc=519,wa=35044,ro="300 es",vn=2e3,Vs=2001;class Di{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[t]===void 0&&(n[t]=[]),n[t].indexOf(e)===-1&&n[t].push(e)}hasEventListener(t,e){if(this._listeners===void 0)return!1;const n=this._listeners;return n[t]!==void 0&&n[t].indexOf(e)!==-1}removeEventListener(t,e){if(this._listeners===void 0)return;const i=this._listeners[t];if(i!==void 0){const r=i.indexOf(e);r!==-1&&i.splice(r,1)}}dispatchEvent(t){if(this._listeners===void 0)return;const n=this._listeners[t.type];if(n!==void 0){t.target=this;const i=n.slice(0);for(let r=0,a=i.length;r<a;r++)i[r].call(this,t);t.target=null}}}const we=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];let ao=1234567;const Zi=Math.PI/180,es=180/Math.PI;function xn(){const s=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(we[s&255]+we[s>>8&255]+we[s>>16&255]+we[s>>24&255]+"-"+we[t&255]+we[t>>8&255]+"-"+we[t>>16&15|64]+we[t>>24&255]+"-"+we[e&63|128]+we[e>>8&255]+"-"+we[e>>16&255]+we[e>>24&255]+we[n&255]+we[n>>8&255]+we[n>>16&255]+we[n>>24&255]).toLowerCase()}function Le(s,t,e){return Math.max(t,Math.min(e,s))}function Oa(s,t){return(s%t+t)%t}function Zc(s,t,e,n,i){return n+(s-t)*(i-n)/(e-t)}function Jc(s,t,e){return s!==t?(e-s)/(t-s):0}function Ji(s,t,e){return(1-e)*s+e*t}function Qc(s,t,e,n){return Ji(s,t,1-Math.exp(-e*n))}function th(s,t=1){return t-Math.abs(Oa(s,t*2)-t)}function eh(s,t,e){return s<=t?0:s>=e?1:(s=(s-t)/(e-t),s*s*(3-2*s))}function nh(s,t,e){return s<=t?0:s>=e?1:(s=(s-t)/(e-t),s*s*s*(s*(s*6-15)+10))}function ih(s,t){return s+Math.floor(Math.random()*(t-s+1))}function sh(s,t){return s+Math.random()*(t-s)}function rh(s){return s*(.5-Math.random())}function ah(s){s!==void 0&&(ao=s);let t=ao+=1831565813;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}function oh(s){return s*Zi}function lh(s){return s*es}function ch(s){return(s&s-1)===0&&s!==0}function hh(s){return Math.pow(2,Math.ceil(Math.log(s)/Math.LN2))}function uh(s){return Math.pow(2,Math.floor(Math.log(s)/Math.LN2))}function dh(s,t,e,n,i){const r=Math.cos,a=Math.sin,o=r(e/2),l=a(e/2),c=r((t+n)/2),h=a((t+n)/2),u=r((t-n)/2),f=a((t-n)/2),p=r((n-t)/2),g=a((n-t)/2);switch(i){case"XYX":s.set(o*h,l*u,l*f,o*c);break;case"YZY":s.set(l*f,o*h,l*u,o*c);break;case"ZXZ":s.set(l*u,l*f,o*h,o*c);break;case"XZX":s.set(o*h,l*g,l*p,o*c);break;case"YXY":s.set(l*p,o*h,l*g,o*c);break;case"ZYZ":s.set(l*g,l*p,o*h,o*c);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+i)}}function en(s,t){switch(t.constructor){case Float32Array:return s;case Uint32Array:return s/4294967295;case Uint16Array:return s/65535;case Uint8Array:return s/255;case Int32Array:return Math.max(s/2147483647,-1);case Int16Array:return Math.max(s/32767,-1);case Int8Array:return Math.max(s/127,-1);default:throw new Error("Invalid component type.")}}function Jt(s,t){switch(t.constructor){case Float32Array:return s;case Uint32Array:return Math.round(s*4294967295);case Uint16Array:return Math.round(s*65535);case Uint8Array:return Math.round(s*255);case Int32Array:return Math.round(s*2147483647);case Int16Array:return Math.round(s*32767);case Int8Array:return Math.round(s*127);default:throw new Error("Invalid component type.")}}const qt={DEG2RAD:Zi,RAD2DEG:es,generateUUID:xn,clamp:Le,euclideanModulo:Oa,mapLinear:Zc,inverseLerp:Jc,lerp:Ji,damp:Qc,pingpong:th,smoothstep:eh,smootherstep:nh,randInt:ih,randFloat:sh,randFloatSpread:rh,seededRandom:ah,degToRad:oh,radToDeg:lh,isPowerOfTwo:ch,ceilPowerOfTwo:hh,floorPowerOfTwo:uh,setQuaternionFromProperEuler:dh,normalize:Jt,denormalize:en};class Pt{constructor(t=0,e=0){Pt.prototype.isVector2=!0,this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){const e=this.x,n=this.y,i=t.elements;return this.x=i[0]*e+i[3]*n+i[6],this.y=i[1]*e+i[4]*n+i[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=Math.max(t.x,Math.min(e.x,this.x)),this.y=Math.max(t.y,Math.min(e.y,this.y)),this}clampScalar(t,e){return this.x=Math.max(t,Math.min(e,this.x)),this.y=Math.max(t,Math.min(e,this.y)),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(t,Math.min(e,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const n=this.dot(t)/e;return Math.acos(Le(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,n=this.y-t.y;return e*e+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){const n=Math.cos(e),i=Math.sin(e),r=this.x-t.x,a=this.y-t.y;return this.x=r*n-a*i+t.x,this.y=r*i+a*n+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class Ut{constructor(t,e,n,i,r,a,o,l,c){Ut.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,n,i,r,a,o,l,c)}set(t,e,n,i,r,a,o,l,c){const h=this.elements;return h[0]=t,h[1]=i,h[2]=o,h[3]=e,h[4]=r,h[5]=l,h[6]=n,h[7]=a,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){const e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],this}extractBasis(t,e,n){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(t){const e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const n=t.elements,i=e.elements,r=this.elements,a=n[0],o=n[3],l=n[6],c=n[1],h=n[4],u=n[7],f=n[2],p=n[5],g=n[8],_=i[0],m=i[3],d=i[6],S=i[1],w=i[4],v=i[7],I=i[2],A=i[5],R=i[8];return r[0]=a*_+o*S+l*I,r[3]=a*m+o*w+l*A,r[6]=a*d+o*v+l*R,r[1]=c*_+h*S+u*I,r[4]=c*m+h*w+u*A,r[7]=c*d+h*v+u*R,r[2]=f*_+p*S+g*I,r[5]=f*m+p*w+g*A,r[8]=f*d+p*v+g*R,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){const t=this.elements,e=t[0],n=t[1],i=t[2],r=t[3],a=t[4],o=t[5],l=t[6],c=t[7],h=t[8];return e*a*h-e*o*c-n*r*h+n*o*l+i*r*c-i*a*l}invert(){const t=this.elements,e=t[0],n=t[1],i=t[2],r=t[3],a=t[4],o=t[5],l=t[6],c=t[7],h=t[8],u=h*a-o*c,f=o*l-h*r,p=c*r-a*l,g=e*u+n*f+i*p;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);const _=1/g;return t[0]=u*_,t[1]=(i*c-h*n)*_,t[2]=(o*n-i*a)*_,t[3]=f*_,t[4]=(h*e-i*l)*_,t[5]=(i*r-o*e)*_,t[6]=p*_,t[7]=(n*l-c*e)*_,t[8]=(a*e-n*r)*_,this}transpose(){let t;const e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){const e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,n,i,r,a,o){const l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*a+c*o)+a+t,-i*c,i*l,-i*(-c*a+l*o)+o+e,0,0,1),this}scale(t,e){return this.premultiply(ir.makeScale(t,e)),this}rotate(t){return this.premultiply(ir.makeRotation(-t)),this}translate(t,e){return this.premultiply(ir.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,n,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){const e=this.elements,n=t.elements;for(let i=0;i<9;i++)if(e[i]!==n[i])return!1;return!0}fromArray(t,e=0){for(let n=0;n<9;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){const n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t}clone(){return new this.constructor().fromArray(this.elements)}}const ir=new Ut;function Ol(s){for(let t=s.length-1;t>=0;--t)if(s[t]>=65535)return!0;return!1}function Gs(s){return document.createElementNS("http://www.w3.org/1999/xhtml",s)}function fh(){const s=Gs("canvas");return s.style.display="block",s}const oo={};function Ki(s){s in oo||(oo[s]=!0,console.warn(s))}function ph(s,t,e){return new Promise(function(n,i){function r(){switch(s.clientWaitSync(t,s.SYNC_FLUSH_COMMANDS_BIT,0)){case s.WAIT_FAILED:i();break;case s.TIMEOUT_EXPIRED:setTimeout(r,e);break;default:n()}}setTimeout(r,e)})}function mh(s){const t=s.elements;t[2]=.5*t[2]+.5*t[3],t[6]=.5*t[6]+.5*t[7],t[10]=.5*t[10]+.5*t[11],t[14]=.5*t[14]+.5*t[15]}function gh(s){const t=s.elements;t[11]===-1?(t[10]=-t[10]-1,t[14]=-t[14]):(t[10]=-t[10],t[14]=-t[14]+1)}const Yt={enabled:!0,workingColorSpace:Ii,spaces:{},convert:function(s,t,e){return this.enabled===!1||t===e||!t||!e||(this.spaces[t].transfer===ee&&(s.r=yn(s.r),s.g=yn(s.g),s.b=yn(s.b)),this.spaces[t].primaries!==this.spaces[e].primaries&&(s.applyMatrix3(this.spaces[t].toXYZ),s.applyMatrix3(this.spaces[e].fromXYZ)),this.spaces[e].transfer===ee&&(s.r=bi(s.r),s.g=bi(s.g),s.b=bi(s.b))),s},fromWorkingColorSpace:function(s,t){return this.convert(s,this.workingColorSpace,t)},toWorkingColorSpace:function(s,t){return this.convert(s,t,this.workingColorSpace)},getPrimaries:function(s){return this.spaces[s].primaries},getTransfer:function(s){return s===Ln?js:this.spaces[s].transfer},getLuminanceCoefficients:function(s,t=this.workingColorSpace){return s.fromArray(this.spaces[t].luminanceCoefficients)},define:function(s){Object.assign(this.spaces,s)},_getMatrix:function(s,t,e){return s.copy(this.spaces[t].toXYZ).multiply(this.spaces[e].fromXYZ)},_getDrawingBufferColorSpace:function(s){return this.spaces[s].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(s=this.workingColorSpace){return this.spaces[s].workingColorSpaceConfig.unpackColorSpace}};function yn(s){return s<.04045?s*.0773993808:Math.pow(s*.9478672986+.0521327014,2.4)}function bi(s){return s<.0031308?s*12.92:1.055*Math.pow(s,.41666)-.055}const lo=[.64,.33,.3,.6,.15,.06],co=[.2126,.7152,.0722],ho=[.3127,.329],uo=new Ut().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),fo=new Ut().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);Yt.define({[Ii]:{primaries:lo,whitePoint:ho,transfer:js,toXYZ:uo,fromXYZ:fo,luminanceCoefficients:co,workingColorSpaceConfig:{unpackColorSpace:Be},outputColorSpaceConfig:{drawingBufferColorSpace:Be}},[Be]:{primaries:lo,whitePoint:ho,transfer:ee,toXYZ:uo,fromXYZ:fo,luminanceCoefficients:co,outputColorSpaceConfig:{drawingBufferColorSpace:Be}}});let si;class _h{static getDataURL(t){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let e;if(t instanceof HTMLCanvasElement)e=t;else{si===void 0&&(si=Gs("canvas")),si.width=t.width,si.height=t.height;const n=si.getContext("2d");t instanceof ImageData?n.putImageData(t,0,0):n.drawImage(t,0,0,t.width,t.height),e=si}return e.width>2048||e.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",t),e.toDataURL("image/jpeg",.6)):e.toDataURL("image/png")}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){const e=Gs("canvas");e.width=t.width,e.height=t.height;const n=e.getContext("2d");n.drawImage(t,0,0,t.width,t.height);const i=n.getImageData(0,0,t.width,t.height),r=i.data;for(let a=0;a<r.length;a++)r[a]=yn(r[a]/255)*255;return n.putImageData(i,0,0),e}else if(t.data){const e=t.data.slice(0);for(let n=0;n<e.length;n++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[n]=Math.floor(yn(e[n]/255)*255):e[n]=yn(e[n]);return{data:e,width:t.width,height:t.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}}let vh=0;class Bl{constructor(t=null){this.isSource=!0,Object.defineProperty(this,"id",{value:vh++}),this.uuid=xn(),this.data=t,this.dataReady=!0,this.version=0}set needsUpdate(t){t===!0&&this.version++}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];const n={uuid:this.uuid,url:""},i=this.data;if(i!==null){let r;if(Array.isArray(i)){r=[];for(let a=0,o=i.length;a<o;a++)i[a].isDataTexture?r.push(sr(i[a].image)):r.push(sr(i[a]))}else r=sr(i);n.url=r}return e||(t.images[this.uuid]=n),n}}function sr(s){return typeof HTMLImageElement<"u"&&s instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&s instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&s instanceof ImageBitmap?_h.getDataURL(s):s.data?{data:Array.from(s.data),width:s.width,height:s.height,type:s.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let xh=0;class Re extends Di{constructor(t=Re.DEFAULT_IMAGE,e=Re.DEFAULT_MAPPING,n=jn,i=jn,r=an,a=Zn,o=nn,l=Mn,c=Re.DEFAULT_ANISOTROPY,h=Ln){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:xh++}),this.uuid=xn(),this.name="",this.source=new Bl(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=n,this.wrapT=i,this.magFilter=r,this.minFilter=a,this.anisotropy=c,this.format=o,this.internalFormat=null,this.type=l,this.offset=new Pt(0,0),this.repeat=new Pt(1,1),this.center=new Pt(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Ut,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.pmremVersion=0}get image(){return this.source.data}set image(t=null){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];const n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),e||(t.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==bl)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case jr:t.x=t.x-Math.floor(t.x);break;case jn:t.x=t.x<0?0:1;break;case Zr:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case jr:t.y=t.y-Math.floor(t.y);break;case jn:t.y=t.y<0?0:1;break;case Zr:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}}Re.DEFAULT_IMAGE=null;Re.DEFAULT_MAPPING=bl;Re.DEFAULT_ANISOTROPY=1;class ne{constructor(t=0,e=0,n=0,i=1){ne.prototype.isVector4=!0,this.x=t,this.y=e,this.z=n,this.w=i}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,n,i){return this.x=t,this.y=e,this.z=n,this.w=i,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){const e=this.x,n=this.y,i=this.z,r=this.w,a=t.elements;return this.x=a[0]*e+a[4]*n+a[8]*i+a[12]*r,this.y=a[1]*e+a[5]*n+a[9]*i+a[13]*r,this.z=a[2]*e+a[6]*n+a[10]*i+a[14]*r,this.w=a[3]*e+a[7]*n+a[11]*i+a[15]*r,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);const e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,n,i,r;const l=t.elements,c=l[0],h=l[4],u=l[8],f=l[1],p=l[5],g=l[9],_=l[2],m=l[6],d=l[10];if(Math.abs(h-f)<.01&&Math.abs(u-_)<.01&&Math.abs(g-m)<.01){if(Math.abs(h+f)<.1&&Math.abs(u+_)<.1&&Math.abs(g+m)<.1&&Math.abs(c+p+d-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;const w=(c+1)/2,v=(p+1)/2,I=(d+1)/2,A=(h+f)/4,R=(u+_)/4,L=(g+m)/4;return w>v&&w>I?w<.01?(n=0,i=.707106781,r=.707106781):(n=Math.sqrt(w),i=A/n,r=R/n):v>I?v<.01?(n=.707106781,i=0,r=.707106781):(i=Math.sqrt(v),n=A/i,r=L/i):I<.01?(n=.707106781,i=.707106781,r=0):(r=Math.sqrt(I),n=R/r,i=L/r),this.set(n,i,r,e),this}let S=Math.sqrt((m-g)*(m-g)+(u-_)*(u-_)+(f-h)*(f-h));return Math.abs(S)<.001&&(S=1),this.x=(m-g)/S,this.y=(u-_)/S,this.z=(f-h)/S,this.w=Math.acos((c+p+d-1)/2),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=Math.max(t.x,Math.min(e.x,this.x)),this.y=Math.max(t.y,Math.min(e.y,this.y)),this.z=Math.max(t.z,Math.min(e.z,this.z)),this.w=Math.max(t.w,Math.min(e.w,this.w)),this}clampScalar(t,e){return this.x=Math.max(t,Math.min(e,this.x)),this.y=Math.max(t,Math.min(e,this.y)),this.z=Math.max(t,Math.min(e,this.z)),this.w=Math.max(t,Math.min(e,this.w)),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(t,Math.min(e,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this.w=t.w+(e.w-t.w)*n,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class yh extends Di{constructor(t=1,e=1,n={}){super(),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=1,this.scissor=new ne(0,0,t,e),this.scissorTest=!1,this.viewport=new ne(0,0,t,e);const i={width:t,height:e,depth:1};n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:an,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1},n);const r=new Re(i,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace);r.flipY=!1,r.generateMipmaps=n.generateMipmaps,r.internalFormat=n.internalFormat,this.textures=[];const a=n.count;for(let o=0;o<a;o++)this.textures[o]=r.clone(),this.textures[o].isRenderTargetTexture=!0;this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.depthTexture=n.depthTexture,this.samples=n.samples}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}setSize(t,e,n=1){if(this.width!==t||this.height!==e||this.depth!==n){this.width=t,this.height=e,this.depth=n;for(let i=0,r=this.textures.length;i<r;i++)this.textures[i].image.width=t,this.textures[i].image.height=e,this.textures[i].image.depth=n;this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let n=0,i=t.textures.length;n<i;n++)this.textures[n]=t.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0;const e=Object.assign({},t.texture.image);return this.texture.source=new Bl(e),this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,t.depthTexture!==null&&(this.depthTexture=t.depthTexture.clone()),this.samples=t.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class Sn extends yh{constructor(t=1,e=1,n={}){super(t,e,n),this.isWebGLRenderTarget=!0}}class kl extends Re{constructor(t=null,e=1,n=1,i=1){super(null),this.isDataArrayTexture=!0,this.image={data:t,width:e,height:n,depth:i},this.magFilter=We,this.minFilter=We,this.wrapR=jn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}}class Mh extends Re{constructor(t=null,e=1,n=1,i=1){super(null),this.isData3DTexture=!0,this.image={data:t,width:e,height:n,depth:i},this.magFilter=We,this.minFilter=We,this.wrapR=jn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class ln{constructor(t=0,e=0,n=0,i=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=n,this._w=i}static slerpFlat(t,e,n,i,r,a,o){let l=n[i+0],c=n[i+1],h=n[i+2],u=n[i+3];const f=r[a+0],p=r[a+1],g=r[a+2],_=r[a+3];if(o===0){t[e+0]=l,t[e+1]=c,t[e+2]=h,t[e+3]=u;return}if(o===1){t[e+0]=f,t[e+1]=p,t[e+2]=g,t[e+3]=_;return}if(u!==_||l!==f||c!==p||h!==g){let m=1-o;const d=l*f+c*p+h*g+u*_,S=d>=0?1:-1,w=1-d*d;if(w>Number.EPSILON){const I=Math.sqrt(w),A=Math.atan2(I,d*S);m=Math.sin(m*A)/I,o=Math.sin(o*A)/I}const v=o*S;if(l=l*m+f*v,c=c*m+p*v,h=h*m+g*v,u=u*m+_*v,m===1-o){const I=1/Math.sqrt(l*l+c*c+h*h+u*u);l*=I,c*=I,h*=I,u*=I}}t[e]=l,t[e+1]=c,t[e+2]=h,t[e+3]=u}static multiplyQuaternionsFlat(t,e,n,i,r,a){const o=n[i],l=n[i+1],c=n[i+2],h=n[i+3],u=r[a],f=r[a+1],p=r[a+2],g=r[a+3];return t[e]=o*g+h*u+l*p-c*f,t[e+1]=l*g+h*f+c*u-o*p,t[e+2]=c*g+h*p+o*f-l*u,t[e+3]=h*g-o*u-l*f-c*p,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,n,i){return this._x=t,this._y=e,this._z=n,this._w=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){const n=t._x,i=t._y,r=t._z,a=t._order,o=Math.cos,l=Math.sin,c=o(n/2),h=o(i/2),u=o(r/2),f=l(n/2),p=l(i/2),g=l(r/2);switch(a){case"XYZ":this._x=f*h*u+c*p*g,this._y=c*p*u-f*h*g,this._z=c*h*g+f*p*u,this._w=c*h*u-f*p*g;break;case"YXZ":this._x=f*h*u+c*p*g,this._y=c*p*u-f*h*g,this._z=c*h*g-f*p*u,this._w=c*h*u+f*p*g;break;case"ZXY":this._x=f*h*u-c*p*g,this._y=c*p*u+f*h*g,this._z=c*h*g+f*p*u,this._w=c*h*u-f*p*g;break;case"ZYX":this._x=f*h*u-c*p*g,this._y=c*p*u+f*h*g,this._z=c*h*g-f*p*u,this._w=c*h*u+f*p*g;break;case"YZX":this._x=f*h*u+c*p*g,this._y=c*p*u+f*h*g,this._z=c*h*g-f*p*u,this._w=c*h*u-f*p*g;break;case"XZY":this._x=f*h*u-c*p*g,this._y=c*p*u-f*h*g,this._z=c*h*g+f*p*u,this._w=c*h*u+f*p*g;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+a)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){const n=e/2,i=Math.sin(n);return this._x=t.x*i,this._y=t.y*i,this._z=t.z*i,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(t){const e=t.elements,n=e[0],i=e[4],r=e[8],a=e[1],o=e[5],l=e[9],c=e[2],h=e[6],u=e[10],f=n+o+u;if(f>0){const p=.5/Math.sqrt(f+1);this._w=.25/p,this._x=(h-l)*p,this._y=(r-c)*p,this._z=(a-i)*p}else if(n>o&&n>u){const p=2*Math.sqrt(1+n-o-u);this._w=(h-l)/p,this._x=.25*p,this._y=(i+a)/p,this._z=(r+c)/p}else if(o>u){const p=2*Math.sqrt(1+o-n-u);this._w=(r-c)/p,this._x=(i+a)/p,this._y=.25*p,this._z=(l+h)/p}else{const p=2*Math.sqrt(1+u-n-o);this._w=(a-i)/p,this._x=(r+c)/p,this._y=(l+h)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let n=t.dot(e)+1;return n<Number.EPSILON?(n=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=n):(this._x=0,this._y=-t.z,this._z=t.y,this._w=n)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=n),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs(Le(this.dot(t),-1,1)))}rotateTowards(t,e){const n=this.angleTo(t);if(n===0)return this;const i=Math.min(1,e/n);return this.slerp(t,i),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){const n=t._x,i=t._y,r=t._z,a=t._w,o=e._x,l=e._y,c=e._z,h=e._w;return this._x=n*h+a*o+i*c-r*l,this._y=i*h+a*l+r*o-n*c,this._z=r*h+a*c+n*l-i*o,this._w=a*h-n*o-i*l-r*c,this._onChangeCallback(),this}slerp(t,e){if(e===0)return this;if(e===1)return this.copy(t);const n=this._x,i=this._y,r=this._z,a=this._w;let o=a*t._w+n*t._x+i*t._y+r*t._z;if(o<0?(this._w=-t._w,this._x=-t._x,this._y=-t._y,this._z=-t._z,o=-o):this.copy(t),o>=1)return this._w=a,this._x=n,this._y=i,this._z=r,this;const l=1-o*o;if(l<=Number.EPSILON){const p=1-e;return this._w=p*a+e*this._w,this._x=p*n+e*this._x,this._y=p*i+e*this._y,this._z=p*r+e*this._z,this.normalize(),this}const c=Math.sqrt(l),h=Math.atan2(c,o),u=Math.sin((1-e)*h)/c,f=Math.sin(e*h)/c;return this._w=a*u+this._w*f,this._x=n*u+this._x*f,this._y=i*u+this._y*f,this._z=r*u+this._z*f,this._onChangeCallback(),this}slerpQuaternions(t,e,n){return this.copy(t).slerp(e,n)}random(){const t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),n=Math.random(),i=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(i*Math.sin(t),i*Math.cos(t),r*Math.sin(e),r*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class C{constructor(t=0,e=0,n=0){C.prototype.isVector3=!0,this.x=t,this.y=e,this.z=n}set(t,e,n){return n===void 0&&(n=this.z),this.x=t,this.y=e,this.z=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(po.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(po.setFromAxisAngle(t,e))}applyMatrix3(t){const e=this.x,n=this.y,i=this.z,r=t.elements;return this.x=r[0]*e+r[3]*n+r[6]*i,this.y=r[1]*e+r[4]*n+r[7]*i,this.z=r[2]*e+r[5]*n+r[8]*i,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){const e=this.x,n=this.y,i=this.z,r=t.elements,a=1/(r[3]*e+r[7]*n+r[11]*i+r[15]);return this.x=(r[0]*e+r[4]*n+r[8]*i+r[12])*a,this.y=(r[1]*e+r[5]*n+r[9]*i+r[13])*a,this.z=(r[2]*e+r[6]*n+r[10]*i+r[14])*a,this}applyQuaternion(t){const e=this.x,n=this.y,i=this.z,r=t.x,a=t.y,o=t.z,l=t.w,c=2*(a*i-o*n),h=2*(o*e-r*i),u=2*(r*n-a*e);return this.x=e+l*c+a*u-o*h,this.y=n+l*h+o*c-r*u,this.z=i+l*u+r*h-a*c,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){const e=this.x,n=this.y,i=this.z,r=t.elements;return this.x=r[0]*e+r[4]*n+r[8]*i,this.y=r[1]*e+r[5]*n+r[9]*i,this.z=r[2]*e+r[6]*n+r[10]*i,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=Math.max(t.x,Math.min(e.x,this.x)),this.y=Math.max(t.y,Math.min(e.y,this.y)),this.z=Math.max(t.z,Math.min(e.z,this.z)),this}clampScalar(t,e){return this.x=Math.max(t,Math.min(e,this.x)),this.y=Math.max(t,Math.min(e,this.y)),this.z=Math.max(t,Math.min(e,this.z)),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(t,Math.min(e,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){const n=t.x,i=t.y,r=t.z,a=e.x,o=e.y,l=e.z;return this.x=i*l-r*o,this.y=r*a-n*l,this.z=n*o-i*a,this}projectOnVector(t){const e=t.lengthSq();if(e===0)return this.set(0,0,0);const n=t.dot(this)/e;return this.copy(t).multiplyScalar(n)}projectOnPlane(t){return rr.copy(this).projectOnVector(t),this.sub(rr)}reflect(t){return this.sub(rr.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const n=this.dot(t)/e;return Math.acos(Le(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,n=this.y-t.y,i=this.z-t.z;return e*e+n*n+i*i}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,n){const i=Math.sin(e)*t;return this.x=i*Math.sin(n),this.y=Math.cos(e)*t,this.z=i*Math.cos(n),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,n){return this.x=t*Math.sin(e),this.y=n,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){const e=this.setFromMatrixColumn(t,0).length(),n=this.setFromMatrixColumn(t,1).length(),i=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=n,this.z=i,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const t=Math.random()*Math.PI*2,e=Math.random()*2-1,n=Math.sqrt(1-e*e);return this.x=n*Math.cos(t),this.y=e,this.z=n*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const rr=new C,po=new ln;class ti{constructor(t=new C(1/0,1/0,1/0),e=new C(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e+=3)this.expandByPoint(Ze.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,n=t.count;e<n;e++)this.expandByPoint(Ze.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){const n=Ze.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(n),this.max.copy(t).add(n),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);const n=t.geometry;if(n!==void 0){const r=n.getAttribute("position");if(e===!0&&r!==void 0&&t.isInstancedMesh!==!0)for(let a=0,o=r.count;a<o;a++)t.isMesh===!0?t.getVertexPosition(a,Ze):Ze.fromBufferAttribute(r,a),Ze.applyMatrix4(t.matrixWorld),this.expandByPoint(Ze);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),as.copy(t.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),as.copy(n.boundingBox)),as.applyMatrix4(t.matrixWorld),this.union(as)}const i=t.children;for(let r=0,a=i.length;r<a;r++)this.expandByObject(i[r],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,Ze),Ze.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,n;return t.normal.x>0?(e=t.normal.x*this.min.x,n=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,n=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,n+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,n+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,n+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,n+=t.normal.z*this.min.z),e<=-t.constant&&n>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(Oi),os.subVectors(this.max,Oi),ri.subVectors(t.a,Oi),ai.subVectors(t.b,Oi),oi.subVectors(t.c,Oi),bn.subVectors(ai,ri),Tn.subVectors(oi,ai),zn.subVectors(ri,oi);let e=[0,-bn.z,bn.y,0,-Tn.z,Tn.y,0,-zn.z,zn.y,bn.z,0,-bn.x,Tn.z,0,-Tn.x,zn.z,0,-zn.x,-bn.y,bn.x,0,-Tn.y,Tn.x,0,-zn.y,zn.x,0];return!ar(e,ri,ai,oi,os)||(e=[1,0,0,0,1,0,0,0,1],!ar(e,ri,ai,oi,os))?!1:(ls.crossVectors(bn,Tn),e=[ls.x,ls.y,ls.z],ar(e,ri,ai,oi,os))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,Ze).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(Ze).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(un[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),un[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),un[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),un[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),un[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),un[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),un[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),un[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(un),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}}const un=[new C,new C,new C,new C,new C,new C,new C,new C],Ze=new C,as=new ti,ri=new C,ai=new C,oi=new C,bn=new C,Tn=new C,zn=new C,Oi=new C,os=new C,ls=new C,Hn=new C;function ar(s,t,e,n,i){for(let r=0,a=s.length-3;r<=a;r+=3){Hn.fromArray(s,r);const o=i.x*Math.abs(Hn.x)+i.y*Math.abs(Hn.y)+i.z*Math.abs(Hn.z),l=t.dot(Hn),c=e.dot(Hn),h=n.dot(Hn);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>o)return!1}return!0}const Sh=new ti,Bi=new C,or=new C;class ei{constructor(t=new C,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){const n=this.center;e!==void 0?n.copy(e):Sh.setFromPoints(t).getCenter(n);let i=0;for(let r=0,a=t.length;r<a;r++)i=Math.max(i,n.distanceToSquared(t[r]));return this.radius=Math.sqrt(i),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){const e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){const n=this.center.distanceToSquared(t);return e.copy(t),n>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;Bi.subVectors(t,this.center);const e=Bi.lengthSq();if(e>this.radius*this.radius){const n=Math.sqrt(e),i=(n-this.radius)*.5;this.center.addScaledVector(Bi,i/n),this.radius+=i}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(or.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(Bi.copy(t.center).add(or)),this.expandByPoint(Bi.copy(t.center).sub(or))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}}const dn=new C,lr=new C,cs=new C,An=new C,cr=new C,hs=new C,hr=new C;class Ba{constructor(t=new C,e=new C(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,dn)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);const n=e.dot(this.direction);return n<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){const e=dn.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(dn.copy(this.origin).addScaledVector(this.direction,e),dn.distanceToSquared(t))}distanceSqToSegment(t,e,n,i){lr.copy(t).add(e).multiplyScalar(.5),cs.copy(e).sub(t).normalize(),An.copy(this.origin).sub(lr);const r=t.distanceTo(e)*.5,a=-this.direction.dot(cs),o=An.dot(this.direction),l=-An.dot(cs),c=An.lengthSq(),h=Math.abs(1-a*a);let u,f,p,g;if(h>0)if(u=a*l-o,f=a*o-l,g=r*h,u>=0)if(f>=-g)if(f<=g){const _=1/h;u*=_,f*=_,p=u*(u+a*f+2*o)+f*(a*u+f+2*l)+c}else f=r,u=Math.max(0,-(a*f+o)),p=-u*u+f*(f+2*l)+c;else f=-r,u=Math.max(0,-(a*f+o)),p=-u*u+f*(f+2*l)+c;else f<=-g?(u=Math.max(0,-(-a*r+o)),f=u>0?-r:Math.min(Math.max(-r,-l),r),p=-u*u+f*(f+2*l)+c):f<=g?(u=0,f=Math.min(Math.max(-r,-l),r),p=f*(f+2*l)+c):(u=Math.max(0,-(a*r+o)),f=u>0?r:Math.min(Math.max(-r,-l),r),p=-u*u+f*(f+2*l)+c);else f=a>0?-r:r,u=Math.max(0,-(a*f+o)),p=-u*u+f*(f+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,u),i&&i.copy(lr).addScaledVector(cs,f),p}intersectSphere(t,e){dn.subVectors(t.center,this.origin);const n=dn.dot(this.direction),i=dn.dot(dn)-n*n,r=t.radius*t.radius;if(i>r)return null;const a=Math.sqrt(r-i),o=n-a,l=n+a;return l<0?null:o<0?this.at(l,e):this.at(o,e)}intersectsSphere(t){return this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){const e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(t.normal)+t.constant)/e;return n>=0?n:null}intersectPlane(t,e){const n=this.distanceToPlane(t);return n===null?null:this.at(n,e)}intersectsPlane(t){const e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let n,i,r,a,o,l;const c=1/this.direction.x,h=1/this.direction.y,u=1/this.direction.z,f=this.origin;return c>=0?(n=(t.min.x-f.x)*c,i=(t.max.x-f.x)*c):(n=(t.max.x-f.x)*c,i=(t.min.x-f.x)*c),h>=0?(r=(t.min.y-f.y)*h,a=(t.max.y-f.y)*h):(r=(t.max.y-f.y)*h,a=(t.min.y-f.y)*h),n>a||r>i||((r>n||isNaN(n))&&(n=r),(a<i||isNaN(i))&&(i=a),u>=0?(o=(t.min.z-f.z)*u,l=(t.max.z-f.z)*u):(o=(t.max.z-f.z)*u,l=(t.min.z-f.z)*u),n>l||o>i)||((o>n||n!==n)&&(n=o),(l<i||i!==i)&&(i=l),i<0)?null:this.at(n>=0?n:i,e)}intersectsBox(t){return this.intersectBox(t,dn)!==null}intersectTriangle(t,e,n,i,r){cr.subVectors(e,t),hs.subVectors(n,t),hr.crossVectors(cr,hs);let a=this.direction.dot(hr),o;if(a>0){if(i)return null;o=1}else if(a<0)o=-1,a=-a;else return null;An.subVectors(this.origin,t);const l=o*this.direction.dot(hs.crossVectors(An,hs));if(l<0)return null;const c=o*this.direction.dot(cr.cross(An));if(c<0||l+c>a)return null;const h=-o*An.dot(hr);return h<0?null:this.at(h/a,r)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class te{constructor(t,e,n,i,r,a,o,l,c,h,u,f,p,g,_,m){te.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,n,i,r,a,o,l,c,h,u,f,p,g,_,m)}set(t,e,n,i,r,a,o,l,c,h,u,f,p,g,_,m){const d=this.elements;return d[0]=t,d[4]=e,d[8]=n,d[12]=i,d[1]=r,d[5]=a,d[9]=o,d[13]=l,d[2]=c,d[6]=h,d[10]=u,d[14]=f,d[3]=p,d[7]=g,d[11]=_,d[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new te().fromArray(this.elements)}copy(t){const e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],e[9]=n[9],e[10]=n[10],e[11]=n[11],e[12]=n[12],e[13]=n[13],e[14]=n[14],e[15]=n[15],this}copyPosition(t){const e=this.elements,n=t.elements;return e[12]=n[12],e[13]=n[13],e[14]=n[14],this}setFromMatrix3(t){const e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,n){return t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(t,e,n){return this.set(t.x,e.x,n.x,0,t.y,e.y,n.y,0,t.z,e.z,n.z,0,0,0,0,1),this}extractRotation(t){const e=this.elements,n=t.elements,i=1/li.setFromMatrixColumn(t,0).length(),r=1/li.setFromMatrixColumn(t,1).length(),a=1/li.setFromMatrixColumn(t,2).length();return e[0]=n[0]*i,e[1]=n[1]*i,e[2]=n[2]*i,e[3]=0,e[4]=n[4]*r,e[5]=n[5]*r,e[6]=n[6]*r,e[7]=0,e[8]=n[8]*a,e[9]=n[9]*a,e[10]=n[10]*a,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){const e=this.elements,n=t.x,i=t.y,r=t.z,a=Math.cos(n),o=Math.sin(n),l=Math.cos(i),c=Math.sin(i),h=Math.cos(r),u=Math.sin(r);if(t.order==="XYZ"){const f=a*h,p=a*u,g=o*h,_=o*u;e[0]=l*h,e[4]=-l*u,e[8]=c,e[1]=p+g*c,e[5]=f-_*c,e[9]=-o*l,e[2]=_-f*c,e[6]=g+p*c,e[10]=a*l}else if(t.order==="YXZ"){const f=l*h,p=l*u,g=c*h,_=c*u;e[0]=f+_*o,e[4]=g*o-p,e[8]=a*c,e[1]=a*u,e[5]=a*h,e[9]=-o,e[2]=p*o-g,e[6]=_+f*o,e[10]=a*l}else if(t.order==="ZXY"){const f=l*h,p=l*u,g=c*h,_=c*u;e[0]=f-_*o,e[4]=-a*u,e[8]=g+p*o,e[1]=p+g*o,e[5]=a*h,e[9]=_-f*o,e[2]=-a*c,e[6]=o,e[10]=a*l}else if(t.order==="ZYX"){const f=a*h,p=a*u,g=o*h,_=o*u;e[0]=l*h,e[4]=g*c-p,e[8]=f*c+_,e[1]=l*u,e[5]=_*c+f,e[9]=p*c-g,e[2]=-c,e[6]=o*l,e[10]=a*l}else if(t.order==="YZX"){const f=a*l,p=a*c,g=o*l,_=o*c;e[0]=l*h,e[4]=_-f*u,e[8]=g*u+p,e[1]=u,e[5]=a*h,e[9]=-o*h,e[2]=-c*h,e[6]=p*u+g,e[10]=f-_*u}else if(t.order==="XZY"){const f=a*l,p=a*c,g=o*l,_=o*c;e[0]=l*h,e[4]=-u,e[8]=c*h,e[1]=f*u+_,e[5]=a*h,e[9]=p*u-g,e[2]=g*u-p,e[6]=o*h,e[10]=_*u+f}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(Eh,t,wh)}lookAt(t,e,n){const i=this.elements;return Ve.subVectors(t,e),Ve.lengthSq()===0&&(Ve.z=1),Ve.normalize(),Rn.crossVectors(n,Ve),Rn.lengthSq()===0&&(Math.abs(n.z)===1?Ve.x+=1e-4:Ve.z+=1e-4,Ve.normalize(),Rn.crossVectors(n,Ve)),Rn.normalize(),us.crossVectors(Ve,Rn),i[0]=Rn.x,i[4]=us.x,i[8]=Ve.x,i[1]=Rn.y,i[5]=us.y,i[9]=Ve.y,i[2]=Rn.z,i[6]=us.z,i[10]=Ve.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const n=t.elements,i=e.elements,r=this.elements,a=n[0],o=n[4],l=n[8],c=n[12],h=n[1],u=n[5],f=n[9],p=n[13],g=n[2],_=n[6],m=n[10],d=n[14],S=n[3],w=n[7],v=n[11],I=n[15],A=i[0],R=i[4],L=i[8],E=i[12],y=i[1],P=i[5],H=i[9],B=i[13],V=i[2],q=i[6],G=i[10],J=i[14],W=i[3],rt=i[7],ut=i[11],Mt=i[15];return r[0]=a*A+o*y+l*V+c*W,r[4]=a*R+o*P+l*q+c*rt,r[8]=a*L+o*H+l*G+c*ut,r[12]=a*E+o*B+l*J+c*Mt,r[1]=h*A+u*y+f*V+p*W,r[5]=h*R+u*P+f*q+p*rt,r[9]=h*L+u*H+f*G+p*ut,r[13]=h*E+u*B+f*J+p*Mt,r[2]=g*A+_*y+m*V+d*W,r[6]=g*R+_*P+m*q+d*rt,r[10]=g*L+_*H+m*G+d*ut,r[14]=g*E+_*B+m*J+d*Mt,r[3]=S*A+w*y+v*V+I*W,r[7]=S*R+w*P+v*q+I*rt,r[11]=S*L+w*H+v*G+I*ut,r[15]=S*E+w*B+v*J+I*Mt,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){const t=this.elements,e=t[0],n=t[4],i=t[8],r=t[12],a=t[1],o=t[5],l=t[9],c=t[13],h=t[2],u=t[6],f=t[10],p=t[14],g=t[3],_=t[7],m=t[11],d=t[15];return g*(+r*l*u-i*c*u-r*o*f+n*c*f+i*o*p-n*l*p)+_*(+e*l*p-e*c*f+r*a*f-i*a*p+i*c*h-r*l*h)+m*(+e*c*u-e*o*p-r*a*u+n*a*p+r*o*h-n*c*h)+d*(-i*o*h-e*l*u+e*o*f+i*a*u-n*a*f+n*l*h)}transpose(){const t=this.elements;let e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,n){const i=this.elements;return t.isVector3?(i[12]=t.x,i[13]=t.y,i[14]=t.z):(i[12]=t,i[13]=e,i[14]=n),this}invert(){const t=this.elements,e=t[0],n=t[1],i=t[2],r=t[3],a=t[4],o=t[5],l=t[6],c=t[7],h=t[8],u=t[9],f=t[10],p=t[11],g=t[12],_=t[13],m=t[14],d=t[15],S=u*m*c-_*f*c+_*l*p-o*m*p-u*l*d+o*f*d,w=g*f*c-h*m*c-g*l*p+a*m*p+h*l*d-a*f*d,v=h*_*c-g*u*c+g*o*p-a*_*p-h*o*d+a*u*d,I=g*u*l-h*_*l-g*o*f+a*_*f+h*o*m-a*u*m,A=e*S+n*w+i*v+r*I;if(A===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const R=1/A;return t[0]=S*R,t[1]=(_*f*r-u*m*r-_*i*p+n*m*p+u*i*d-n*f*d)*R,t[2]=(o*m*r-_*l*r+_*i*c-n*m*c-o*i*d+n*l*d)*R,t[3]=(u*l*r-o*f*r-u*i*c+n*f*c+o*i*p-n*l*p)*R,t[4]=w*R,t[5]=(h*m*r-g*f*r+g*i*p-e*m*p-h*i*d+e*f*d)*R,t[6]=(g*l*r-a*m*r-g*i*c+e*m*c+a*i*d-e*l*d)*R,t[7]=(a*f*r-h*l*r+h*i*c-e*f*c-a*i*p+e*l*p)*R,t[8]=v*R,t[9]=(g*u*r-h*_*r-g*n*p+e*_*p+h*n*d-e*u*d)*R,t[10]=(a*_*r-g*o*r+g*n*c-e*_*c-a*n*d+e*o*d)*R,t[11]=(h*o*r-a*u*r-h*n*c+e*u*c+a*n*p-e*o*p)*R,t[12]=I*R,t[13]=(h*_*i-g*u*i+g*n*f-e*_*f-h*n*m+e*u*m)*R,t[14]=(g*o*i-a*_*i-g*n*l+e*_*l+a*n*m-e*o*m)*R,t[15]=(a*u*i-h*o*i+h*n*l-e*u*l-a*n*f+e*o*f)*R,this}scale(t){const e=this.elements,n=t.x,i=t.y,r=t.z;return e[0]*=n,e[4]*=i,e[8]*=r,e[1]*=n,e[5]*=i,e[9]*=r,e[2]*=n,e[6]*=i,e[10]*=r,e[3]*=n,e[7]*=i,e[11]*=r,this}getMaxScaleOnAxis(){const t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],n=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],i=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,n,i))}makeTranslation(t,e,n){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,n,0,0,0,1),this}makeRotationX(t){const e=Math.cos(t),n=Math.sin(t);return this.set(1,0,0,0,0,e,-n,0,0,n,e,0,0,0,0,1),this}makeRotationY(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,0,n,0,0,1,0,0,-n,0,e,0,0,0,0,1),this}makeRotationZ(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,0,n,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){const n=Math.cos(e),i=Math.sin(e),r=1-n,a=t.x,o=t.y,l=t.z,c=r*a,h=r*o;return this.set(c*a+n,c*o-i*l,c*l+i*o,0,c*o+i*l,h*o+n,h*l-i*a,0,c*l-i*o,h*l+i*a,r*l*l+n,0,0,0,0,1),this}makeScale(t,e,n){return this.set(t,0,0,0,0,e,0,0,0,0,n,0,0,0,0,1),this}makeShear(t,e,n,i,r,a){return this.set(1,n,r,0,t,1,a,0,e,i,1,0,0,0,0,1),this}compose(t,e,n){const i=this.elements,r=e._x,a=e._y,o=e._z,l=e._w,c=r+r,h=a+a,u=o+o,f=r*c,p=r*h,g=r*u,_=a*h,m=a*u,d=o*u,S=l*c,w=l*h,v=l*u,I=n.x,A=n.y,R=n.z;return i[0]=(1-(_+d))*I,i[1]=(p+v)*I,i[2]=(g-w)*I,i[3]=0,i[4]=(p-v)*A,i[5]=(1-(f+d))*A,i[6]=(m+S)*A,i[7]=0,i[8]=(g+w)*R,i[9]=(m-S)*R,i[10]=(1-(f+_))*R,i[11]=0,i[12]=t.x,i[13]=t.y,i[14]=t.z,i[15]=1,this}decompose(t,e,n){const i=this.elements;let r=li.set(i[0],i[1],i[2]).length();const a=li.set(i[4],i[5],i[6]).length(),o=li.set(i[8],i[9],i[10]).length();this.determinant()<0&&(r=-r),t.x=i[12],t.y=i[13],t.z=i[14],Je.copy(this);const c=1/r,h=1/a,u=1/o;return Je.elements[0]*=c,Je.elements[1]*=c,Je.elements[2]*=c,Je.elements[4]*=h,Je.elements[5]*=h,Je.elements[6]*=h,Je.elements[8]*=u,Je.elements[9]*=u,Je.elements[10]*=u,e.setFromRotationMatrix(Je),n.x=r,n.y=a,n.z=o,this}makePerspective(t,e,n,i,r,a,o=vn){const l=this.elements,c=2*r/(e-t),h=2*r/(n-i),u=(e+t)/(e-t),f=(n+i)/(n-i);let p,g;if(o===vn)p=-(a+r)/(a-r),g=-2*a*r/(a-r);else if(o===Vs)p=-a/(a-r),g=-a*r/(a-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return l[0]=c,l[4]=0,l[8]=u,l[12]=0,l[1]=0,l[5]=h,l[9]=f,l[13]=0,l[2]=0,l[6]=0,l[10]=p,l[14]=g,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(t,e,n,i,r,a,o=vn){const l=this.elements,c=1/(e-t),h=1/(n-i),u=1/(a-r),f=(e+t)*c,p=(n+i)*h;let g,_;if(o===vn)g=(a+r)*u,_=-2*u;else if(o===Vs)g=r*u,_=-1*u;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return l[0]=2*c,l[4]=0,l[8]=0,l[12]=-f,l[1]=0,l[5]=2*h,l[9]=0,l[13]=-p,l[2]=0,l[6]=0,l[10]=_,l[14]=-g,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(t){const e=this.elements,n=t.elements;for(let i=0;i<16;i++)if(e[i]!==n[i])return!1;return!0}fromArray(t,e=0){for(let n=0;n<16;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){const n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t[e+9]=n[9],t[e+10]=n[10],t[e+11]=n[11],t[e+12]=n[12],t[e+13]=n[13],t[e+14]=n[14],t[e+15]=n[15],t}}const li=new C,Je=new te,Eh=new C(0,0,0),wh=new C(1,1,1),Rn=new C,us=new C,Ve=new C,mo=new te,go=new ln;class ze{constructor(t=0,e=0,n=0,i=ze.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=n,this._order=i}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,n,i=this._order){return this._x=t,this._y=e,this._z=n,this._order=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,n=!0){const i=t.elements,r=i[0],a=i[4],o=i[8],l=i[1],c=i[5],h=i[9],u=i[2],f=i[6],p=i[10];switch(e){case"XYZ":this._y=Math.asin(Le(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-h,p),this._z=Math.atan2(-a,r)):(this._x=Math.atan2(f,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Le(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(o,p),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-u,r),this._z=0);break;case"ZXY":this._x=Math.asin(Le(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(-u,p),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-Le(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(f,p),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-a,c));break;case"YZX":this._z=Math.asin(Le(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-u,r)):(this._x=0,this._y=Math.atan2(o,p));break;case"XZY":this._z=Math.asin(-Le(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(f,c),this._y=Math.atan2(o,r)):(this._x=Math.atan2(-h,p),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,n===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,n){return mo.makeRotationFromQuaternion(t),this.setFromRotationMatrix(mo,e,n)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return go.setFromEuler(this),this.setFromQuaternion(go,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}ze.DEFAULT_ORDER="XYZ";class zl{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}}let bh=0;const _o=new C,ci=new ln,fn=new te,ds=new C,ki=new C,Th=new C,Ah=new ln,vo=new C(1,0,0),xo=new C(0,1,0),yo=new C(0,0,1),Mo={type:"added"},Rh={type:"removed"},hi={type:"childadded",child:null},ur={type:"childremoved",child:null};class Qt extends Di{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:bh++}),this.uuid=xn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=Qt.DEFAULT_UP.clone();const t=new C,e=new ze,n=new ln,i=new C(1,1,1);function r(){n.setFromEuler(e,!1)}function a(){e.setFromQuaternion(n,void 0,!1)}e._onChange(r),n._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new te},normalMatrix:{value:new Ut}}),this.matrix=new te,this.matrixWorld=new te,this.matrixAutoUpdate=Qt.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=Qt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new zl,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return ci.setFromAxisAngle(t,e),this.quaternion.multiply(ci),this}rotateOnWorldAxis(t,e){return ci.setFromAxisAngle(t,e),this.quaternion.premultiply(ci),this}rotateX(t){return this.rotateOnAxis(vo,t)}rotateY(t){return this.rotateOnAxis(xo,t)}rotateZ(t){return this.rotateOnAxis(yo,t)}translateOnAxis(t,e){return _o.copy(t).applyQuaternion(this.quaternion),this.position.add(_o.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(vo,t)}translateY(t){return this.translateOnAxis(xo,t)}translateZ(t){return this.translateOnAxis(yo,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(fn.copy(this.matrixWorld).invert())}lookAt(t,e,n){t.isVector3?ds.copy(t):ds.set(t,e,n);const i=this.parent;this.updateWorldMatrix(!0,!1),ki.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?fn.lookAt(ki,ds,this.up):fn.lookAt(ds,ki,this.up),this.quaternion.setFromRotationMatrix(fn),i&&(fn.extractRotation(i.matrixWorld),ci.setFromRotationMatrix(fn),this.quaternion.premultiply(ci.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(Mo),hi.child=t,this.dispatchEvent(hi),hi.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(Rh),ur.child=t,this.dispatchEvent(ur),ur.child=null),this}removeFromParent(){const t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),fn.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),fn.multiply(t.parent.matrixWorld)),t.applyMatrix4(fn),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(Mo),hi.child=t,this.dispatchEvent(hi),hi.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let n=0,i=this.children.length;n<i;n++){const a=this.children[n].getObjectByProperty(t,e);if(a!==void 0)return a}}getObjectsByProperty(t,e,n=[]){this[t]===e&&n.push(this);const i=this.children;for(let r=0,a=i.length;r<a;r++)i[r].getObjectsByProperty(t,e,n);return n}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ki,t,Th),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ki,Ah,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);const e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}traverse(t){t(this);const e=this.children;for(let n=0,i=e.length;n<i;n++)e[n].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);const e=this.children;for(let n=0,i=e.length;n<i;n++)e[n].traverseVisible(t)}traverseAncestors(t){const e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);const e=this.children;for(let n=0,i=e.length;n<i;n++)e[n].updateMatrixWorld(t)}updateWorldMatrix(t,e){const n=this.parent;if(t===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),e===!0){const i=this.children;for(let r=0,a=i.length;r<a;r++)i[r].updateWorldMatrix(!1,!0)}}toJSON(t){const e=t===void 0||typeof t=="string",n={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});const i={};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.castShadow===!0&&(i.castShadow=!0),this.receiveShadow===!0&&(i.receiveShadow=!0),this.visible===!1&&(i.visible=!1),this.frustumCulled===!1&&(i.frustumCulled=!1),this.renderOrder!==0&&(i.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(i.userData=this.userData),i.layers=this.layers.mask,i.matrix=this.matrix.toArray(),i.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(i.matrixAutoUpdate=!1),this.isInstancedMesh&&(i.type="InstancedMesh",i.count=this.count,i.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(i.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(i.type="BatchedMesh",i.perObjectFrustumCulled=this.perObjectFrustumCulled,i.sortObjects=this.sortObjects,i.drawRanges=this._drawRanges,i.reservedRanges=this._reservedRanges,i.visibility=this._visibility,i.active=this._active,i.bounds=this._bounds.map(o=>({boxInitialized:o.boxInitialized,boxMin:o.box.min.toArray(),boxMax:o.box.max.toArray(),sphereInitialized:o.sphereInitialized,sphereRadius:o.sphere.radius,sphereCenter:o.sphere.center.toArray()})),i.maxInstanceCount=this._maxInstanceCount,i.maxVertexCount=this._maxVertexCount,i.maxIndexCount=this._maxIndexCount,i.geometryInitialized=this._geometryInitialized,i.geometryCount=this._geometryCount,i.matricesTexture=this._matricesTexture.toJSON(t),this._colorsTexture!==null&&(i.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(i.boundingSphere={center:i.boundingSphere.center.toArray(),radius:i.boundingSphere.radius}),this.boundingBox!==null&&(i.boundingBox={min:i.boundingBox.min.toArray(),max:i.boundingBox.max.toArray()}));function r(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?i.background=this.background.toJSON():this.background.isTexture&&(i.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(i.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){i.geometry=r(t.geometries,this.geometry);const o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){const l=o.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){const u=l[c];r(t.shapes,u)}else r(t.shapes,l)}}if(this.isSkinnedMesh&&(i.bindMode=this.bindMode,i.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(t.skeletons,this.skeleton),i.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const o=[];for(let l=0,c=this.material.length;l<c;l++)o.push(r(t.materials,this.material[l]));i.material=o}else i.material=r(t.materials,this.material);if(this.children.length>0){i.children=[];for(let o=0;o<this.children.length;o++)i.children.push(this.children[o].toJSON(t).object)}if(this.animations.length>0){i.animations=[];for(let o=0;o<this.animations.length;o++){const l=this.animations[o];i.animations.push(r(t.animations,l))}}if(e){const o=a(t.geometries),l=a(t.materials),c=a(t.textures),h=a(t.images),u=a(t.shapes),f=a(t.skeletons),p=a(t.animations),g=a(t.nodes);o.length>0&&(n.geometries=o),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),u.length>0&&(n.shapes=u),f.length>0&&(n.skeletons=f),p.length>0&&(n.animations=p),g.length>0&&(n.nodes=g)}return n.object=i,n;function a(o){const l=[];for(const c in o){const h=o[c];delete h.metadata,l.push(h)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let n=0;n<t.children.length;n++){const i=t.children[n];this.add(i.clone())}return this}}Qt.DEFAULT_UP=new C(0,1,0);Qt.DEFAULT_MATRIX_AUTO_UPDATE=!0;Qt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const Qe=new C,pn=new C,dr=new C,mn=new C,ui=new C,di=new C,So=new C,fr=new C,pr=new C,mr=new C,gr=new ne,_r=new ne,vr=new ne;class $e{constructor(t=new C,e=new C,n=new C){this.a=t,this.b=e,this.c=n}static getNormal(t,e,n,i){i.subVectors(n,e),Qe.subVectors(t,e),i.cross(Qe);const r=i.lengthSq();return r>0?i.multiplyScalar(1/Math.sqrt(r)):i.set(0,0,0)}static getBarycoord(t,e,n,i,r){Qe.subVectors(i,e),pn.subVectors(n,e),dr.subVectors(t,e);const a=Qe.dot(Qe),o=Qe.dot(pn),l=Qe.dot(dr),c=pn.dot(pn),h=pn.dot(dr),u=a*c-o*o;if(u===0)return r.set(0,0,0),null;const f=1/u,p=(c*l-o*h)*f,g=(a*h-o*l)*f;return r.set(1-p-g,g,p)}static containsPoint(t,e,n,i){return this.getBarycoord(t,e,n,i,mn)===null?!1:mn.x>=0&&mn.y>=0&&mn.x+mn.y<=1}static getInterpolation(t,e,n,i,r,a,o,l){return this.getBarycoord(t,e,n,i,mn)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,mn.x),l.addScaledVector(a,mn.y),l.addScaledVector(o,mn.z),l)}static getInterpolatedAttribute(t,e,n,i,r,a){return gr.setScalar(0),_r.setScalar(0),vr.setScalar(0),gr.fromBufferAttribute(t,e),_r.fromBufferAttribute(t,n),vr.fromBufferAttribute(t,i),a.setScalar(0),a.addScaledVector(gr,r.x),a.addScaledVector(_r,r.y),a.addScaledVector(vr,r.z),a}static isFrontFacing(t,e,n,i){return Qe.subVectors(n,e),pn.subVectors(t,e),Qe.cross(pn).dot(i)<0}set(t,e,n){return this.a.copy(t),this.b.copy(e),this.c.copy(n),this}setFromPointsAndIndices(t,e,n,i){return this.a.copy(t[e]),this.b.copy(t[n]),this.c.copy(t[i]),this}setFromAttributeAndIndices(t,e,n,i){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,n),this.c.fromBufferAttribute(t,i),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return Qe.subVectors(this.c,this.b),pn.subVectors(this.a,this.b),Qe.cross(pn).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return $e.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return $e.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,n,i,r){return $e.getInterpolation(t,this.a,this.b,this.c,e,n,i,r)}containsPoint(t){return $e.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return $e.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){const n=this.a,i=this.b,r=this.c;let a,o;ui.subVectors(i,n),di.subVectors(r,n),fr.subVectors(t,n);const l=ui.dot(fr),c=di.dot(fr);if(l<=0&&c<=0)return e.copy(n);pr.subVectors(t,i);const h=ui.dot(pr),u=di.dot(pr);if(h>=0&&u<=h)return e.copy(i);const f=l*u-h*c;if(f<=0&&l>=0&&h<=0)return a=l/(l-h),e.copy(n).addScaledVector(ui,a);mr.subVectors(t,r);const p=ui.dot(mr),g=di.dot(mr);if(g>=0&&p<=g)return e.copy(r);const _=p*c-l*g;if(_<=0&&c>=0&&g<=0)return o=c/(c-g),e.copy(n).addScaledVector(di,o);const m=h*g-p*u;if(m<=0&&u-h>=0&&p-g>=0)return So.subVectors(r,i),o=(u-h)/(u-h+(p-g)),e.copy(i).addScaledVector(So,o);const d=1/(m+_+f);return a=_*d,o=f*d,e.copy(n).addScaledVector(ui,a).addScaledVector(di,o)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}}const Hl={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Cn={h:0,s:0,l:0},fs={h:0,s:0,l:0};function xr(s,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?s+(t-s)*6*e:e<1/2?t:e<2/3?s+(t-s)*6*(2/3-e):s}class Ot{constructor(t,e,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,n)}set(t,e,n){if(e===void 0&&n===void 0){const i=t;i&&i.isColor?this.copy(i):typeof i=="number"?this.setHex(i):typeof i=="string"&&this.setStyle(i)}else this.setRGB(t,e,n);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=Be){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,Yt.toWorkingColorSpace(this,e),this}setRGB(t,e,n,i=Yt.workingColorSpace){return this.r=t,this.g=e,this.b=n,Yt.toWorkingColorSpace(this,i),this}setHSL(t,e,n,i=Yt.workingColorSpace){if(t=Oa(t,1),e=Le(e,0,1),n=Le(n,0,1),e===0)this.r=this.g=this.b=n;else{const r=n<=.5?n*(1+e):n+e-n*e,a=2*n-r;this.r=xr(a,r,t+1/3),this.g=xr(a,r,t),this.b=xr(a,r,t-1/3)}return Yt.toWorkingColorSpace(this,i),this}setStyle(t,e=Be){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+t+" will be ignored.")}let i;if(i=/^(\w+)\(([^\)]*)\)/.exec(t)){let r;const a=i[1],o=i[2];switch(a){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,e);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,e);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,e);break;default:console.warn("THREE.Color: Unknown color model "+t)}}else if(i=/^\#([A-Fa-f\d]+)$/.exec(t)){const r=i[1],a=r.length;if(a===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,e);if(a===6)return this.setHex(parseInt(r,16),e);console.warn("THREE.Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=Be){const n=Hl[t.toLowerCase()];return n!==void 0?this.setHex(n,e):console.warn("THREE.Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=yn(t.r),this.g=yn(t.g),this.b=yn(t.b),this}copyLinearToSRGB(t){return this.r=bi(t.r),this.g=bi(t.g),this.b=bi(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=Be){return Yt.fromWorkingColorSpace(be.copy(this),t),Math.round(Le(be.r*255,0,255))*65536+Math.round(Le(be.g*255,0,255))*256+Math.round(Le(be.b*255,0,255))}getHexString(t=Be){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=Yt.workingColorSpace){Yt.fromWorkingColorSpace(be.copy(this),e);const n=be.r,i=be.g,r=be.b,a=Math.max(n,i,r),o=Math.min(n,i,r);let l,c;const h=(o+a)/2;if(o===a)l=0,c=0;else{const u=a-o;switch(c=h<=.5?u/(a+o):u/(2-a-o),a){case n:l=(i-r)/u+(i<r?6:0);break;case i:l=(r-n)/u+2;break;case r:l=(n-i)/u+4;break}l/=6}return t.h=l,t.s=c,t.l=h,t}getRGB(t,e=Yt.workingColorSpace){return Yt.fromWorkingColorSpace(be.copy(this),e),t.r=be.r,t.g=be.g,t.b=be.b,t}getStyle(t=Be){Yt.fromWorkingColorSpace(be.copy(this),t);const e=be.r,n=be.g,i=be.b;return t!==Be?`color(${t} ${e.toFixed(3)} ${n.toFixed(3)} ${i.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(n*255)},${Math.round(i*255)})`}offsetHSL(t,e,n){return this.getHSL(Cn),this.setHSL(Cn.h+t,Cn.s+e,Cn.l+n)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,n){return this.r=t.r+(e.r-t.r)*n,this.g=t.g+(e.g-t.g)*n,this.b=t.b+(e.b-t.b)*n,this}lerpHSL(t,e){this.getHSL(Cn),t.getHSL(fs);const n=Ji(Cn.h,fs.h,e),i=Ji(Cn.s,fs.s,e),r=Ji(Cn.l,fs.l,e);return this.setHSL(n,i,r),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){const e=this.r,n=this.g,i=this.b,r=t.elements;return this.r=r[0]*e+r[3]*n+r[6]*i,this.g=r[1]*e+r[4]*n+r[7]*i,this.b=r[2]*e+r[5]*n+r[8]*i,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const be=new Ot;Ot.NAMES=Hl;let Ch=0;class Bn extends Di{static get type(){return"Material"}get type(){return this.constructor.type}set type(t){}constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Ch++}),this.uuid=xn(),this.name="",this.blending=Ei,this.side=Fn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=kr,this.blendDst=zr,this.blendEquation=$n,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ot(0,0,0),this.blendAlpha=0,this.depthFunc=Ti,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=so,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=ii,this.stencilZFail=ii,this.stencilZPass=ii,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(const e in t){const n=t[e];if(n===void 0){console.warn(`THREE.Material: parameter '${e}' has value of undefined.`);continue}const i=this[e];if(i===void 0){console.warn(`THREE.Material: '${e}' is not a property of THREE.${this.type}.`);continue}i&&i.isColor?i.set(n):i&&i.isVector3&&n&&n.isVector3?i.copy(n):this[e]=n}}toJSON(t){const e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});const n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(t).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(t).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(t).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(t).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(t).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Ei&&(n.blending=this.blending),this.side!==Fn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==kr&&(n.blendSrc=this.blendSrc),this.blendDst!==zr&&(n.blendDst=this.blendDst),this.blendEquation!==$n&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==Ti&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==so&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==ii&&(n.stencilFail=this.stencilFail),this.stencilZFail!==ii&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==ii&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function i(r){const a=[];for(const o in r){const l=r[o];delete l.metadata,a.push(l)}return a}if(e){const r=i(t.textures),a=i(t.images);r.length>0&&(n.textures=r),a.length>0&&(n.images=a)}return n}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;const e=t.clippingPlanes;let n=null;if(e!==null){const i=e.length;n=new Array(i);for(let r=0;r!==i;++r)n[r]=e[r].clone()}return this.clippingPlanes=n,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}onBuild(){console.warn("Material: onBuild() has been removed.")}}class Et extends Bn{static get type(){return"MeshBasicMaterial"}constructor(t){super(),this.isMeshBasicMaterial=!0,this.color=new Ot(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new ze,this.combine=El,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}}const _e=new C,ps=new Pt;class De{constructor(t,e,n=!1){if(Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=n,this.usage=wa,this.updateRanges=[],this.gpuType=on,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,n){t*=this.itemSize,n*=e.itemSize;for(let i=0,r=this.itemSize;i<r;i++)this.array[t+i]=e.array[n+i];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,n=this.count;e<n;e++)ps.fromBufferAttribute(this,e),ps.applyMatrix3(t),this.setXY(e,ps.x,ps.y);else if(this.itemSize===3)for(let e=0,n=this.count;e<n;e++)_e.fromBufferAttribute(this,e),_e.applyMatrix3(t),this.setXYZ(e,_e.x,_e.y,_e.z);return this}applyMatrix4(t){for(let e=0,n=this.count;e<n;e++)_e.fromBufferAttribute(this,e),_e.applyMatrix4(t),this.setXYZ(e,_e.x,_e.y,_e.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)_e.fromBufferAttribute(this,e),_e.applyNormalMatrix(t),this.setXYZ(e,_e.x,_e.y,_e.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)_e.fromBufferAttribute(this,e),_e.transformDirection(t),this.setXYZ(e,_e.x,_e.y,_e.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let n=this.array[t*this.itemSize+e];return this.normalized&&(n=en(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=Jt(n,this.array)),this.array[t*this.itemSize+e]=n,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=en(e,this.array)),e}setX(t,e){return this.normalized&&(e=Jt(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=en(e,this.array)),e}setY(t,e){return this.normalized&&(e=Jt(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=en(e,this.array)),e}setZ(t,e){return this.normalized&&(e=Jt(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=en(e,this.array)),e}setW(t,e){return this.normalized&&(e=Jt(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,n){return t*=this.itemSize,this.normalized&&(e=Jt(e,this.array),n=Jt(n,this.array)),this.array[t+0]=e,this.array[t+1]=n,this}setXYZ(t,e,n,i){return t*=this.itemSize,this.normalized&&(e=Jt(e,this.array),n=Jt(n,this.array),i=Jt(i,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=i,this}setXYZW(t,e,n,i,r){return t*=this.itemSize,this.normalized&&(e=Jt(e,this.array),n=Jt(n,this.array),i=Jt(i,this.array),r=Jt(r,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=i,this.array[t+3]=r,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(t.name=this.name),this.usage!==wa&&(t.usage=this.usage),t}}class Vl extends De{constructor(t,e,n){super(new Uint16Array(t),e,n)}}class Gl extends De{constructor(t,e,n){super(new Uint32Array(t),e,n)}}class ae extends De{constructor(t,e,n){super(new Float32Array(t),e,n)}}let Ph=0;const Ye=new te,yr=new Qt,fi=new C,Ge=new ti,zi=new ti,Me=new C;class ve extends Di{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Ph++}),this.uuid=xn(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(Ol(t)?Gl:Vl)(t,1):this.index=t,this}setIndirect(t){return this.indirect=t,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,n=0){this.groups.push({start:t,count:e,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){const e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const r=new Ut().getNormalMatrix(t);n.applyNormalMatrix(r),n.needsUpdate=!0}const i=this.attributes.tangent;return i!==void 0&&(i.transformDirection(t),i.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(t){return Ye.makeRotationFromQuaternion(t),this.applyMatrix4(Ye),this}rotateX(t){return Ye.makeRotationX(t),this.applyMatrix4(Ye),this}rotateY(t){return Ye.makeRotationY(t),this.applyMatrix4(Ye),this}rotateZ(t){return Ye.makeRotationZ(t),this.applyMatrix4(Ye),this}translate(t,e,n){return Ye.makeTranslation(t,e,n),this.applyMatrix4(Ye),this}scale(t,e,n){return Ye.makeScale(t,e,n),this.applyMatrix4(Ye),this}lookAt(t){return yr.lookAt(t),yr.updateMatrix(),this.applyMatrix4(yr.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(fi).negate(),this.translate(fi.x,fi.y,fi.z),this}setFromPoints(t){const e=this.getAttribute("position");if(e===void 0){const n=[];for(let i=0,r=t.length;i<r;i++){const a=t[i];n.push(a.x,a.y,a.z||0)}this.setAttribute("position",new ae(n,3))}else{for(let n=0,i=e.count;n<i;n++){const r=t[n];e.setXYZ(n,r.x,r.y,r.z||0)}t.length>e.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new ti);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new C(-1/0,-1/0,-1/0),new C(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let n=0,i=e.length;n<i;n++){const r=e[n];Ge.setFromBufferAttribute(r),this.morphTargetsRelative?(Me.addVectors(this.boundingBox.min,Ge.min),this.boundingBox.expandByPoint(Me),Me.addVectors(this.boundingBox.max,Ge.max),this.boundingBox.expandByPoint(Me)):(this.boundingBox.expandByPoint(Ge.min),this.boundingBox.expandByPoint(Ge.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new ei);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new C,1/0);return}if(t){const n=this.boundingSphere.center;if(Ge.setFromBufferAttribute(t),e)for(let r=0,a=e.length;r<a;r++){const o=e[r];zi.setFromBufferAttribute(o),this.morphTargetsRelative?(Me.addVectors(Ge.min,zi.min),Ge.expandByPoint(Me),Me.addVectors(Ge.max,zi.max),Ge.expandByPoint(Me)):(Ge.expandByPoint(zi.min),Ge.expandByPoint(zi.max))}Ge.getCenter(n);let i=0;for(let r=0,a=t.count;r<a;r++)Me.fromBufferAttribute(t,r),i=Math.max(i,n.distanceToSquared(Me));if(e)for(let r=0,a=e.length;r<a;r++){const o=e[r],l=this.morphTargetsRelative;for(let c=0,h=o.count;c<h;c++)Me.fromBufferAttribute(o,c),l&&(fi.fromBufferAttribute(t,c),Me.add(fi)),i=Math.max(i,n.distanceToSquared(Me))}this.boundingSphere.radius=Math.sqrt(i),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=e.position,i=e.normal,r=e.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new De(new Float32Array(4*n.count),4));const a=this.getAttribute("tangent"),o=[],l=[];for(let L=0;L<n.count;L++)o[L]=new C,l[L]=new C;const c=new C,h=new C,u=new C,f=new Pt,p=new Pt,g=new Pt,_=new C,m=new C;function d(L,E,y){c.fromBufferAttribute(n,L),h.fromBufferAttribute(n,E),u.fromBufferAttribute(n,y),f.fromBufferAttribute(r,L),p.fromBufferAttribute(r,E),g.fromBufferAttribute(r,y),h.sub(c),u.sub(c),p.sub(f),g.sub(f);const P=1/(p.x*g.y-g.x*p.y);isFinite(P)&&(_.copy(h).multiplyScalar(g.y).addScaledVector(u,-p.y).multiplyScalar(P),m.copy(u).multiplyScalar(p.x).addScaledVector(h,-g.x).multiplyScalar(P),o[L].add(_),o[E].add(_),o[y].add(_),l[L].add(m),l[E].add(m),l[y].add(m))}let S=this.groups;S.length===0&&(S=[{start:0,count:t.count}]);for(let L=0,E=S.length;L<E;++L){const y=S[L],P=y.start,H=y.count;for(let B=P,V=P+H;B<V;B+=3)d(t.getX(B+0),t.getX(B+1),t.getX(B+2))}const w=new C,v=new C,I=new C,A=new C;function R(L){I.fromBufferAttribute(i,L),A.copy(I);const E=o[L];w.copy(E),w.sub(I.multiplyScalar(I.dot(E))).normalize(),v.crossVectors(A,E);const P=v.dot(l[L])<0?-1:1;a.setXYZW(L,w.x,w.y,w.z,P)}for(let L=0,E=S.length;L<E;++L){const y=S[L],P=y.start,H=y.count;for(let B=P,V=P+H;B<V;B+=3)R(t.getX(B+0)),R(t.getX(B+1)),R(t.getX(B+2))}}computeVertexNormals(){const t=this.index,e=this.getAttribute("position");if(e!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new De(new Float32Array(e.count*3),3),this.setAttribute("normal",n);else for(let f=0,p=n.count;f<p;f++)n.setXYZ(f,0,0,0);const i=new C,r=new C,a=new C,o=new C,l=new C,c=new C,h=new C,u=new C;if(t)for(let f=0,p=t.count;f<p;f+=3){const g=t.getX(f+0),_=t.getX(f+1),m=t.getX(f+2);i.fromBufferAttribute(e,g),r.fromBufferAttribute(e,_),a.fromBufferAttribute(e,m),h.subVectors(a,r),u.subVectors(i,r),h.cross(u),o.fromBufferAttribute(n,g),l.fromBufferAttribute(n,_),c.fromBufferAttribute(n,m),o.add(h),l.add(h),c.add(h),n.setXYZ(g,o.x,o.y,o.z),n.setXYZ(_,l.x,l.y,l.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let f=0,p=e.count;f<p;f+=3)i.fromBufferAttribute(e,f+0),r.fromBufferAttribute(e,f+1),a.fromBufferAttribute(e,f+2),h.subVectors(a,r),u.subVectors(i,r),h.cross(u),n.setXYZ(f+0,h.x,h.y,h.z),n.setXYZ(f+1,h.x,h.y,h.z),n.setXYZ(f+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const t=this.attributes.normal;for(let e=0,n=t.count;e<n;e++)Me.fromBufferAttribute(t,e),Me.normalize(),t.setXYZ(e,Me.x,Me.y,Me.z)}toNonIndexed(){function t(o,l){const c=o.array,h=o.itemSize,u=o.normalized,f=new c.constructor(l.length*h);let p=0,g=0;for(let _=0,m=l.length;_<m;_++){o.isInterleavedBufferAttribute?p=l[_]*o.data.stride+o.offset:p=l[_]*h;for(let d=0;d<h;d++)f[g++]=c[p++]}return new De(f,h,u)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const e=new ve,n=this.index.array,i=this.attributes;for(const o in i){const l=i[o],c=t(l,n);e.setAttribute(o,c)}const r=this.morphAttributes;for(const o in r){const l=[],c=r[o];for(let h=0,u=c.length;h<u;h++){const f=c[h],p=t(f,n);l.push(p)}e.morphAttributes[o]=l}e.morphTargetsRelative=this.morphTargetsRelative;const a=this.groups;for(let o=0,l=a.length;o<l;o++){const c=a[o];e.addGroup(c.start,c.count,c.materialIndex)}return e}toJSON(){const t={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0){const l=this.parameters;for(const c in l)l[c]!==void 0&&(t[c]=l[c]);return t}t.data={attributes:{}};const e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});const n=this.attributes;for(const l in n){const c=n[l];t.data.attributes[l]=c.toJSON(t.data)}const i={};let r=!1;for(const l in this.morphAttributes){const c=this.morphAttributes[l],h=[];for(let u=0,f=c.length;u<f;u++){const p=c[u];h.push(p.toJSON(t.data))}h.length>0&&(i[l]=h,r=!0)}r&&(t.data.morphAttributes=i,t.data.morphTargetsRelative=this.morphTargetsRelative);const a=this.groups;a.length>0&&(t.data.groups=JSON.parse(JSON.stringify(a)));const o=this.boundingSphere;return o!==null&&(t.data.boundingSphere={center:o.center.toArray(),radius:o.radius}),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const e={};this.name=t.name;const n=t.index;n!==null&&this.setIndex(n.clone(e));const i=t.attributes;for(const c in i){const h=i[c];this.setAttribute(c,h.clone(e))}const r=t.morphAttributes;for(const c in r){const h=[],u=r[c];for(let f=0,p=u.length;f<p;f++)h.push(u[f].clone(e));this.morphAttributes[c]=h}this.morphTargetsRelative=t.morphTargetsRelative;const a=t.groups;for(let c=0,h=a.length;c<h;c++){const u=a[c];this.addGroup(u.start,u.count,u.materialIndex)}const o=t.boundingBox;o!==null&&(this.boundingBox=o.clone());const l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const Eo=new te,Vn=new Ba,ms=new ei,wo=new C,gs=new C,_s=new C,vs=new C,Mr=new C,xs=new C,bo=new C,ys=new C;class et extends Qt{constructor(t=new ve,e=new Et){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){const e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){const i=e[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=i.length;r<a;r++){const o=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}getVertexPosition(t,e){const n=this.geometry,i=n.attributes.position,r=n.morphAttributes.position,a=n.morphTargetsRelative;e.fromBufferAttribute(i,t);const o=this.morphTargetInfluences;if(r&&o){xs.set(0,0,0);for(let l=0,c=r.length;l<c;l++){const h=o[l],u=r[l];h!==0&&(Mr.fromBufferAttribute(u,t),a?xs.addScaledVector(Mr,h):xs.addScaledVector(Mr.sub(e),h))}e.add(xs)}return e}raycast(t,e){const n=this.geometry,i=this.material,r=this.matrixWorld;i!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),ms.copy(n.boundingSphere),ms.applyMatrix4(r),Vn.copy(t.ray).recast(t.near),!(ms.containsPoint(Vn.origin)===!1&&(Vn.intersectSphere(ms,wo)===null||Vn.origin.distanceToSquared(wo)>(t.far-t.near)**2))&&(Eo.copy(r).invert(),Vn.copy(t.ray).applyMatrix4(Eo),!(n.boundingBox!==null&&Vn.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(t,e,Vn)))}_computeIntersections(t,e,n){let i;const r=this.geometry,a=this.material,o=r.index,l=r.attributes.position,c=r.attributes.uv,h=r.attributes.uv1,u=r.attributes.normal,f=r.groups,p=r.drawRange;if(o!==null)if(Array.isArray(a))for(let g=0,_=f.length;g<_;g++){const m=f[g],d=a[m.materialIndex],S=Math.max(m.start,p.start),w=Math.min(o.count,Math.min(m.start+m.count,p.start+p.count));for(let v=S,I=w;v<I;v+=3){const A=o.getX(v),R=o.getX(v+1),L=o.getX(v+2);i=Ms(this,d,t,n,c,h,u,A,R,L),i&&(i.faceIndex=Math.floor(v/3),i.face.materialIndex=m.materialIndex,e.push(i))}}else{const g=Math.max(0,p.start),_=Math.min(o.count,p.start+p.count);for(let m=g,d=_;m<d;m+=3){const S=o.getX(m),w=o.getX(m+1),v=o.getX(m+2);i=Ms(this,a,t,n,c,h,u,S,w,v),i&&(i.faceIndex=Math.floor(m/3),e.push(i))}}else if(l!==void 0)if(Array.isArray(a))for(let g=0,_=f.length;g<_;g++){const m=f[g],d=a[m.materialIndex],S=Math.max(m.start,p.start),w=Math.min(l.count,Math.min(m.start+m.count,p.start+p.count));for(let v=S,I=w;v<I;v+=3){const A=v,R=v+1,L=v+2;i=Ms(this,d,t,n,c,h,u,A,R,L),i&&(i.faceIndex=Math.floor(v/3),i.face.materialIndex=m.materialIndex,e.push(i))}}else{const g=Math.max(0,p.start),_=Math.min(l.count,p.start+p.count);for(let m=g,d=_;m<d;m+=3){const S=m,w=m+1,v=m+2;i=Ms(this,a,t,n,c,h,u,S,w,v),i&&(i.faceIndex=Math.floor(m/3),e.push(i))}}}}function Lh(s,t,e,n,i,r,a,o){let l;if(t.side===Se?l=n.intersectTriangle(a,r,i,!0,o):l=n.intersectTriangle(i,r,a,t.side===Fn,o),l===null)return null;ys.copy(o),ys.applyMatrix4(s.matrixWorld);const c=e.ray.origin.distanceTo(ys);return c<e.near||c>e.far?null:{distance:c,point:ys.clone(),object:s}}function Ms(s,t,e,n,i,r,a,o,l,c){s.getVertexPosition(o,gs),s.getVertexPosition(l,_s),s.getVertexPosition(c,vs);const h=Lh(s,t,e,n,gs,_s,vs,bo);if(h){const u=new C;$e.getBarycoord(bo,gs,_s,vs,u),i&&(h.uv=$e.getInterpolatedAttribute(i,o,l,c,u,new Pt)),r&&(h.uv1=$e.getInterpolatedAttribute(r,o,l,c,u,new Pt)),a&&(h.normal=$e.getInterpolatedAttribute(a,o,l,c,u,new C),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));const f={a:o,b:l,c,normal:new C,materialIndex:0};$e.getNormal(gs,_s,vs,f.normal),h.face=f,h.barycoord=u}return h}class zt extends ve{constructor(t=1,e=1,n=1,i=1,r=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:e,depth:n,widthSegments:i,heightSegments:r,depthSegments:a};const o=this;i=Math.floor(i),r=Math.floor(r),a=Math.floor(a);const l=[],c=[],h=[],u=[];let f=0,p=0;g("z","y","x",-1,-1,n,e,t,a,r,0),g("z","y","x",1,-1,n,e,-t,a,r,1),g("x","z","y",1,1,t,n,e,i,a,2),g("x","z","y",1,-1,t,n,-e,i,a,3),g("x","y","z",1,-1,t,e,n,i,r,4),g("x","y","z",-1,-1,t,e,-n,i,r,5),this.setIndex(l),this.setAttribute("position",new ae(c,3)),this.setAttribute("normal",new ae(h,3)),this.setAttribute("uv",new ae(u,2));function g(_,m,d,S,w,v,I,A,R,L,E){const y=v/R,P=I/L,H=v/2,B=I/2,V=A/2,q=R+1,G=L+1;let J=0,W=0;const rt=new C;for(let ut=0;ut<G;ut++){const Mt=ut*P-B;for(let Bt=0;Bt<q;Bt++){const ie=Bt*y-H;rt[_]=ie*S,rt[m]=Mt*w,rt[d]=V,c.push(rt.x,rt.y,rt.z),rt[_]=0,rt[m]=0,rt[d]=A>0?1:-1,h.push(rt.x,rt.y,rt.z),u.push(Bt/R),u.push(1-ut/L),J+=1}}for(let ut=0;ut<L;ut++)for(let Mt=0;Mt<R;Mt++){const Bt=f+Mt+q*ut,ie=f+Mt+q*(ut+1),$=f+(Mt+1)+q*(ut+1),nt=f+(Mt+1)+q*ut;l.push(Bt,ie,nt),l.push(ie,$,nt),W+=6}o.addGroup(p,W,E),p+=W,f+=J}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new zt(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}}function Li(s){const t={};for(const e in s){t[e]={};for(const n in s[e]){const i=s[e][n];i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)?i.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][n]=null):t[e][n]=i.clone():Array.isArray(i)?t[e][n]=i.slice():t[e][n]=i}}return t}function Pe(s){const t={};for(let e=0;e<s.length;e++){const n=Li(s[e]);for(const i in n)t[i]=n[i]}return t}function Ih(s){const t=[];for(let e=0;e<s.length;e++)t.push(s[e].clone());return t}function Wl(s){const t=s.getRenderTarget();return t===null?s.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:Yt.workingColorSpace}const Dh={clone:Li,merge:Pe};var Uh=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Nh=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class On extends Bn{static get type(){return"ShaderMaterial"}constructor(t){super(),this.isShaderMaterial=!0,this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Uh,this.fragmentShader=Nh,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=Li(t.uniforms),this.uniformsGroups=Ih(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this}toJSON(t){const e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(const i in this.uniforms){const a=this.uniforms[i].value;a&&a.isTexture?e.uniforms[i]={type:"t",value:a.toJSON(t).uuid}:a&&a.isColor?e.uniforms[i]={type:"c",value:a.getHex()}:a&&a.isVector2?e.uniforms[i]={type:"v2",value:a.toArray()}:a&&a.isVector3?e.uniforms[i]={type:"v3",value:a.toArray()}:a&&a.isVector4?e.uniforms[i]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?e.uniforms[i]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?e.uniforms[i]={type:"m4",value:a.toArray()}:e.uniforms[i]={value:a}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;const n={};for(const i in this.extensions)this.extensions[i]===!0&&(n[i]=!0);return Object.keys(n).length>0&&(e.extensions=n),e}}class Xl extends Qt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new te,this.projectionMatrix=new te,this.projectionMatrixInverse=new te,this.coordinateSystem=vn}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(t,e){super.updateWorldMatrix(t,e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const Pn=new C,To=new Pt,Ao=new Pt;class Ie extends Xl{constructor(t=50,e=1,n=.1,i=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=t,this.zoom=1,this.near=n,this.far=i,this.focus=10,this.aspect=e,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.fov=t.fov,this.zoom=t.zoom,this.near=t.near,this.far=t.far,this.focus=t.focus,this.aspect=t.aspect,this.view=t.view===null?null:Object.assign({},t.view),this.filmGauge=t.filmGauge,this.filmOffset=t.filmOffset,this}setFocalLength(t){const e=.5*this.getFilmHeight()/t;this.fov=es*2*Math.atan(e),this.updateProjectionMatrix()}getFocalLength(){const t=Math.tan(Zi*.5*this.fov);return .5*this.getFilmHeight()/t}getEffectiveFOV(){return es*2*Math.atan(Math.tan(Zi*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(t,e,n){Pn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),e.set(Pn.x,Pn.y).multiplyScalar(-t/Pn.z),Pn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Pn.x,Pn.y).multiplyScalar(-t/Pn.z)}getViewSize(t,e){return this.getViewBounds(t,To,Ao),e.subVectors(Ao,To)}setViewOffset(t,e,n,i,r,a){this.aspect=t/e,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=i,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=this.near;let e=t*Math.tan(Zi*.5*this.fov)/this.zoom,n=2*e,i=this.aspect*n,r=-.5*i;const a=this.view;if(this.view!==null&&this.view.enabled){const l=a.fullWidth,c=a.fullHeight;r+=a.offsetX*i/l,e-=a.offsetY*n/c,i*=a.width/l,n*=a.height/c}const o=this.filmOffset;o!==0&&(r+=t*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+i,e,e-n,t,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.fov=this.fov,e.object.zoom=this.zoom,e.object.near=this.near,e.object.far=this.far,e.object.focus=this.focus,e.object.aspect=this.aspect,this.view!==null&&(e.object.view=Object.assign({},this.view)),e.object.filmGauge=this.filmGauge,e.object.filmOffset=this.filmOffset,e}}const pi=-90,mi=1;class Fh extends Qt{constructor(t,e,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const i=new Ie(pi,mi,t,e);i.layers=this.layers,this.add(i);const r=new Ie(pi,mi,t,e);r.layers=this.layers,this.add(r);const a=new Ie(pi,mi,t,e);a.layers=this.layers,this.add(a);const o=new Ie(pi,mi,t,e);o.layers=this.layers,this.add(o);const l=new Ie(pi,mi,t,e);l.layers=this.layers,this.add(l);const c=new Ie(pi,mi,t,e);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){const t=this.coordinateSystem,e=this.children.concat(),[n,i,r,a,o,l]=e;for(const c of e)this.remove(c);if(t===vn)n.up.set(0,1,0),n.lookAt(1,0,0),i.up.set(0,1,0),i.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(t===Vs)n.up.set(0,-1,0),n.lookAt(-1,0,0),i.up.set(0,-1,0),i.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+t);for(const c of e)this.add(c),c.updateMatrixWorld()}update(t,e){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:i}=this;this.coordinateSystem!==t.coordinateSystem&&(this.coordinateSystem=t.coordinateSystem,this.updateCoordinateSystem());const[r,a,o,l,c,h]=this.children,u=t.getRenderTarget(),f=t.getActiveCubeFace(),p=t.getActiveMipmapLevel(),g=t.xr.enabled;t.xr.enabled=!1;const _=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,t.setRenderTarget(n,0,i),t.render(e,r),t.setRenderTarget(n,1,i),t.render(e,a),t.setRenderTarget(n,2,i),t.render(e,o),t.setRenderTarget(n,3,i),t.render(e,l),t.setRenderTarget(n,4,i),t.render(e,c),n.texture.generateMipmaps=_,t.setRenderTarget(n,5,i),t.render(e,h),t.setRenderTarget(u,f,p),t.xr.enabled=g,n.texture.needsPMREMUpdate=!0}}class ql extends Re{constructor(t,e,n,i,r,a,o,l,c,h){t=t!==void 0?t:[],e=e!==void 0?e:Ai,super(t,e,n,i,r,a,o,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(t){this.image=t}}class Oh extends Sn{constructor(t=1,e={}){super(t,t,e),this.isWebGLCubeRenderTarget=!0;const n={width:t,height:t,depth:1},i=[n,n,n,n,n,n];this.texture=new ql(i,e.mapping,e.wrapS,e.wrapT,e.magFilter,e.minFilter,e.format,e.type,e.anisotropy,e.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=e.generateMipmaps!==void 0?e.generateMipmaps:!1,this.texture.minFilter=e.minFilter!==void 0?e.minFilter:an}fromEquirectangularTexture(t,e){this.texture.type=e.type,this.texture.colorSpace=e.colorSpace,this.texture.generateMipmaps=e.generateMipmaps,this.texture.minFilter=e.minFilter,this.texture.magFilter=e.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},i=new zt(5,5,5),r=new On({name:"CubemapFromEquirect",uniforms:Li(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Se,blending:Dn});r.uniforms.tEquirect.value=e;const a=new et(i,r),o=e.minFilter;return e.minFilter===Zn&&(e.minFilter=an),new Fh(1,10,this).update(t,a),e.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(t,e,n,i){const r=t.getRenderTarget();for(let a=0;a<6;a++)t.setRenderTarget(this,a),t.clear(e,n,i);t.setRenderTarget(r)}}const Sr=new C,Bh=new C,kh=new Ut;class qn{constructor(t=new C(1,0,0),e=0){this.isPlane=!0,this.normal=t,this.constant=e}set(t,e){return this.normal.copy(t),this.constant=e,this}setComponents(t,e,n,i){return this.normal.set(t,e,n),this.constant=i,this}setFromNormalAndCoplanarPoint(t,e){return this.normal.copy(t),this.constant=-e.dot(this.normal),this}setFromCoplanarPoints(t,e,n){const i=Sr.subVectors(n,e).cross(Bh.subVectors(t,e)).normalize();return this.setFromNormalAndCoplanarPoint(i,t),this}copy(t){return this.normal.copy(t.normal),this.constant=t.constant,this}normalize(){const t=1/this.normal.length();return this.normal.multiplyScalar(t),this.constant*=t,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(t){return this.normal.dot(t)+this.constant}distanceToSphere(t){return this.distanceToPoint(t.center)-t.radius}projectPoint(t,e){return e.copy(t).addScaledVector(this.normal,-this.distanceToPoint(t))}intersectLine(t,e){const n=t.delta(Sr),i=this.normal.dot(n);if(i===0)return this.distanceToPoint(t.start)===0?e.copy(t.start):null;const r=-(t.start.dot(this.normal)+this.constant)/i;return r<0||r>1?null:e.copy(t.start).addScaledVector(n,r)}intersectsLine(t){const e=this.distanceToPoint(t.start),n=this.distanceToPoint(t.end);return e<0&&n>0||n<0&&e>0}intersectsBox(t){return t.intersectsPlane(this)}intersectsSphere(t){return t.intersectsPlane(this)}coplanarPoint(t){return t.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(t,e){const n=e||kh.getNormalMatrix(t),i=this.coplanarPoint(Sr).applyMatrix4(t),r=this.normal.applyMatrix3(n).normalize();return this.constant=-i.dot(r),this}translate(t){return this.constant-=t.dot(this.normal),this}equals(t){return t.normal.equals(this.normal)&&t.constant===this.constant}clone(){return new this.constructor().copy(this)}}const Gn=new ei,Ss=new C;class ka{constructor(t=new qn,e=new qn,n=new qn,i=new qn,r=new qn,a=new qn){this.planes=[t,e,n,i,r,a]}set(t,e,n,i,r,a){const o=this.planes;return o[0].copy(t),o[1].copy(e),o[2].copy(n),o[3].copy(i),o[4].copy(r),o[5].copy(a),this}copy(t){const e=this.planes;for(let n=0;n<6;n++)e[n].copy(t.planes[n]);return this}setFromProjectionMatrix(t,e=vn){const n=this.planes,i=t.elements,r=i[0],a=i[1],o=i[2],l=i[3],c=i[4],h=i[5],u=i[6],f=i[7],p=i[8],g=i[9],_=i[10],m=i[11],d=i[12],S=i[13],w=i[14],v=i[15];if(n[0].setComponents(l-r,f-c,m-p,v-d).normalize(),n[1].setComponents(l+r,f+c,m+p,v+d).normalize(),n[2].setComponents(l+a,f+h,m+g,v+S).normalize(),n[3].setComponents(l-a,f-h,m-g,v-S).normalize(),n[4].setComponents(l-o,f-u,m-_,v-w).normalize(),e===vn)n[5].setComponents(l+o,f+u,m+_,v+w).normalize();else if(e===Vs)n[5].setComponents(o,u,_,w).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+e);return this}intersectsObject(t){if(t.boundingSphere!==void 0)t.boundingSphere===null&&t.computeBoundingSphere(),Gn.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);else{const e=t.geometry;e.boundingSphere===null&&e.computeBoundingSphere(),Gn.copy(e.boundingSphere).applyMatrix4(t.matrixWorld)}return this.intersectsSphere(Gn)}intersectsSprite(t){return Gn.center.set(0,0,0),Gn.radius=.7071067811865476,Gn.applyMatrix4(t.matrixWorld),this.intersectsSphere(Gn)}intersectsSphere(t){const e=this.planes,n=t.center,i=-t.radius;for(let r=0;r<6;r++)if(e[r].distanceToPoint(n)<i)return!1;return!0}intersectsBox(t){const e=this.planes;for(let n=0;n<6;n++){const i=e[n];if(Ss.x=i.normal.x>0?t.max.x:t.min.x,Ss.y=i.normal.y>0?t.max.y:t.min.y,Ss.z=i.normal.z>0?t.max.z:t.min.z,i.distanceToPoint(Ss)<0)return!1}return!0}containsPoint(t){const e=this.planes;for(let n=0;n<6;n++)if(e[n].distanceToPoint(t)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}function Yl(){let s=null,t=!1,e=null,n=null;function i(r,a){e(r,a),n=s.requestAnimationFrame(i)}return{start:function(){t!==!0&&e!==null&&(n=s.requestAnimationFrame(i),t=!0)},stop:function(){s.cancelAnimationFrame(n),t=!1},setAnimationLoop:function(r){e=r},setContext:function(r){s=r}}}function zh(s){const t=new WeakMap;function e(o,l){const c=o.array,h=o.usage,u=c.byteLength,f=s.createBuffer();s.bindBuffer(l,f),s.bufferData(l,c,h),o.onUploadCallback();let p;if(c instanceof Float32Array)p=s.FLOAT;else if(c instanceof Uint16Array)o.isFloat16BufferAttribute?p=s.HALF_FLOAT:p=s.UNSIGNED_SHORT;else if(c instanceof Int16Array)p=s.SHORT;else if(c instanceof Uint32Array)p=s.UNSIGNED_INT;else if(c instanceof Int32Array)p=s.INT;else if(c instanceof Int8Array)p=s.BYTE;else if(c instanceof Uint8Array)p=s.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)p=s.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:f,type:p,bytesPerElement:c.BYTES_PER_ELEMENT,version:o.version,size:u}}function n(o,l,c){const h=l.array,u=l.updateRanges;if(s.bindBuffer(c,o),u.length===0)s.bufferSubData(c,0,h);else{u.sort((p,g)=>p.start-g.start);let f=0;for(let p=1;p<u.length;p++){const g=u[f],_=u[p];_.start<=g.start+g.count+1?g.count=Math.max(g.count,_.start+_.count-g.start):(++f,u[f]=_)}u.length=f+1;for(let p=0,g=u.length;p<g;p++){const _=u[p];s.bufferSubData(c,_.start*h.BYTES_PER_ELEMENT,h,_.start,_.count)}l.clearUpdateRanges()}l.onUploadCallback()}function i(o){return o.isInterleavedBufferAttribute&&(o=o.data),t.get(o)}function r(o){o.isInterleavedBufferAttribute&&(o=o.data);const l=t.get(o);l&&(s.deleteBuffer(l.buffer),t.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){const h=t.get(o);(!h||h.version<o.version)&&t.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}const c=t.get(o);if(c===void 0)t.set(o,e(o,l));else if(c.version<o.version){if(c.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,o,l),c.version=o.version}}return{get:i,remove:r,update:a}}class _n extends ve{constructor(t=1,e=1,n=1,i=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:n,heightSegments:i};const r=t/2,a=e/2,o=Math.floor(n),l=Math.floor(i),c=o+1,h=l+1,u=t/o,f=e/l,p=[],g=[],_=[],m=[];for(let d=0;d<h;d++){const S=d*f-a;for(let w=0;w<c;w++){const v=w*u-r;g.push(v,-S,0),_.push(0,0,1),m.push(w/o),m.push(1-d/l)}}for(let d=0;d<l;d++)for(let S=0;S<o;S++){const w=S+c*d,v=S+c*(d+1),I=S+1+c*(d+1),A=S+1+c*d;p.push(w,v,A),p.push(v,I,A)}this.setIndex(p),this.setAttribute("position",new ae(g,3)),this.setAttribute("normal",new ae(_,3)),this.setAttribute("uv",new ae(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new _n(t.width,t.height,t.widthSegments,t.heightSegments)}}var Hh=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Vh=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,Gh=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Wh=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Xh=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,qh=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Yh=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,$h=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Kh=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,jh=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Zh=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Jh=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Qh=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,tu=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,eu=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,nu=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,iu=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,su=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,ru=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,au=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,ou=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,lu=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,cu=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,hu=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,uu=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,du=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,fu=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,pu=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,mu=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,gu=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,_u="gl_FragColor = linearToOutputTexel( gl_FragColor );",vu=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,xu=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,yu=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,Mu=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,Su=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Eu=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,wu=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,bu=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Tu=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Au=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Ru=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,Cu=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Pu=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Lu=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,Iu=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,Du=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,Uu=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Nu=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Fu=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Ou=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Bu=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,ku=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,zu=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,Hu=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,Vu=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Gu=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Wu=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Xu=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,qu=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,Yu=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,$u=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Ku=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,ju=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Zu=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Ju=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Qu=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,td=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,ed=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,nd=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,id=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,sd=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,rd=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,ad=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,od=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,ld=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,cd=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,hd=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,ud=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,dd=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,fd=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,pd=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,md=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,gd=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,_d=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,vd=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,xd=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,yd=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Md=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,Sd=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( texture2D( depths, uv ) ) );
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow (sampler2D shadow, vec2 uv, float compare ){
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		float hard_shadow = step( compare , distribution.x );
		if (hard_shadow != 1.0 ) {
			float distance = compare - distribution.x ;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,Ed=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,wd=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,bd=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,Td=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Ad=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,Rd=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Cd=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,Pd=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Ld=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,Id=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Dd=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,Ud=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,Nd=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
		
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
		
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		
		#else
		
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,Fd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Od=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,Bd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,kd=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const zd=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Hd=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Vd=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Gd=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Wd=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Xd=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,qd=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,Yd=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,$d=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,Kd=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,jd=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Zd=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Jd=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Qd=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,tf=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,ef=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,nf=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,sf=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,rf=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,af=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,of=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,lf=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,cf=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,hf=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,uf=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,df=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,ff=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,pf=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,mf=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,gf=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,_f=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,vf=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,xf=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,yf=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,Ft={alphahash_fragment:Hh,alphahash_pars_fragment:Vh,alphamap_fragment:Gh,alphamap_pars_fragment:Wh,alphatest_fragment:Xh,alphatest_pars_fragment:qh,aomap_fragment:Yh,aomap_pars_fragment:$h,batching_pars_vertex:Kh,batching_vertex:jh,begin_vertex:Zh,beginnormal_vertex:Jh,bsdfs:Qh,iridescence_fragment:tu,bumpmap_pars_fragment:eu,clipping_planes_fragment:nu,clipping_planes_pars_fragment:iu,clipping_planes_pars_vertex:su,clipping_planes_vertex:ru,color_fragment:au,color_pars_fragment:ou,color_pars_vertex:lu,color_vertex:cu,common:hu,cube_uv_reflection_fragment:uu,defaultnormal_vertex:du,displacementmap_pars_vertex:fu,displacementmap_vertex:pu,emissivemap_fragment:mu,emissivemap_pars_fragment:gu,colorspace_fragment:_u,colorspace_pars_fragment:vu,envmap_fragment:xu,envmap_common_pars_fragment:yu,envmap_pars_fragment:Mu,envmap_pars_vertex:Su,envmap_physical_pars_fragment:Du,envmap_vertex:Eu,fog_vertex:wu,fog_pars_vertex:bu,fog_fragment:Tu,fog_pars_fragment:Au,gradientmap_pars_fragment:Ru,lightmap_pars_fragment:Cu,lights_lambert_fragment:Pu,lights_lambert_pars_fragment:Lu,lights_pars_begin:Iu,lights_toon_fragment:Uu,lights_toon_pars_fragment:Nu,lights_phong_fragment:Fu,lights_phong_pars_fragment:Ou,lights_physical_fragment:Bu,lights_physical_pars_fragment:ku,lights_fragment_begin:zu,lights_fragment_maps:Hu,lights_fragment_end:Vu,logdepthbuf_fragment:Gu,logdepthbuf_pars_fragment:Wu,logdepthbuf_pars_vertex:Xu,logdepthbuf_vertex:qu,map_fragment:Yu,map_pars_fragment:$u,map_particle_fragment:Ku,map_particle_pars_fragment:ju,metalnessmap_fragment:Zu,metalnessmap_pars_fragment:Ju,morphinstance_vertex:Qu,morphcolor_vertex:td,morphnormal_vertex:ed,morphtarget_pars_vertex:nd,morphtarget_vertex:id,normal_fragment_begin:sd,normal_fragment_maps:rd,normal_pars_fragment:ad,normal_pars_vertex:od,normal_vertex:ld,normalmap_pars_fragment:cd,clearcoat_normal_fragment_begin:hd,clearcoat_normal_fragment_maps:ud,clearcoat_pars_fragment:dd,iridescence_pars_fragment:fd,opaque_fragment:pd,packing:md,premultiplied_alpha_fragment:gd,project_vertex:_d,dithering_fragment:vd,dithering_pars_fragment:xd,roughnessmap_fragment:yd,roughnessmap_pars_fragment:Md,shadowmap_pars_fragment:Sd,shadowmap_pars_vertex:Ed,shadowmap_vertex:wd,shadowmask_pars_fragment:bd,skinbase_vertex:Td,skinning_pars_vertex:Ad,skinning_vertex:Rd,skinnormal_vertex:Cd,specularmap_fragment:Pd,specularmap_pars_fragment:Ld,tonemapping_fragment:Id,tonemapping_pars_fragment:Dd,transmission_fragment:Ud,transmission_pars_fragment:Nd,uv_pars_fragment:Fd,uv_pars_vertex:Od,uv_vertex:Bd,worldpos_vertex:kd,background_vert:zd,background_frag:Hd,backgroundCube_vert:Vd,backgroundCube_frag:Gd,cube_vert:Wd,cube_frag:Xd,depth_vert:qd,depth_frag:Yd,distanceRGBA_vert:$d,distanceRGBA_frag:Kd,equirect_vert:jd,equirect_frag:Zd,linedashed_vert:Jd,linedashed_frag:Qd,meshbasic_vert:tf,meshbasic_frag:ef,meshlambert_vert:nf,meshlambert_frag:sf,meshmatcap_vert:rf,meshmatcap_frag:af,meshnormal_vert:of,meshnormal_frag:lf,meshphong_vert:cf,meshphong_frag:hf,meshphysical_vert:uf,meshphysical_frag:df,meshtoon_vert:ff,meshtoon_frag:pf,points_vert:mf,points_frag:gf,shadow_vert:_f,shadow_frag:vf,sprite_vert:xf,sprite_frag:yf},it={common:{diffuse:{value:new Ot(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Ut},alphaMap:{value:null},alphaMapTransform:{value:new Ut},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Ut}},envmap:{envMap:{value:null},envMapRotation:{value:new Ut},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Ut}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Ut}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Ut},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Ut},normalScale:{value:new Pt(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Ut},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Ut}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Ut}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Ut}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ot(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Ot(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Ut},alphaTest:{value:0},uvTransform:{value:new Ut}},sprite:{diffuse:{value:new Ot(16777215)},opacity:{value:1},center:{value:new Pt(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Ut},alphaMap:{value:null},alphaMapTransform:{value:new Ut},alphaTest:{value:0}}},rn={basic:{uniforms:Pe([it.common,it.specularmap,it.envmap,it.aomap,it.lightmap,it.fog]),vertexShader:Ft.meshbasic_vert,fragmentShader:Ft.meshbasic_frag},lambert:{uniforms:Pe([it.common,it.specularmap,it.envmap,it.aomap,it.lightmap,it.emissivemap,it.bumpmap,it.normalmap,it.displacementmap,it.fog,it.lights,{emissive:{value:new Ot(0)}}]),vertexShader:Ft.meshlambert_vert,fragmentShader:Ft.meshlambert_frag},phong:{uniforms:Pe([it.common,it.specularmap,it.envmap,it.aomap,it.lightmap,it.emissivemap,it.bumpmap,it.normalmap,it.displacementmap,it.fog,it.lights,{emissive:{value:new Ot(0)},specular:{value:new Ot(1118481)},shininess:{value:30}}]),vertexShader:Ft.meshphong_vert,fragmentShader:Ft.meshphong_frag},standard:{uniforms:Pe([it.common,it.envmap,it.aomap,it.lightmap,it.emissivemap,it.bumpmap,it.normalmap,it.displacementmap,it.roughnessmap,it.metalnessmap,it.fog,it.lights,{emissive:{value:new Ot(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Ft.meshphysical_vert,fragmentShader:Ft.meshphysical_frag},toon:{uniforms:Pe([it.common,it.aomap,it.lightmap,it.emissivemap,it.bumpmap,it.normalmap,it.displacementmap,it.gradientmap,it.fog,it.lights,{emissive:{value:new Ot(0)}}]),vertexShader:Ft.meshtoon_vert,fragmentShader:Ft.meshtoon_frag},matcap:{uniforms:Pe([it.common,it.bumpmap,it.normalmap,it.displacementmap,it.fog,{matcap:{value:null}}]),vertexShader:Ft.meshmatcap_vert,fragmentShader:Ft.meshmatcap_frag},points:{uniforms:Pe([it.points,it.fog]),vertexShader:Ft.points_vert,fragmentShader:Ft.points_frag},dashed:{uniforms:Pe([it.common,it.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Ft.linedashed_vert,fragmentShader:Ft.linedashed_frag},depth:{uniforms:Pe([it.common,it.displacementmap]),vertexShader:Ft.depth_vert,fragmentShader:Ft.depth_frag},normal:{uniforms:Pe([it.common,it.bumpmap,it.normalmap,it.displacementmap,{opacity:{value:1}}]),vertexShader:Ft.meshnormal_vert,fragmentShader:Ft.meshnormal_frag},sprite:{uniforms:Pe([it.sprite,it.fog]),vertexShader:Ft.sprite_vert,fragmentShader:Ft.sprite_frag},background:{uniforms:{uvTransform:{value:new Ut},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Ft.background_vert,fragmentShader:Ft.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Ut}},vertexShader:Ft.backgroundCube_vert,fragmentShader:Ft.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Ft.cube_vert,fragmentShader:Ft.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Ft.equirect_vert,fragmentShader:Ft.equirect_frag},distanceRGBA:{uniforms:Pe([it.common,it.displacementmap,{referencePosition:{value:new C},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Ft.distanceRGBA_vert,fragmentShader:Ft.distanceRGBA_frag},shadow:{uniforms:Pe([it.lights,it.fog,{color:{value:new Ot(0)},opacity:{value:1}}]),vertexShader:Ft.shadow_vert,fragmentShader:Ft.shadow_frag}};rn.physical={uniforms:Pe([rn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Ut},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Ut},clearcoatNormalScale:{value:new Pt(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Ut},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Ut},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Ut},sheen:{value:0},sheenColor:{value:new Ot(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Ut},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Ut},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Ut},transmissionSamplerSize:{value:new Pt},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Ut},attenuationDistance:{value:0},attenuationColor:{value:new Ot(0)},specularColor:{value:new Ot(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Ut},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Ut},anisotropyVector:{value:new Pt},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Ut}}]),vertexShader:Ft.meshphysical_vert,fragmentShader:Ft.meshphysical_frag};const Es={r:0,b:0,g:0},Wn=new ze,Mf=new te;function Sf(s,t,e,n,i,r,a){const o=new Ot(0);let l=r===!0?0:1,c,h,u=null,f=0,p=null;function g(S){let w=S.isScene===!0?S.background:null;return w&&w.isTexture&&(w=(S.backgroundBlurriness>0?e:t).get(w)),w}function _(S){let w=!1;const v=g(S);v===null?d(o,l):v&&v.isColor&&(d(v,1),w=!0);const I=s.xr.getEnvironmentBlendMode();I==="additive"?n.buffers.color.setClear(0,0,0,1,a):I==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,a),(s.autoClear||w)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),s.clear(s.autoClearColor,s.autoClearDepth,s.autoClearStencil))}function m(S,w){const v=g(w);v&&(v.isCubeTexture||v.mapping===Ks)?(h===void 0&&(h=new et(new zt(1,1,1),new On({name:"BackgroundCubeMaterial",uniforms:Li(rn.backgroundCube.uniforms),vertexShader:rn.backgroundCube.vertexShader,fragmentShader:rn.backgroundCube.fragmentShader,side:Se,depthTest:!1,depthWrite:!1,fog:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(I,A,R){this.matrixWorld.copyPosition(R.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(h)),Wn.copy(w.backgroundRotation),Wn.x*=-1,Wn.y*=-1,Wn.z*=-1,v.isCubeTexture&&v.isRenderTargetTexture===!1&&(Wn.y*=-1,Wn.z*=-1),h.material.uniforms.envMap.value=v,h.material.uniforms.flipEnvMap.value=v.isCubeTexture&&v.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=w.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=w.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(Mf.makeRotationFromEuler(Wn)),h.material.toneMapped=Yt.getTransfer(v.colorSpace)!==ee,(u!==v||f!==v.version||p!==s.toneMapping)&&(h.material.needsUpdate=!0,u=v,f=v.version,p=s.toneMapping),h.layers.enableAll(),S.unshift(h,h.geometry,h.material,0,0,null)):v&&v.isTexture&&(c===void 0&&(c=new et(new _n(2,2),new On({name:"BackgroundMaterial",uniforms:Li(rn.background.uniforms),vertexShader:rn.background.vertexShader,fragmentShader:rn.background.fragmentShader,side:Fn,depthTest:!1,depthWrite:!1,fog:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(c)),c.material.uniforms.t2D.value=v,c.material.uniforms.backgroundIntensity.value=w.backgroundIntensity,c.material.toneMapped=Yt.getTransfer(v.colorSpace)!==ee,v.matrixAutoUpdate===!0&&v.updateMatrix(),c.material.uniforms.uvTransform.value.copy(v.matrix),(u!==v||f!==v.version||p!==s.toneMapping)&&(c.material.needsUpdate=!0,u=v,f=v.version,p=s.toneMapping),c.layers.enableAll(),S.unshift(c,c.geometry,c.material,0,0,null))}function d(S,w){S.getRGB(Es,Wl(s)),n.buffers.color.setClear(Es.r,Es.g,Es.b,w,a)}return{getClearColor:function(){return o},setClearColor:function(S,w=1){o.set(S),l=w,d(o,l)},getClearAlpha:function(){return l},setClearAlpha:function(S){l=S,d(o,l)},render:_,addToRenderList:m}}function Ef(s,t){const e=s.getParameter(s.MAX_VERTEX_ATTRIBS),n={},i=f(null);let r=i,a=!1;function o(y,P,H,B,V){let q=!1;const G=u(B,H,P);r!==G&&(r=G,c(r.object)),q=p(y,B,H,V),q&&g(y,B,H,V),V!==null&&t.update(V,s.ELEMENT_ARRAY_BUFFER),(q||a)&&(a=!1,v(y,P,H,B),V!==null&&s.bindBuffer(s.ELEMENT_ARRAY_BUFFER,t.get(V).buffer))}function l(){return s.createVertexArray()}function c(y){return s.bindVertexArray(y)}function h(y){return s.deleteVertexArray(y)}function u(y,P,H){const B=H.wireframe===!0;let V=n[y.id];V===void 0&&(V={},n[y.id]=V);let q=V[P.id];q===void 0&&(q={},V[P.id]=q);let G=q[B];return G===void 0&&(G=f(l()),q[B]=G),G}function f(y){const P=[],H=[],B=[];for(let V=0;V<e;V++)P[V]=0,H[V]=0,B[V]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:P,enabledAttributes:H,attributeDivisors:B,object:y,attributes:{},index:null}}function p(y,P,H,B){const V=r.attributes,q=P.attributes;let G=0;const J=H.getAttributes();for(const W in J)if(J[W].location>=0){const ut=V[W];let Mt=q[W];if(Mt===void 0&&(W==="instanceMatrix"&&y.instanceMatrix&&(Mt=y.instanceMatrix),W==="instanceColor"&&y.instanceColor&&(Mt=y.instanceColor)),ut===void 0||ut.attribute!==Mt||Mt&&ut.data!==Mt.data)return!0;G++}return r.attributesNum!==G||r.index!==B}function g(y,P,H,B){const V={},q=P.attributes;let G=0;const J=H.getAttributes();for(const W in J)if(J[W].location>=0){let ut=q[W];ut===void 0&&(W==="instanceMatrix"&&y.instanceMatrix&&(ut=y.instanceMatrix),W==="instanceColor"&&y.instanceColor&&(ut=y.instanceColor));const Mt={};Mt.attribute=ut,ut&&ut.data&&(Mt.data=ut.data),V[W]=Mt,G++}r.attributes=V,r.attributesNum=G,r.index=B}function _(){const y=r.newAttributes;for(let P=0,H=y.length;P<H;P++)y[P]=0}function m(y){d(y,0)}function d(y,P){const H=r.newAttributes,B=r.enabledAttributes,V=r.attributeDivisors;H[y]=1,B[y]===0&&(s.enableVertexAttribArray(y),B[y]=1),V[y]!==P&&(s.vertexAttribDivisor(y,P),V[y]=P)}function S(){const y=r.newAttributes,P=r.enabledAttributes;for(let H=0,B=P.length;H<B;H++)P[H]!==y[H]&&(s.disableVertexAttribArray(H),P[H]=0)}function w(y,P,H,B,V,q,G){G===!0?s.vertexAttribIPointer(y,P,H,V,q):s.vertexAttribPointer(y,P,H,B,V,q)}function v(y,P,H,B){_();const V=B.attributes,q=H.getAttributes(),G=P.defaultAttributeValues;for(const J in q){const W=q[J];if(W.location>=0){let rt=V[J];if(rt===void 0&&(J==="instanceMatrix"&&y.instanceMatrix&&(rt=y.instanceMatrix),J==="instanceColor"&&y.instanceColor&&(rt=y.instanceColor)),rt!==void 0){const ut=rt.normalized,Mt=rt.itemSize,Bt=t.get(rt);if(Bt===void 0)continue;const ie=Bt.buffer,$=Bt.type,nt=Bt.bytesPerElement,vt=$===s.INT||$===s.UNSIGNED_INT||rt.gpuType===Pa;if(rt.isInterleavedBufferAttribute){const at=rt.data,Tt=at.stride,Lt=rt.offset;if(at.isInstancedInterleavedBuffer){for(let kt=0;kt<W.locationSize;kt++)d(W.location+kt,at.meshPerAttribute);y.isInstancedMesh!==!0&&B._maxInstanceCount===void 0&&(B._maxInstanceCount=at.meshPerAttribute*at.count)}else for(let kt=0;kt<W.locationSize;kt++)m(W.location+kt);s.bindBuffer(s.ARRAY_BUFFER,ie);for(let kt=0;kt<W.locationSize;kt++)w(W.location+kt,Mt/W.locationSize,$,ut,Tt*nt,(Lt+Mt/W.locationSize*kt)*nt,vt)}else{if(rt.isInstancedBufferAttribute){for(let at=0;at<W.locationSize;at++)d(W.location+at,rt.meshPerAttribute);y.isInstancedMesh!==!0&&B._maxInstanceCount===void 0&&(B._maxInstanceCount=rt.meshPerAttribute*rt.count)}else for(let at=0;at<W.locationSize;at++)m(W.location+at);s.bindBuffer(s.ARRAY_BUFFER,ie);for(let at=0;at<W.locationSize;at++)w(W.location+at,Mt/W.locationSize,$,ut,Mt*nt,Mt/W.locationSize*at*nt,vt)}}else if(G!==void 0){const ut=G[J];if(ut!==void 0)switch(ut.length){case 2:s.vertexAttrib2fv(W.location,ut);break;case 3:s.vertexAttrib3fv(W.location,ut);break;case 4:s.vertexAttrib4fv(W.location,ut);break;default:s.vertexAttrib1fv(W.location,ut)}}}}S()}function I(){L();for(const y in n){const P=n[y];for(const H in P){const B=P[H];for(const V in B)h(B[V].object),delete B[V];delete P[H]}delete n[y]}}function A(y){if(n[y.id]===void 0)return;const P=n[y.id];for(const H in P){const B=P[H];for(const V in B)h(B[V].object),delete B[V];delete P[H]}delete n[y.id]}function R(y){for(const P in n){const H=n[P];if(H[y.id]===void 0)continue;const B=H[y.id];for(const V in B)h(B[V].object),delete B[V];delete H[y.id]}}function L(){E(),a=!0,r!==i&&(r=i,c(r.object))}function E(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:o,reset:L,resetDefaultState:E,dispose:I,releaseStatesOfGeometry:A,releaseStatesOfProgram:R,initAttributes:_,enableAttribute:m,disableUnusedAttributes:S}}function wf(s,t,e){let n;function i(c){n=c}function r(c,h){s.drawArrays(n,c,h),e.update(h,n,1)}function a(c,h,u){u!==0&&(s.drawArraysInstanced(n,c,h,u),e.update(h,n,u))}function o(c,h,u){if(u===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,c,0,h,0,u);let p=0;for(let g=0;g<u;g++)p+=h[g];e.update(p,n,1)}function l(c,h,u,f){if(u===0)return;const p=t.get("WEBGL_multi_draw");if(p===null)for(let g=0;g<c.length;g++)a(c[g],h[g],f[g]);else{p.multiDrawArraysInstancedWEBGL(n,c,0,h,0,f,0,u);let g=0;for(let _=0;_<u;_++)g+=h[_]*f[_];e.update(g,n,1)}}this.setMode=i,this.render=r,this.renderInstances=a,this.renderMultiDraw=o,this.renderMultiDrawInstances=l}function bf(s,t,e,n){let i;function r(){if(i!==void 0)return i;if(t.has("EXT_texture_filter_anisotropic")===!0){const R=t.get("EXT_texture_filter_anisotropic");i=s.getParameter(R.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function a(R){return!(R!==nn&&n.convert(R)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(R){const L=R===ns&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(R!==Mn&&n.convert(R)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_TYPE)&&R!==on&&!L)}function l(R){if(R==="highp"){if(s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.HIGH_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.HIGH_FLOAT).precision>0)return"highp";R="mediump"}return R==="mediump"&&s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.MEDIUM_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=e.precision!==void 0?e.precision:"highp";const h=l(c);h!==c&&(console.warn("THREE.WebGLRenderer:",c,"not supported, using",h,"instead."),c=h);const u=e.logarithmicDepthBuffer===!0,f=e.reverseDepthBuffer===!0&&t.has("EXT_clip_control"),p=s.getParameter(s.MAX_TEXTURE_IMAGE_UNITS),g=s.getParameter(s.MAX_VERTEX_TEXTURE_IMAGE_UNITS),_=s.getParameter(s.MAX_TEXTURE_SIZE),m=s.getParameter(s.MAX_CUBE_MAP_TEXTURE_SIZE),d=s.getParameter(s.MAX_VERTEX_ATTRIBS),S=s.getParameter(s.MAX_VERTEX_UNIFORM_VECTORS),w=s.getParameter(s.MAX_VARYING_VECTORS),v=s.getParameter(s.MAX_FRAGMENT_UNIFORM_VECTORS),I=g>0,A=s.getParameter(s.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:c,logarithmicDepthBuffer:u,reverseDepthBuffer:f,maxTextures:p,maxVertexTextures:g,maxTextureSize:_,maxCubemapSize:m,maxAttributes:d,maxVertexUniforms:S,maxVaryings:w,maxFragmentUniforms:v,vertexTextures:I,maxSamples:A}}function Tf(s){const t=this;let e=null,n=0,i=!1,r=!1;const a=new qn,o=new Ut,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(u,f){const p=u.length!==0||f||n!==0||i;return i=f,n=u.length,p},this.beginShadows=function(){r=!0,h(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(u,f){e=h(u,f,0)},this.setState=function(u,f,p){const g=u.clippingPlanes,_=u.clipIntersection,m=u.clipShadows,d=s.get(u);if(!i||g===null||g.length===0||r&&!m)r?h(null):c();else{const S=r?0:n,w=S*4;let v=d.clippingState||null;l.value=v,v=h(g,f,w,p);for(let I=0;I!==w;++I)v[I]=e[I];d.clippingState=v,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=S}};function c(){l.value!==e&&(l.value=e,l.needsUpdate=n>0),t.numPlanes=n,t.numIntersection=0}function h(u,f,p,g){const _=u!==null?u.length:0;let m=null;if(_!==0){if(m=l.value,g!==!0||m===null){const d=p+_*4,S=f.matrixWorldInverse;o.getNormalMatrix(S),(m===null||m.length<d)&&(m=new Float32Array(d));for(let w=0,v=p;w!==_;++w,v+=4)a.copy(u[w]).applyMatrix4(S,o),a.normal.toArray(m,v),m[v+3]=a.constant}l.value=m,l.needsUpdate=!0}return t.numPlanes=_,t.numIntersection=0,m}}function Af(s){let t=new WeakMap;function e(a,o){return o===$r?a.mapping=Ai:o===Kr&&(a.mapping=Ri),a}function n(a){if(a&&a.isTexture){const o=a.mapping;if(o===$r||o===Kr)if(t.has(a)){const l=t.get(a).texture;return e(l,a.mapping)}else{const l=a.image;if(l&&l.height>0){const c=new Oh(l.height);return c.fromEquirectangularTexture(s,a),t.set(a,c),a.addEventListener("dispose",i),e(c.texture,a.mapping)}else return null}}return a}function i(a){const o=a.target;o.removeEventListener("dispose",i);const l=t.get(o);l!==void 0&&(t.delete(o),l.dispose())}function r(){t=new WeakMap}return{get:n,dispose:r}}class $l extends Xl{constructor(t=-1,e=1,n=1,i=-1,r=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=n,this.bottom=i,this.near=r,this.far=a,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,n,i,r,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=i,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,i=(this.top+this.bottom)/2;let r=n-t,a=n+t,o=i+e,l=i-e;if(this.view!==null&&this.view.enabled){const c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,a=r+c*this.view.width,o-=h*this.view.offsetY,l=o-h*this.view.height}this.projectionMatrix.makeOrthographic(r,a,o,l,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}}const Si=4,Ro=[.125,.215,.35,.446,.526,.582],Kn=20,Er=new $l,Co=new Ot;let wr=null,br=0,Tr=0,Ar=!1;const Yn=(1+Math.sqrt(5))/2,gi=1/Yn,Po=[new C(-Yn,gi,0),new C(Yn,gi,0),new C(-gi,0,Yn),new C(gi,0,Yn),new C(0,Yn,-gi),new C(0,Yn,gi),new C(-1,1,-1),new C(1,1,-1),new C(-1,1,1),new C(1,1,1)];class Lo{constructor(t){this._renderer=t,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(t,e=0,n=.1,i=100){wr=this._renderer.getRenderTarget(),br=this._renderer.getActiveCubeFace(),Tr=this._renderer.getActiveMipmapLevel(),Ar=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(256);const r=this._allocateTargets();return r.depthBuffer=!0,this._sceneToCubeUV(t,n,i,r),e>0&&this._blur(r,0,0,e),this._applyPMREM(r),this._cleanup(r),r}fromEquirectangular(t,e=null){return this._fromTexture(t,e)}fromCubemap(t,e=null){return this._fromTexture(t,e)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Uo(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Do(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(t){this._lodMax=Math.floor(Math.log2(t)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let t=0;t<this._lodPlanes.length;t++)this._lodPlanes[t].dispose()}_cleanup(t){this._renderer.setRenderTarget(wr,br,Tr),this._renderer.xr.enabled=Ar,t.scissorTest=!1,ws(t,0,0,t.width,t.height)}_fromTexture(t,e){t.mapping===Ai||t.mapping===Ri?this._setSize(t.image.length===0?16:t.image[0].width||t.image[0].image.width):this._setSize(t.image.width/4),wr=this._renderer.getRenderTarget(),br=this._renderer.getActiveCubeFace(),Tr=this._renderer.getActiveMipmapLevel(),Ar=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const n=e||this._allocateTargets();return this._textureToCubeUV(t,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const t=3*Math.max(this._cubeSize,112),e=4*this._cubeSize,n={magFilter:an,minFilter:an,generateMipmaps:!1,type:ns,format:nn,colorSpace:Ii,depthBuffer:!1},i=Io(t,e,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==t||this._pingPongRenderTarget.height!==e){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Io(t,e,n);const{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=Rf(r)),this._blurMaterial=Cf(r,t,e)}return i}_compileMaterial(t){const e=new et(this._lodPlanes[0],t);this._renderer.compile(e,Er)}_sceneToCubeUV(t,e,n,i){const o=new Ie(90,1,e,n),l=[1,-1,1,1,1,1],c=[1,1,1,-1,-1,-1],h=this._renderer,u=h.autoClear,f=h.toneMapping;h.getClearColor(Co),h.toneMapping=Un,h.autoClear=!1;const p=new Et({name:"PMREM.Background",side:Se,depthWrite:!1,depthTest:!1}),g=new et(new zt,p);let _=!1;const m=t.background;m?m.isColor&&(p.color.copy(m),t.background=null,_=!0):(p.color.copy(Co),_=!0);for(let d=0;d<6;d++){const S=d%3;S===0?(o.up.set(0,l[d],0),o.lookAt(c[d],0,0)):S===1?(o.up.set(0,0,l[d]),o.lookAt(0,c[d],0)):(o.up.set(0,l[d],0),o.lookAt(0,0,c[d]));const w=this._cubeSize;ws(i,S*w,d>2?w:0,w,w),h.setRenderTarget(i),_&&h.render(g,o),h.render(t,o)}g.geometry.dispose(),g.material.dispose(),h.toneMapping=f,h.autoClear=u,t.background=m}_textureToCubeUV(t,e){const n=this._renderer,i=t.mapping===Ai||t.mapping===Ri;i?(this._cubemapMaterial===null&&(this._cubemapMaterial=Uo()),this._cubemapMaterial.uniforms.flipEnvMap.value=t.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Do());const r=i?this._cubemapMaterial:this._equirectMaterial,a=new et(this._lodPlanes[0],r),o=r.uniforms;o.envMap.value=t;const l=this._cubeSize;ws(e,0,0,3*l,2*l),n.setRenderTarget(e),n.render(a,Er)}_applyPMREM(t){const e=this._renderer,n=e.autoClear;e.autoClear=!1;const i=this._lodPlanes.length;for(let r=1;r<i;r++){const a=Math.sqrt(this._sigmas[r]*this._sigmas[r]-this._sigmas[r-1]*this._sigmas[r-1]),o=Po[(i-r-1)%Po.length];this._blur(t,r-1,r,a,o)}e.autoClear=n}_blur(t,e,n,i,r){const a=this._pingPongRenderTarget;this._halfBlur(t,a,e,n,i,"latitudinal",r),this._halfBlur(a,t,n,n,i,"longitudinal",r)}_halfBlur(t,e,n,i,r,a,o){const l=this._renderer,c=this._blurMaterial;a!=="latitudinal"&&a!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const h=3,u=new et(this._lodPlanes[i],c),f=c.uniforms,p=this._sizeLods[n]-1,g=isFinite(r)?Math.PI/(2*p):2*Math.PI/(2*Kn-1),_=r/g,m=isFinite(r)?1+Math.floor(h*_):Kn;m>Kn&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${Kn}`);const d=[];let S=0;for(let R=0;R<Kn;++R){const L=R/_,E=Math.exp(-L*L/2);d.push(E),R===0?S+=E:R<m&&(S+=2*E)}for(let R=0;R<d.length;R++)d[R]=d[R]/S;f.envMap.value=t.texture,f.samples.value=m,f.weights.value=d,f.latitudinal.value=a==="latitudinal",o&&(f.poleAxis.value=o);const{_lodMax:w}=this;f.dTheta.value=g,f.mipInt.value=w-n;const v=this._sizeLods[i],I=3*v*(i>w-Si?i-w+Si:0),A=4*(this._cubeSize-v);ws(e,I,A,3*v,2*v),l.setRenderTarget(e),l.render(u,Er)}}function Rf(s){const t=[],e=[],n=[];let i=s;const r=s-Si+1+Ro.length;for(let a=0;a<r;a++){const o=Math.pow(2,i);e.push(o);let l=1/o;a>s-Si?l=Ro[a-s+Si-1]:a===0&&(l=0),n.push(l);const c=1/(o-2),h=-c,u=1+c,f=[h,h,u,h,u,u,h,h,u,u,h,u],p=6,g=6,_=3,m=2,d=1,S=new Float32Array(_*g*p),w=new Float32Array(m*g*p),v=new Float32Array(d*g*p);for(let A=0;A<p;A++){const R=A%3*2/3-1,L=A>2?0:-1,E=[R,L,0,R+2/3,L,0,R+2/3,L+1,0,R,L,0,R+2/3,L+1,0,R,L+1,0];S.set(E,_*g*A),w.set(f,m*g*A);const y=[A,A,A,A,A,A];v.set(y,d*g*A)}const I=new ve;I.setAttribute("position",new De(S,_)),I.setAttribute("uv",new De(w,m)),I.setAttribute("faceIndex",new De(v,d)),t.push(I),i>Si&&i--}return{lodPlanes:t,sizeLods:e,sigmas:n}}function Io(s,t,e){const n=new Sn(s,t,e);return n.texture.mapping=Ks,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function ws(s,t,e,n,i){s.viewport.set(t,e,n,i),s.scissor.set(t,e,n,i)}function Cf(s,t,e){const n=new Float32Array(Kn),i=new C(0,1,0);return new On({name:"SphericalGaussianBlur",defines:{n:Kn,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${s}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:i}},vertexShader:za(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:Dn,depthTest:!1,depthWrite:!1})}function Do(){return new On({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:za(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:Dn,depthTest:!1,depthWrite:!1})}function Uo(){return new On({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:za(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Dn,depthTest:!1,depthWrite:!1})}function za(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function Pf(s){let t=new WeakMap,e=null;function n(o){if(o&&o.isTexture){const l=o.mapping,c=l===$r||l===Kr,h=l===Ai||l===Ri;if(c||h){let u=t.get(o);const f=u!==void 0?u.texture.pmremVersion:0;if(o.isRenderTargetTexture&&o.pmremVersion!==f)return e===null&&(e=new Lo(s)),u=c?e.fromEquirectangular(o,u):e.fromCubemap(o,u),u.texture.pmremVersion=o.pmremVersion,t.set(o,u),u.texture;if(u!==void 0)return u.texture;{const p=o.image;return c&&p&&p.height>0||h&&p&&i(p)?(e===null&&(e=new Lo(s)),u=c?e.fromEquirectangular(o):e.fromCubemap(o),u.texture.pmremVersion=o.pmremVersion,t.set(o,u),o.addEventListener("dispose",r),u.texture):null}}}return o}function i(o){let l=0;const c=6;for(let h=0;h<c;h++)o[h]!==void 0&&l++;return l===c}function r(o){const l=o.target;l.removeEventListener("dispose",r);const c=t.get(l);c!==void 0&&(t.delete(l),c.dispose())}function a(){t=new WeakMap,e!==null&&(e.dispose(),e=null)}return{get:n,dispose:a}}function Lf(s){const t={};function e(n){if(t[n]!==void 0)return t[n];let i;switch(n){case"WEBGL_depth_texture":i=s.getExtension("WEBGL_depth_texture")||s.getExtension("MOZ_WEBGL_depth_texture")||s.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":i=s.getExtension("EXT_texture_filter_anisotropic")||s.getExtension("MOZ_EXT_texture_filter_anisotropic")||s.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":i=s.getExtension("WEBGL_compressed_texture_s3tc")||s.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||s.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":i=s.getExtension("WEBGL_compressed_texture_pvrtc")||s.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:i=s.getExtension(n)}return t[n]=i,i}return{has:function(n){return e(n)!==null},init:function(){e("EXT_color_buffer_float"),e("WEBGL_clip_cull_distance"),e("OES_texture_float_linear"),e("EXT_color_buffer_half_float"),e("WEBGL_multisampled_render_to_texture"),e("WEBGL_render_shared_exponent")},get:function(n){const i=e(n);return i===null&&Ki("THREE.WebGLRenderer: "+n+" extension not supported."),i}}}function If(s,t,e,n){const i={},r=new WeakMap;function a(u){const f=u.target;f.index!==null&&t.remove(f.index);for(const g in f.attributes)t.remove(f.attributes[g]);for(const g in f.morphAttributes){const _=f.morphAttributes[g];for(let m=0,d=_.length;m<d;m++)t.remove(_[m])}f.removeEventListener("dispose",a),delete i[f.id];const p=r.get(f);p&&(t.remove(p),r.delete(f)),n.releaseStatesOfGeometry(f),f.isInstancedBufferGeometry===!0&&delete f._maxInstanceCount,e.memory.geometries--}function o(u,f){return i[f.id]===!0||(f.addEventListener("dispose",a),i[f.id]=!0,e.memory.geometries++),f}function l(u){const f=u.attributes;for(const g in f)t.update(f[g],s.ARRAY_BUFFER);const p=u.morphAttributes;for(const g in p){const _=p[g];for(let m=0,d=_.length;m<d;m++)t.update(_[m],s.ARRAY_BUFFER)}}function c(u){const f=[],p=u.index,g=u.attributes.position;let _=0;if(p!==null){const S=p.array;_=p.version;for(let w=0,v=S.length;w<v;w+=3){const I=S[w+0],A=S[w+1],R=S[w+2];f.push(I,A,A,R,R,I)}}else if(g!==void 0){const S=g.array;_=g.version;for(let w=0,v=S.length/3-1;w<v;w+=3){const I=w+0,A=w+1,R=w+2;f.push(I,A,A,R,R,I)}}else return;const m=new(Ol(f)?Gl:Vl)(f,1);m.version=_;const d=r.get(u);d&&t.remove(d),r.set(u,m)}function h(u){const f=r.get(u);if(f){const p=u.index;p!==null&&f.version<p.version&&c(u)}else c(u);return r.get(u)}return{get:o,update:l,getWireframeAttribute:h}}function Df(s,t,e){let n;function i(f){n=f}let r,a;function o(f){r=f.type,a=f.bytesPerElement}function l(f,p){s.drawElements(n,p,r,f*a),e.update(p,n,1)}function c(f,p,g){g!==0&&(s.drawElementsInstanced(n,p,r,f*a,g),e.update(p,n,g))}function h(f,p,g){if(g===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,p,0,r,f,0,g);let m=0;for(let d=0;d<g;d++)m+=p[d];e.update(m,n,1)}function u(f,p,g,_){if(g===0)return;const m=t.get("WEBGL_multi_draw");if(m===null)for(let d=0;d<f.length;d++)c(f[d]/a,p[d],_[d]);else{m.multiDrawElementsInstancedWEBGL(n,p,0,r,f,0,_,0,g);let d=0;for(let S=0;S<g;S++)d+=p[S]*_[S];e.update(d,n,1)}}this.setMode=i,this.setIndex=o,this.render=l,this.renderInstances=c,this.renderMultiDraw=h,this.renderMultiDrawInstances=u}function Uf(s){const t={geometries:0,textures:0},e={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,a,o){switch(e.calls++,a){case s.TRIANGLES:e.triangles+=o*(r/3);break;case s.LINES:e.lines+=o*(r/2);break;case s.LINE_STRIP:e.lines+=o*(r-1);break;case s.LINE_LOOP:e.lines+=o*r;break;case s.POINTS:e.points+=o*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",a);break}}function i(){e.calls=0,e.triangles=0,e.points=0,e.lines=0}return{memory:t,render:e,programs:null,autoReset:!0,reset:i,update:n}}function Nf(s,t,e){const n=new WeakMap,i=new ne;function r(a,o,l){const c=a.morphTargetInfluences,h=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=h!==void 0?h.length:0;let f=n.get(o);if(f===void 0||f.count!==u){let E=function(){R.dispose(),n.delete(o),o.removeEventListener("dispose",E)};f!==void 0&&f.texture.dispose();const p=o.morphAttributes.position!==void 0,g=o.morphAttributes.normal!==void 0,_=o.morphAttributes.color!==void 0,m=o.morphAttributes.position||[],d=o.morphAttributes.normal||[],S=o.morphAttributes.color||[];let w=0;p===!0&&(w=1),g===!0&&(w=2),_===!0&&(w=3);let v=o.attributes.position.count*w,I=1;v>t.maxTextureSize&&(I=Math.ceil(v/t.maxTextureSize),v=t.maxTextureSize);const A=new Float32Array(v*I*4*u),R=new kl(A,v,I,u);R.type=on,R.needsUpdate=!0;const L=w*4;for(let y=0;y<u;y++){const P=m[y],H=d[y],B=S[y],V=v*I*4*y;for(let q=0;q<P.count;q++){const G=q*L;p===!0&&(i.fromBufferAttribute(P,q),A[V+G+0]=i.x,A[V+G+1]=i.y,A[V+G+2]=i.z,A[V+G+3]=0),g===!0&&(i.fromBufferAttribute(H,q),A[V+G+4]=i.x,A[V+G+5]=i.y,A[V+G+6]=i.z,A[V+G+7]=0),_===!0&&(i.fromBufferAttribute(B,q),A[V+G+8]=i.x,A[V+G+9]=i.y,A[V+G+10]=i.z,A[V+G+11]=B.itemSize===4?i.w:1)}}f={count:u,texture:R,size:new Pt(v,I)},n.set(o,f),o.addEventListener("dispose",E)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(s,"morphTexture",a.morphTexture,e);else{let p=0;for(let _=0;_<c.length;_++)p+=c[_];const g=o.morphTargetsRelative?1:1-p;l.getUniforms().setValue(s,"morphTargetBaseInfluence",g),l.getUniforms().setValue(s,"morphTargetInfluences",c)}l.getUniforms().setValue(s,"morphTargetsTexture",f.texture,e),l.getUniforms().setValue(s,"morphTargetsTextureSize",f.size)}return{update:r}}function Ff(s,t,e,n){let i=new WeakMap;function r(l){const c=n.render.frame,h=l.geometry,u=t.get(l,h);if(i.get(u)!==c&&(t.update(u),i.set(u,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",o)===!1&&l.addEventListener("dispose",o),i.get(l)!==c&&(e.update(l.instanceMatrix,s.ARRAY_BUFFER),l.instanceColor!==null&&e.update(l.instanceColor,s.ARRAY_BUFFER),i.set(l,c))),l.isSkinnedMesh){const f=l.skeleton;i.get(f)!==c&&(f.update(),i.set(f,c))}return u}function a(){i=new WeakMap}function o(l){const c=l.target;c.removeEventListener("dispose",o),e.remove(c.instanceMatrix),c.instanceColor!==null&&e.remove(c.instanceColor)}return{update:r,dispose:a}}class Kl extends Re{constructor(t,e,n,i,r,a,o,l,c,h=wi){if(h!==wi&&h!==Pi)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");n===void 0&&h===wi&&(n=Jn),n===void 0&&h===Pi&&(n=Ci),super(null,i,r,a,o,l,h,n,c),this.isDepthTexture=!0,this.image={width:t,height:e},this.magFilter=o!==void 0?o:We,this.minFilter=l!==void 0?l:We,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(t){return super.copy(t),this.compareFunction=t.compareFunction,this}toJSON(t){const e=super.toJSON(t);return this.compareFunction!==null&&(e.compareFunction=this.compareFunction),e}}const jl=new Re,No=new Kl(1,1),Zl=new kl,Jl=new Mh,Ql=new ql,Fo=[],Oo=[],Bo=new Float32Array(16),ko=new Float32Array(9),zo=new Float32Array(4);function Ui(s,t,e){const n=s[0];if(n<=0||n>0)return s;const i=t*e;let r=Fo[i];if(r===void 0&&(r=new Float32Array(i),Fo[i]=r),t!==0){n.toArray(r,0);for(let a=1,o=0;a!==t;++a)o+=e,s[a].toArray(r,o)}return r}function xe(s,t){if(s.length!==t.length)return!1;for(let e=0,n=s.length;e<n;e++)if(s[e]!==t[e])return!1;return!0}function ye(s,t){for(let e=0,n=t.length;e<n;e++)s[e]=t[e]}function Zs(s,t){let e=Oo[t];e===void 0&&(e=new Int32Array(t),Oo[t]=e);for(let n=0;n!==t;++n)e[n]=s.allocateTextureUnit();return e}function Of(s,t){const e=this.cache;e[0]!==t&&(s.uniform1f(this.addr,t),e[0]=t)}function Bf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2f(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(xe(e,t))return;s.uniform2fv(this.addr,t),ye(e,t)}}function kf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3f(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else if(t.r!==void 0)(e[0]!==t.r||e[1]!==t.g||e[2]!==t.b)&&(s.uniform3f(this.addr,t.r,t.g,t.b),e[0]=t.r,e[1]=t.g,e[2]=t.b);else{if(xe(e,t))return;s.uniform3fv(this.addr,t),ye(e,t)}}function zf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4f(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(xe(e,t))return;s.uniform4fv(this.addr,t),ye(e,t)}}function Hf(s,t){const e=this.cache,n=t.elements;if(n===void 0){if(xe(e,t))return;s.uniformMatrix2fv(this.addr,!1,t),ye(e,t)}else{if(xe(e,n))return;zo.set(n),s.uniformMatrix2fv(this.addr,!1,zo),ye(e,n)}}function Vf(s,t){const e=this.cache,n=t.elements;if(n===void 0){if(xe(e,t))return;s.uniformMatrix3fv(this.addr,!1,t),ye(e,t)}else{if(xe(e,n))return;ko.set(n),s.uniformMatrix3fv(this.addr,!1,ko),ye(e,n)}}function Gf(s,t){const e=this.cache,n=t.elements;if(n===void 0){if(xe(e,t))return;s.uniformMatrix4fv(this.addr,!1,t),ye(e,t)}else{if(xe(e,n))return;Bo.set(n),s.uniformMatrix4fv(this.addr,!1,Bo),ye(e,n)}}function Wf(s,t){const e=this.cache;e[0]!==t&&(s.uniform1i(this.addr,t),e[0]=t)}function Xf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2i(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(xe(e,t))return;s.uniform2iv(this.addr,t),ye(e,t)}}function qf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3i(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(xe(e,t))return;s.uniform3iv(this.addr,t),ye(e,t)}}function Yf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4i(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(xe(e,t))return;s.uniform4iv(this.addr,t),ye(e,t)}}function $f(s,t){const e=this.cache;e[0]!==t&&(s.uniform1ui(this.addr,t),e[0]=t)}function Kf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2ui(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(xe(e,t))return;s.uniform2uiv(this.addr,t),ye(e,t)}}function jf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3ui(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(xe(e,t))return;s.uniform3uiv(this.addr,t),ye(e,t)}}function Zf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4ui(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(xe(e,t))return;s.uniform4uiv(this.addr,t),ye(e,t)}}function Jf(s,t,e){const n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i);let r;this.type===s.SAMPLER_2D_SHADOW?(No.compareFunction=Fl,r=No):r=jl,e.setTexture2D(t||r,i)}function Qf(s,t,e){const n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),e.setTexture3D(t||Jl,i)}function tp(s,t,e){const n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),e.setTextureCube(t||Ql,i)}function ep(s,t,e){const n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),e.setTexture2DArray(t||Zl,i)}function np(s){switch(s){case 5126:return Of;case 35664:return Bf;case 35665:return kf;case 35666:return zf;case 35674:return Hf;case 35675:return Vf;case 35676:return Gf;case 5124:case 35670:return Wf;case 35667:case 35671:return Xf;case 35668:case 35672:return qf;case 35669:case 35673:return Yf;case 5125:return $f;case 36294:return Kf;case 36295:return jf;case 36296:return Zf;case 35678:case 36198:case 36298:case 36306:case 35682:return Jf;case 35679:case 36299:case 36307:return Qf;case 35680:case 36300:case 36308:case 36293:return tp;case 36289:case 36303:case 36311:case 36292:return ep}}function ip(s,t){s.uniform1fv(this.addr,t)}function sp(s,t){const e=Ui(t,this.size,2);s.uniform2fv(this.addr,e)}function rp(s,t){const e=Ui(t,this.size,3);s.uniform3fv(this.addr,e)}function ap(s,t){const e=Ui(t,this.size,4);s.uniform4fv(this.addr,e)}function op(s,t){const e=Ui(t,this.size,4);s.uniformMatrix2fv(this.addr,!1,e)}function lp(s,t){const e=Ui(t,this.size,9);s.uniformMatrix3fv(this.addr,!1,e)}function cp(s,t){const e=Ui(t,this.size,16);s.uniformMatrix4fv(this.addr,!1,e)}function hp(s,t){s.uniform1iv(this.addr,t)}function up(s,t){s.uniform2iv(this.addr,t)}function dp(s,t){s.uniform3iv(this.addr,t)}function fp(s,t){s.uniform4iv(this.addr,t)}function pp(s,t){s.uniform1uiv(this.addr,t)}function mp(s,t){s.uniform2uiv(this.addr,t)}function gp(s,t){s.uniform3uiv(this.addr,t)}function _p(s,t){s.uniform4uiv(this.addr,t)}function vp(s,t,e){const n=this.cache,i=t.length,r=Zs(e,i);xe(n,r)||(s.uniform1iv(this.addr,r),ye(n,r));for(let a=0;a!==i;++a)e.setTexture2D(t[a]||jl,r[a])}function xp(s,t,e){const n=this.cache,i=t.length,r=Zs(e,i);xe(n,r)||(s.uniform1iv(this.addr,r),ye(n,r));for(let a=0;a!==i;++a)e.setTexture3D(t[a]||Jl,r[a])}function yp(s,t,e){const n=this.cache,i=t.length,r=Zs(e,i);xe(n,r)||(s.uniform1iv(this.addr,r),ye(n,r));for(let a=0;a!==i;++a)e.setTextureCube(t[a]||Ql,r[a])}function Mp(s,t,e){const n=this.cache,i=t.length,r=Zs(e,i);xe(n,r)||(s.uniform1iv(this.addr,r),ye(n,r));for(let a=0;a!==i;++a)e.setTexture2DArray(t[a]||Zl,r[a])}function Sp(s){switch(s){case 5126:return ip;case 35664:return sp;case 35665:return rp;case 35666:return ap;case 35674:return op;case 35675:return lp;case 35676:return cp;case 5124:case 35670:return hp;case 35667:case 35671:return up;case 35668:case 35672:return dp;case 35669:case 35673:return fp;case 5125:return pp;case 36294:return mp;case 36295:return gp;case 36296:return _p;case 35678:case 36198:case 36298:case 36306:case 35682:return vp;case 35679:case 36299:case 36307:return xp;case 35680:case 36300:case 36308:case 36293:return yp;case 36289:case 36303:case 36311:case 36292:return Mp}}class Ep{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.setValue=np(e.type)}}class wp{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.size=e.size,this.setValue=Sp(e.type)}}class bp{constructor(t){this.id=t,this.seq=[],this.map={}}setValue(t,e,n){const i=this.seq;for(let r=0,a=i.length;r!==a;++r){const o=i[r];o.setValue(t,e[o.id],n)}}}const Rr=/(\w+)(\])?(\[|\.)?/g;function Ho(s,t){s.seq.push(t),s.map[t.id]=t}function Tp(s,t,e){const n=s.name,i=n.length;for(Rr.lastIndex=0;;){const r=Rr.exec(n),a=Rr.lastIndex;let o=r[1];const l=r[2]==="]",c=r[3];if(l&&(o=o|0),c===void 0||c==="["&&a+2===i){Ho(e,c===void 0?new Ep(o,s,t):new wp(o,s,t));break}else{let u=e.map[o];u===void 0&&(u=new bp(o),Ho(e,u)),e=u}}}class Hs{constructor(t,e){this.seq=[],this.map={};const n=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let i=0;i<n;++i){const r=t.getActiveUniform(e,i),a=t.getUniformLocation(e,r.name);Tp(r,a,this)}}setValue(t,e,n,i){const r=this.map[e];r!==void 0&&r.setValue(t,n,i)}setOptional(t,e,n){const i=e[n];i!==void 0&&this.setValue(t,n,i)}static upload(t,e,n,i){for(let r=0,a=e.length;r!==a;++r){const o=e[r],l=n[o.id];l.needsUpdate!==!1&&o.setValue(t,l.value,i)}}static seqWithValue(t,e){const n=[];for(let i=0,r=t.length;i!==r;++i){const a=t[i];a.id in e&&n.push(a)}return n}}function Vo(s,t,e){const n=s.createShader(t);return s.shaderSource(n,e),s.compileShader(n),n}const Ap=37297;let Rp=0;function Cp(s,t){const e=s.split(`
`),n=[],i=Math.max(t-6,0),r=Math.min(t+6,e.length);for(let a=i;a<r;a++){const o=a+1;n.push(`${o===t?">":" "} ${o}: ${e[a]}`)}return n.join(`
`)}const Go=new Ut;function Pp(s){Yt._getMatrix(Go,Yt.workingColorSpace,s);const t=`mat3( ${Go.elements.map(e=>e.toFixed(4))} )`;switch(Yt.getTransfer(s)){case js:return[t,"LinearTransferOETF"];case ee:return[t,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",s),[t,"LinearTransferOETF"]}}function Wo(s,t,e){const n=s.getShaderParameter(t,s.COMPILE_STATUS),i=s.getShaderInfoLog(t).trim();if(n&&i==="")return"";const r=/ERROR: 0:(\d+)/.exec(i);if(r){const a=parseInt(r[1]);return e.toUpperCase()+`

`+i+`

`+Cp(s.getShaderSource(t),a)}else return i}function Lp(s,t){const e=Pp(t);return[`vec4 ${s}( vec4 value ) {`,`	return ${e[1]}( vec4( value.rgb * ${e[0]}, value.a ) );`,"}"].join(`
`)}function Ip(s,t){let e;switch(t){case Uc:e="Linear";break;case Nc:e="Reinhard";break;case Fc:e="Cineon";break;case wl:e="ACESFilmic";break;case Bc:e="AgX";break;case kc:e="Neutral";break;case Oc:e="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",t),e="Linear"}return"vec3 "+s+"( vec3 color ) { return "+e+"ToneMapping( color ); }"}const bs=new C;function Dp(){Yt.getLuminanceCoefficients(bs);const s=bs.x.toFixed(4),t=bs.y.toFixed(4),e=bs.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${s}, ${t}, ${e} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Up(s){return[s.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",s.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(ji).join(`
`)}function Np(s){const t=[];for(const e in s){const n=s[e];n!==!1&&t.push("#define "+e+" "+n)}return t.join(`
`)}function Fp(s,t){const e={},n=s.getProgramParameter(t,s.ACTIVE_ATTRIBUTES);for(let i=0;i<n;i++){const r=s.getActiveAttrib(t,i),a=r.name;let o=1;r.type===s.FLOAT_MAT2&&(o=2),r.type===s.FLOAT_MAT3&&(o=3),r.type===s.FLOAT_MAT4&&(o=4),e[a]={type:r.type,location:s.getAttribLocation(t,a),locationSize:o}}return e}function ji(s){return s!==""}function Xo(s,t){const e=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return s.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,e).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function qo(s,t){return s.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}const Op=/^[ \t]*#include +<([\w\d./]+)>/gm;function ba(s){return s.replace(Op,kp)}const Bp=new Map;function kp(s,t){let e=Ft[t];if(e===void 0){const n=Bp.get(t);if(n!==void 0)e=Ft[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,n);else throw new Error("Can not resolve #include <"+t+">")}return ba(e)}const zp=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Yo(s){return s.replace(zp,Hp)}function Hp(s,t,e,n){let i="";for(let r=parseInt(t);r<parseInt(e);r++)i+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return i}function $o(s){let t=`precision ${s.precision} float;
	precision ${s.precision} int;
	precision ${s.precision} sampler2D;
	precision ${s.precision} samplerCube;
	precision ${s.precision} sampler3D;
	precision ${s.precision} sampler2DArray;
	precision ${s.precision} sampler2DShadow;
	precision ${s.precision} samplerCubeShadow;
	precision ${s.precision} sampler2DArrayShadow;
	precision ${s.precision} isampler2D;
	precision ${s.precision} isampler3D;
	precision ${s.precision} isamplerCube;
	precision ${s.precision} isampler2DArray;
	precision ${s.precision} usampler2D;
	precision ${s.precision} usampler3D;
	precision ${s.precision} usamplerCube;
	precision ${s.precision} usampler2DArray;
	`;return s.precision==="highp"?t+=`
#define HIGH_PRECISION`:s.precision==="mediump"?t+=`
#define MEDIUM_PRECISION`:s.precision==="lowp"&&(t+=`
#define LOW_PRECISION`),t}function Vp(s){let t="SHADOWMAP_TYPE_BASIC";return s.shadowMapType===Sl?t="SHADOWMAP_TYPE_PCF":s.shadowMapType===fc?t="SHADOWMAP_TYPE_PCF_SOFT":s.shadowMapType===gn&&(t="SHADOWMAP_TYPE_VSM"),t}function Gp(s){let t="ENVMAP_TYPE_CUBE";if(s.envMap)switch(s.envMapMode){case Ai:case Ri:t="ENVMAP_TYPE_CUBE";break;case Ks:t="ENVMAP_TYPE_CUBE_UV";break}return t}function Wp(s){let t="ENVMAP_MODE_REFLECTION";if(s.envMap)switch(s.envMapMode){case Ri:t="ENVMAP_MODE_REFRACTION";break}return t}function Xp(s){let t="ENVMAP_BLENDING_NONE";if(s.envMap)switch(s.combine){case El:t="ENVMAP_BLENDING_MULTIPLY";break;case Ic:t="ENVMAP_BLENDING_MIX";break;case Dc:t="ENVMAP_BLENDING_ADD";break}return t}function qp(s){const t=s.envMapCubeUVHeight;if(t===null)return null;const e=Math.log2(t)-2,n=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,e),112)),texelHeight:n,maxMip:e}}function Yp(s,t,e,n){const i=s.getContext(),r=e.defines;let a=e.vertexShader,o=e.fragmentShader;const l=Vp(e),c=Gp(e),h=Wp(e),u=Xp(e),f=qp(e),p=Up(e),g=Np(r),_=i.createProgram();let m,d,S=e.glslVersion?"#version "+e.glslVersion+`
`:"";e.isRawShaderMaterial?(m=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g].filter(ji).join(`
`),m.length>0&&(m+=`
`),d=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g].filter(ji).join(`
`),d.length>0&&(d+=`
`)):(m=[$o(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g,e.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",e.batching?"#define USE_BATCHING":"",e.batchingColor?"#define USE_BATCHING_COLOR":"",e.instancing?"#define USE_INSTANCING":"",e.instancingColor?"#define USE_INSTANCING_COLOR":"",e.instancingMorph?"#define USE_INSTANCING_MORPH":"",e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.map?"#define USE_MAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+h:"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.displacementMap?"#define USE_DISPLACEMENTMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.mapUv?"#define MAP_UV "+e.mapUv:"",e.alphaMapUv?"#define ALPHAMAP_UV "+e.alphaMapUv:"",e.lightMapUv?"#define LIGHTMAP_UV "+e.lightMapUv:"",e.aoMapUv?"#define AOMAP_UV "+e.aoMapUv:"",e.emissiveMapUv?"#define EMISSIVEMAP_UV "+e.emissiveMapUv:"",e.bumpMapUv?"#define BUMPMAP_UV "+e.bumpMapUv:"",e.normalMapUv?"#define NORMALMAP_UV "+e.normalMapUv:"",e.displacementMapUv?"#define DISPLACEMENTMAP_UV "+e.displacementMapUv:"",e.metalnessMapUv?"#define METALNESSMAP_UV "+e.metalnessMapUv:"",e.roughnessMapUv?"#define ROUGHNESSMAP_UV "+e.roughnessMapUv:"",e.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+e.anisotropyMapUv:"",e.clearcoatMapUv?"#define CLEARCOATMAP_UV "+e.clearcoatMapUv:"",e.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+e.clearcoatNormalMapUv:"",e.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+e.clearcoatRoughnessMapUv:"",e.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+e.iridescenceMapUv:"",e.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+e.iridescenceThicknessMapUv:"",e.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+e.sheenColorMapUv:"",e.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+e.sheenRoughnessMapUv:"",e.specularMapUv?"#define SPECULARMAP_UV "+e.specularMapUv:"",e.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+e.specularColorMapUv:"",e.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+e.specularIntensityMapUv:"",e.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+e.transmissionMapUv:"",e.thicknessMapUv?"#define THICKNESSMAP_UV "+e.thicknessMapUv:"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.flatShading?"#define FLAT_SHADED":"",e.skinning?"#define USE_SKINNING":"",e.morphTargets?"#define USE_MORPHTARGETS":"",e.morphNormals&&e.flatShading===!1?"#define USE_MORPHNORMALS":"",e.morphColors?"#define USE_MORPHCOLORS":"",e.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+e.morphTextureStride:"",e.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+e.morphTargetsCount:"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.sizeAttenuation?"#define USE_SIZEATTENUATION":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",e.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(ji).join(`
`),d=[$o(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g,e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",e.map?"#define USE_MAP":"",e.matcap?"#define USE_MATCAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+c:"",e.envMap?"#define "+h:"",e.envMap?"#define "+u:"",f?"#define CUBEUV_TEXEL_WIDTH "+f.texelWidth:"",f?"#define CUBEUV_TEXEL_HEIGHT "+f.texelHeight:"",f?"#define CUBEUV_MAX_MIP "+f.maxMip+".0":"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoat?"#define USE_CLEARCOAT":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.dispersion?"#define USE_DISPERSION":"",e.iridescence?"#define USE_IRIDESCENCE":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaTest?"#define USE_ALPHATEST":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.sheen?"#define USE_SHEEN":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors||e.instancingColor||e.batchingColor?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.gradientMap?"#define USE_GRADIENTMAP":"",e.flatShading?"#define FLAT_SHADED":"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",e.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",e.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",e.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",e.toneMapping!==Un?"#define TONE_MAPPING":"",e.toneMapping!==Un?Ft.tonemapping_pars_fragment:"",e.toneMapping!==Un?Ip("toneMapping",e.toneMapping):"",e.dithering?"#define DITHERING":"",e.opaque?"#define OPAQUE":"",Ft.colorspace_pars_fragment,Lp("linearToOutputTexel",e.outputColorSpace),Dp(),e.useDepthPacking?"#define DEPTH_PACKING "+e.depthPacking:"",`
`].filter(ji).join(`
`)),a=ba(a),a=Xo(a,e),a=qo(a,e),o=ba(o),o=Xo(o,e),o=qo(o,e),a=Yo(a),o=Yo(o),e.isRawShaderMaterial!==!0&&(S=`#version 300 es
`,m=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,d=["#define varying in",e.glslVersion===ro?"":"layout(location = 0) out highp vec4 pc_fragColor;",e.glslVersion===ro?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+d);const w=S+m+a,v=S+d+o,I=Vo(i,i.VERTEX_SHADER,w),A=Vo(i,i.FRAGMENT_SHADER,v);i.attachShader(_,I),i.attachShader(_,A),e.index0AttributeName!==void 0?i.bindAttribLocation(_,0,e.index0AttributeName):e.morphTargets===!0&&i.bindAttribLocation(_,0,"position"),i.linkProgram(_);function R(P){if(s.debug.checkShaderErrors){const H=i.getProgramInfoLog(_).trim(),B=i.getShaderInfoLog(I).trim(),V=i.getShaderInfoLog(A).trim();let q=!0,G=!0;if(i.getProgramParameter(_,i.LINK_STATUS)===!1)if(q=!1,typeof s.debug.onShaderError=="function")s.debug.onShaderError(i,_,I,A);else{const J=Wo(i,I,"vertex"),W=Wo(i,A,"fragment");console.error("THREE.WebGLProgram: Shader Error "+i.getError()+" - VALIDATE_STATUS "+i.getProgramParameter(_,i.VALIDATE_STATUS)+`

Material Name: `+P.name+`
Material Type: `+P.type+`

Program Info Log: `+H+`
`+J+`
`+W)}else H!==""?console.warn("THREE.WebGLProgram: Program Info Log:",H):(B===""||V==="")&&(G=!1);G&&(P.diagnostics={runnable:q,programLog:H,vertexShader:{log:B,prefix:m},fragmentShader:{log:V,prefix:d}})}i.deleteShader(I),i.deleteShader(A),L=new Hs(i,_),E=Fp(i,_)}let L;this.getUniforms=function(){return L===void 0&&R(this),L};let E;this.getAttributes=function(){return E===void 0&&R(this),E};let y=e.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return y===!1&&(y=i.getProgramParameter(_,Ap)),y},this.destroy=function(){n.releaseStatesOfProgram(this),i.deleteProgram(_),this.program=void 0},this.type=e.shaderType,this.name=e.shaderName,this.id=Rp++,this.cacheKey=t,this.usedTimes=1,this.program=_,this.vertexShader=I,this.fragmentShader=A,this}let $p=0;class Kp{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(t){const e=t.vertexShader,n=t.fragmentShader,i=this._getShaderStage(e),r=this._getShaderStage(n),a=this._getShaderCacheForMaterial(t);return a.has(i)===!1&&(a.add(i),i.usedTimes++),a.has(r)===!1&&(a.add(r),r.usedTimes++),this}remove(t){const e=this.materialCache.get(t);for(const n of e)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(t),this}getVertexShaderID(t){return this._getShaderStage(t.vertexShader).id}getFragmentShaderID(t){return this._getShaderStage(t.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(t){const e=this.materialCache;let n=e.get(t);return n===void 0&&(n=new Set,e.set(t,n)),n}_getShaderStage(t){const e=this.shaderCache;let n=e.get(t);return n===void 0&&(n=new jp(t),e.set(t,n)),n}}class jp{constructor(t){this.id=$p++,this.code=t,this.usedTimes=0}}function Zp(s,t,e,n,i,r,a){const o=new zl,l=new Kp,c=new Set,h=[],u=i.logarithmicDepthBuffer,f=i.vertexTextures;let p=i.precision;const g={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(E){return c.add(E),E===0?"uv":`uv${E}`}function m(E,y,P,H,B){const V=H.fog,q=B.geometry,G=E.isMeshStandardMaterial?H.environment:null,J=(E.isMeshStandardMaterial?e:t).get(E.envMap||G),W=J&&J.mapping===Ks?J.image.height:null,rt=g[E.type];E.precision!==null&&(p=i.getMaxPrecision(E.precision),p!==E.precision&&console.warn("THREE.WebGLProgram.getParameters:",E.precision,"not supported, using",p,"instead."));const ut=q.morphAttributes.position||q.morphAttributes.normal||q.morphAttributes.color,Mt=ut!==void 0?ut.length:0;let Bt=0;q.morphAttributes.position!==void 0&&(Bt=1),q.morphAttributes.normal!==void 0&&(Bt=2),q.morphAttributes.color!==void 0&&(Bt=3);let ie,$,nt,vt;if(rt){const Zt=rn[rt];ie=Zt.vertexShader,$=Zt.fragmentShader}else ie=E.vertexShader,$=E.fragmentShader,l.update(E),nt=l.getVertexShaderID(E),vt=l.getFragmentShaderID(E);const at=s.getRenderTarget(),Tt=s.state.buffers.depth.getReversed(),Lt=B.isInstancedMesh===!0,kt=B.isBatchedMesh===!0,ue=!!E.map,Wt=!!E.matcap,me=!!J,F=!!E.aoMap,Xe=!!E.lightMap,Ht=!!E.bumpMap,Vt=!!E.normalMap,wt=!!E.displacementMap,oe=!!E.emissiveMap,St=!!E.metalnessMap,b=!!E.roughnessMap,x=E.anisotropy>0,O=E.clearcoat>0,K=E.dispersion>0,Z=E.iridescence>0,Y=E.sheen>0,xt=E.transmission>0,ot=x&&!!E.anisotropyMap,dt=O&&!!E.clearcoatMap,Xt=O&&!!E.clearcoatNormalMap,Q=O&&!!E.clearcoatRoughnessMap,ft=Z&&!!E.iridescenceMap,bt=Z&&!!E.iridescenceThicknessMap,Rt=Y&&!!E.sheenColorMap,pt=Y&&!!E.sheenRoughnessMap,Gt=!!E.specularMap,Nt=!!E.specularColorMap,se=!!E.specularIntensityMap,D=xt&&!!E.transmissionMap,st=xt&&!!E.thicknessMap,X=!!E.gradientMap,j=!!E.alphaMap,ht=E.alphaTest>0,lt=!!E.alphaHash,It=!!E.extensions;let pe=Un;E.toneMapped&&(at===null||at.isXRRenderTarget===!0)&&(pe=s.toneMapping);const Ee={shaderID:rt,shaderType:E.type,shaderName:E.name,vertexShader:ie,fragmentShader:$,defines:E.defines,customVertexShaderID:nt,customFragmentShaderID:vt,isRawShaderMaterial:E.isRawShaderMaterial===!0,glslVersion:E.glslVersion,precision:p,batching:kt,batchingColor:kt&&B._colorsTexture!==null,instancing:Lt,instancingColor:Lt&&B.instanceColor!==null,instancingMorph:Lt&&B.morphTexture!==null,supportsVertexTextures:f,outputColorSpace:at===null?s.outputColorSpace:at.isXRRenderTarget===!0?at.texture.colorSpace:Ii,alphaToCoverage:!!E.alphaToCoverage,map:ue,matcap:Wt,envMap:me,envMapMode:me&&J.mapping,envMapCubeUVHeight:W,aoMap:F,lightMap:Xe,bumpMap:Ht,normalMap:Vt,displacementMap:f&&wt,emissiveMap:oe,normalMapObjectSpace:Vt&&E.normalMapType===Gc,normalMapTangentSpace:Vt&&E.normalMapType===Nl,metalnessMap:St,roughnessMap:b,anisotropy:x,anisotropyMap:ot,clearcoat:O,clearcoatMap:dt,clearcoatNormalMap:Xt,clearcoatRoughnessMap:Q,dispersion:K,iridescence:Z,iridescenceMap:ft,iridescenceThicknessMap:bt,sheen:Y,sheenColorMap:Rt,sheenRoughnessMap:pt,specularMap:Gt,specularColorMap:Nt,specularIntensityMap:se,transmission:xt,transmissionMap:D,thicknessMap:st,gradientMap:X,opaque:E.transparent===!1&&E.blending===Ei&&E.alphaToCoverage===!1,alphaMap:j,alphaTest:ht,alphaHash:lt,combine:E.combine,mapUv:ue&&_(E.map.channel),aoMapUv:F&&_(E.aoMap.channel),lightMapUv:Xe&&_(E.lightMap.channel),bumpMapUv:Ht&&_(E.bumpMap.channel),normalMapUv:Vt&&_(E.normalMap.channel),displacementMapUv:wt&&_(E.displacementMap.channel),emissiveMapUv:oe&&_(E.emissiveMap.channel),metalnessMapUv:St&&_(E.metalnessMap.channel),roughnessMapUv:b&&_(E.roughnessMap.channel),anisotropyMapUv:ot&&_(E.anisotropyMap.channel),clearcoatMapUv:dt&&_(E.clearcoatMap.channel),clearcoatNormalMapUv:Xt&&_(E.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:Q&&_(E.clearcoatRoughnessMap.channel),iridescenceMapUv:ft&&_(E.iridescenceMap.channel),iridescenceThicknessMapUv:bt&&_(E.iridescenceThicknessMap.channel),sheenColorMapUv:Rt&&_(E.sheenColorMap.channel),sheenRoughnessMapUv:pt&&_(E.sheenRoughnessMap.channel),specularMapUv:Gt&&_(E.specularMap.channel),specularColorMapUv:Nt&&_(E.specularColorMap.channel),specularIntensityMapUv:se&&_(E.specularIntensityMap.channel),transmissionMapUv:D&&_(E.transmissionMap.channel),thicknessMapUv:st&&_(E.thicknessMap.channel),alphaMapUv:j&&_(E.alphaMap.channel),vertexTangents:!!q.attributes.tangent&&(Vt||x),vertexColors:E.vertexColors,vertexAlphas:E.vertexColors===!0&&!!q.attributes.color&&q.attributes.color.itemSize===4,pointsUvs:B.isPoints===!0&&!!q.attributes.uv&&(ue||j),fog:!!V,useFog:E.fog===!0,fogExp2:!!V&&V.isFogExp2,flatShading:E.flatShading===!0,sizeAttenuation:E.sizeAttenuation===!0,logarithmicDepthBuffer:u,reverseDepthBuffer:Tt,skinning:B.isSkinnedMesh===!0,morphTargets:q.morphAttributes.position!==void 0,morphNormals:q.morphAttributes.normal!==void 0,morphColors:q.morphAttributes.color!==void 0,morphTargetsCount:Mt,morphTextureStride:Bt,numDirLights:y.directional.length,numPointLights:y.point.length,numSpotLights:y.spot.length,numSpotLightMaps:y.spotLightMap.length,numRectAreaLights:y.rectArea.length,numHemiLights:y.hemi.length,numDirLightShadows:y.directionalShadowMap.length,numPointLightShadows:y.pointShadowMap.length,numSpotLightShadows:y.spotShadowMap.length,numSpotLightShadowsWithMaps:y.numSpotLightShadowsWithMaps,numLightProbes:y.numLightProbes,numClippingPlanes:a.numPlanes,numClipIntersection:a.numIntersection,dithering:E.dithering,shadowMapEnabled:s.shadowMap.enabled&&P.length>0,shadowMapType:s.shadowMap.type,toneMapping:pe,decodeVideoTexture:ue&&E.map.isVideoTexture===!0&&Yt.getTransfer(E.map.colorSpace)===ee,decodeVideoTextureEmissive:oe&&E.emissiveMap.isVideoTexture===!0&&Yt.getTransfer(E.emissiveMap.colorSpace)===ee,premultipliedAlpha:E.premultipliedAlpha,doubleSided:E.side===he,flipSided:E.side===Se,useDepthPacking:E.depthPacking>=0,depthPacking:E.depthPacking||0,index0AttributeName:E.index0AttributeName,extensionClipCullDistance:It&&E.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(It&&E.extensions.multiDraw===!0||kt)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:E.customProgramCacheKey()};return Ee.vertexUv1s=c.has(1),Ee.vertexUv2s=c.has(2),Ee.vertexUv3s=c.has(3),c.clear(),Ee}function d(E){const y=[];if(E.shaderID?y.push(E.shaderID):(y.push(E.customVertexShaderID),y.push(E.customFragmentShaderID)),E.defines!==void 0)for(const P in E.defines)y.push(P),y.push(E.defines[P]);return E.isRawShaderMaterial===!1&&(S(y,E),w(y,E),y.push(s.outputColorSpace)),y.push(E.customProgramCacheKey),y.join()}function S(E,y){E.push(y.precision),E.push(y.outputColorSpace),E.push(y.envMapMode),E.push(y.envMapCubeUVHeight),E.push(y.mapUv),E.push(y.alphaMapUv),E.push(y.lightMapUv),E.push(y.aoMapUv),E.push(y.bumpMapUv),E.push(y.normalMapUv),E.push(y.displacementMapUv),E.push(y.emissiveMapUv),E.push(y.metalnessMapUv),E.push(y.roughnessMapUv),E.push(y.anisotropyMapUv),E.push(y.clearcoatMapUv),E.push(y.clearcoatNormalMapUv),E.push(y.clearcoatRoughnessMapUv),E.push(y.iridescenceMapUv),E.push(y.iridescenceThicknessMapUv),E.push(y.sheenColorMapUv),E.push(y.sheenRoughnessMapUv),E.push(y.specularMapUv),E.push(y.specularColorMapUv),E.push(y.specularIntensityMapUv),E.push(y.transmissionMapUv),E.push(y.thicknessMapUv),E.push(y.combine),E.push(y.fogExp2),E.push(y.sizeAttenuation),E.push(y.morphTargetsCount),E.push(y.morphAttributeCount),E.push(y.numDirLights),E.push(y.numPointLights),E.push(y.numSpotLights),E.push(y.numSpotLightMaps),E.push(y.numHemiLights),E.push(y.numRectAreaLights),E.push(y.numDirLightShadows),E.push(y.numPointLightShadows),E.push(y.numSpotLightShadows),E.push(y.numSpotLightShadowsWithMaps),E.push(y.numLightProbes),E.push(y.shadowMapType),E.push(y.toneMapping),E.push(y.numClippingPlanes),E.push(y.numClipIntersection),E.push(y.depthPacking)}function w(E,y){o.disableAll(),y.supportsVertexTextures&&o.enable(0),y.instancing&&o.enable(1),y.instancingColor&&o.enable(2),y.instancingMorph&&o.enable(3),y.matcap&&o.enable(4),y.envMap&&o.enable(5),y.normalMapObjectSpace&&o.enable(6),y.normalMapTangentSpace&&o.enable(7),y.clearcoat&&o.enable(8),y.iridescence&&o.enable(9),y.alphaTest&&o.enable(10),y.vertexColors&&o.enable(11),y.vertexAlphas&&o.enable(12),y.vertexUv1s&&o.enable(13),y.vertexUv2s&&o.enable(14),y.vertexUv3s&&o.enable(15),y.vertexTangents&&o.enable(16),y.anisotropy&&o.enable(17),y.alphaHash&&o.enable(18),y.batching&&o.enable(19),y.dispersion&&o.enable(20),y.batchingColor&&o.enable(21),E.push(o.mask),o.disableAll(),y.fog&&o.enable(0),y.useFog&&o.enable(1),y.flatShading&&o.enable(2),y.logarithmicDepthBuffer&&o.enable(3),y.reverseDepthBuffer&&o.enable(4),y.skinning&&o.enable(5),y.morphTargets&&o.enable(6),y.morphNormals&&o.enable(7),y.morphColors&&o.enable(8),y.premultipliedAlpha&&o.enable(9),y.shadowMapEnabled&&o.enable(10),y.doubleSided&&o.enable(11),y.flipSided&&o.enable(12),y.useDepthPacking&&o.enable(13),y.dithering&&o.enable(14),y.transmission&&o.enable(15),y.sheen&&o.enable(16),y.opaque&&o.enable(17),y.pointsUvs&&o.enable(18),y.decodeVideoTexture&&o.enable(19),y.decodeVideoTextureEmissive&&o.enable(20),y.alphaToCoverage&&o.enable(21),E.push(o.mask)}function v(E){const y=g[E.type];let P;if(y){const H=rn[y];P=Dh.clone(H.uniforms)}else P=E.uniforms;return P}function I(E,y){let P;for(let H=0,B=h.length;H<B;H++){const V=h[H];if(V.cacheKey===y){P=V,++P.usedTimes;break}}return P===void 0&&(P=new Yp(s,y,E,r),h.push(P)),P}function A(E){if(--E.usedTimes===0){const y=h.indexOf(E);h[y]=h[h.length-1],h.pop(),E.destroy()}}function R(E){l.remove(E)}function L(){l.dispose()}return{getParameters:m,getProgramCacheKey:d,getUniforms:v,acquireProgram:I,releaseProgram:A,releaseShaderCache:R,programs:h,dispose:L}}function Jp(){let s=new WeakMap;function t(a){return s.has(a)}function e(a){let o=s.get(a);return o===void 0&&(o={},s.set(a,o)),o}function n(a){s.delete(a)}function i(a,o,l){s.get(a)[o]=l}function r(){s=new WeakMap}return{has:t,get:e,remove:n,update:i,dispose:r}}function Qp(s,t){return s.groupOrder!==t.groupOrder?s.groupOrder-t.groupOrder:s.renderOrder!==t.renderOrder?s.renderOrder-t.renderOrder:s.material.id!==t.material.id?s.material.id-t.material.id:s.z!==t.z?s.z-t.z:s.id-t.id}function Ko(s,t){return s.groupOrder!==t.groupOrder?s.groupOrder-t.groupOrder:s.renderOrder!==t.renderOrder?s.renderOrder-t.renderOrder:s.z!==t.z?t.z-s.z:s.id-t.id}function jo(){const s=[];let t=0;const e=[],n=[],i=[];function r(){t=0,e.length=0,n.length=0,i.length=0}function a(u,f,p,g,_,m){let d=s[t];return d===void 0?(d={id:u.id,object:u,geometry:f,material:p,groupOrder:g,renderOrder:u.renderOrder,z:_,group:m},s[t]=d):(d.id=u.id,d.object=u,d.geometry=f,d.material=p,d.groupOrder=g,d.renderOrder=u.renderOrder,d.z=_,d.group=m),t++,d}function o(u,f,p,g,_,m){const d=a(u,f,p,g,_,m);p.transmission>0?n.push(d):p.transparent===!0?i.push(d):e.push(d)}function l(u,f,p,g,_,m){const d=a(u,f,p,g,_,m);p.transmission>0?n.unshift(d):p.transparent===!0?i.unshift(d):e.unshift(d)}function c(u,f){e.length>1&&e.sort(u||Qp),n.length>1&&n.sort(f||Ko),i.length>1&&i.sort(f||Ko)}function h(){for(let u=t,f=s.length;u<f;u++){const p=s[u];if(p.id===null)break;p.id=null,p.object=null,p.geometry=null,p.material=null,p.group=null}}return{opaque:e,transmissive:n,transparent:i,init:r,push:o,unshift:l,finish:h,sort:c}}function tm(){let s=new WeakMap;function t(n,i){const r=s.get(n);let a;return r===void 0?(a=new jo,s.set(n,[a])):i>=r.length?(a=new jo,r.push(a)):a=r[i],a}function e(){s=new WeakMap}return{get:t,dispose:e}}function em(){const s={};return{get:function(t){if(s[t.id]!==void 0)return s[t.id];let e;switch(t.type){case"DirectionalLight":e={direction:new C,color:new Ot};break;case"SpotLight":e={position:new C,direction:new C,color:new Ot,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":e={position:new C,color:new Ot,distance:0,decay:0};break;case"HemisphereLight":e={direction:new C,skyColor:new Ot,groundColor:new Ot};break;case"RectAreaLight":e={color:new Ot,position:new C,halfWidth:new C,halfHeight:new C};break}return s[t.id]=e,e}}}function nm(){const s={};return{get:function(t){if(s[t.id]!==void 0)return s[t.id];let e;switch(t.type){case"DirectionalLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Pt};break;case"SpotLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Pt};break;case"PointLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Pt,shadowCameraNear:1,shadowCameraFar:1e3};break}return s[t.id]=e,e}}}let im=0;function sm(s,t){return(t.castShadow?2:0)-(s.castShadow?2:0)+(t.map?1:0)-(s.map?1:0)}function rm(s){const t=new em,e=nm(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new C);const i=new C,r=new te,a=new te;function o(c){let h=0,u=0,f=0;for(let E=0;E<9;E++)n.probe[E].set(0,0,0);let p=0,g=0,_=0,m=0,d=0,S=0,w=0,v=0,I=0,A=0,R=0;c.sort(sm);for(let E=0,y=c.length;E<y;E++){const P=c[E],H=P.color,B=P.intensity,V=P.distance,q=P.shadow&&P.shadow.map?P.shadow.map.texture:null;if(P.isAmbientLight)h+=H.r*B,u+=H.g*B,f+=H.b*B;else if(P.isLightProbe){for(let G=0;G<9;G++)n.probe[G].addScaledVector(P.sh.coefficients[G],B);R++}else if(P.isDirectionalLight){const G=t.get(P);if(G.color.copy(P.color).multiplyScalar(P.intensity),P.castShadow){const J=P.shadow,W=e.get(P);W.shadowIntensity=J.intensity,W.shadowBias=J.bias,W.shadowNormalBias=J.normalBias,W.shadowRadius=J.radius,W.shadowMapSize=J.mapSize,n.directionalShadow[p]=W,n.directionalShadowMap[p]=q,n.directionalShadowMatrix[p]=P.shadow.matrix,S++}n.directional[p]=G,p++}else if(P.isSpotLight){const G=t.get(P);G.position.setFromMatrixPosition(P.matrixWorld),G.color.copy(H).multiplyScalar(B),G.distance=V,G.coneCos=Math.cos(P.angle),G.penumbraCos=Math.cos(P.angle*(1-P.penumbra)),G.decay=P.decay,n.spot[_]=G;const J=P.shadow;if(P.map&&(n.spotLightMap[I]=P.map,I++,J.updateMatrices(P),P.castShadow&&A++),n.spotLightMatrix[_]=J.matrix,P.castShadow){const W=e.get(P);W.shadowIntensity=J.intensity,W.shadowBias=J.bias,W.shadowNormalBias=J.normalBias,W.shadowRadius=J.radius,W.shadowMapSize=J.mapSize,n.spotShadow[_]=W,n.spotShadowMap[_]=q,v++}_++}else if(P.isRectAreaLight){const G=t.get(P);G.color.copy(H).multiplyScalar(B),G.halfWidth.set(P.width*.5,0,0),G.halfHeight.set(0,P.height*.5,0),n.rectArea[m]=G,m++}else if(P.isPointLight){const G=t.get(P);if(G.color.copy(P.color).multiplyScalar(P.intensity),G.distance=P.distance,G.decay=P.decay,P.castShadow){const J=P.shadow,W=e.get(P);W.shadowIntensity=J.intensity,W.shadowBias=J.bias,W.shadowNormalBias=J.normalBias,W.shadowRadius=J.radius,W.shadowMapSize=J.mapSize,W.shadowCameraNear=J.camera.near,W.shadowCameraFar=J.camera.far,n.pointShadow[g]=W,n.pointShadowMap[g]=q,n.pointShadowMatrix[g]=P.shadow.matrix,w++}n.point[g]=G,g++}else if(P.isHemisphereLight){const G=t.get(P);G.skyColor.copy(P.color).multiplyScalar(B),G.groundColor.copy(P.groundColor).multiplyScalar(B),n.hemi[d]=G,d++}}m>0&&(s.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=it.LTC_FLOAT_1,n.rectAreaLTC2=it.LTC_FLOAT_2):(n.rectAreaLTC1=it.LTC_HALF_1,n.rectAreaLTC2=it.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=u,n.ambient[2]=f;const L=n.hash;(L.directionalLength!==p||L.pointLength!==g||L.spotLength!==_||L.rectAreaLength!==m||L.hemiLength!==d||L.numDirectionalShadows!==S||L.numPointShadows!==w||L.numSpotShadows!==v||L.numSpotMaps!==I||L.numLightProbes!==R)&&(n.directional.length=p,n.spot.length=_,n.rectArea.length=m,n.point.length=g,n.hemi.length=d,n.directionalShadow.length=S,n.directionalShadowMap.length=S,n.pointShadow.length=w,n.pointShadowMap.length=w,n.spotShadow.length=v,n.spotShadowMap.length=v,n.directionalShadowMatrix.length=S,n.pointShadowMatrix.length=w,n.spotLightMatrix.length=v+I-A,n.spotLightMap.length=I,n.numSpotLightShadowsWithMaps=A,n.numLightProbes=R,L.directionalLength=p,L.pointLength=g,L.spotLength=_,L.rectAreaLength=m,L.hemiLength=d,L.numDirectionalShadows=S,L.numPointShadows=w,L.numSpotShadows=v,L.numSpotMaps=I,L.numLightProbes=R,n.version=im++)}function l(c,h){let u=0,f=0,p=0,g=0,_=0;const m=h.matrixWorldInverse;for(let d=0,S=c.length;d<S;d++){const w=c[d];if(w.isDirectionalLight){const v=n.directional[u];v.direction.setFromMatrixPosition(w.matrixWorld),i.setFromMatrixPosition(w.target.matrixWorld),v.direction.sub(i),v.direction.transformDirection(m),u++}else if(w.isSpotLight){const v=n.spot[p];v.position.setFromMatrixPosition(w.matrixWorld),v.position.applyMatrix4(m),v.direction.setFromMatrixPosition(w.matrixWorld),i.setFromMatrixPosition(w.target.matrixWorld),v.direction.sub(i),v.direction.transformDirection(m),p++}else if(w.isRectAreaLight){const v=n.rectArea[g];v.position.setFromMatrixPosition(w.matrixWorld),v.position.applyMatrix4(m),a.identity(),r.copy(w.matrixWorld),r.premultiply(m),a.extractRotation(r),v.halfWidth.set(w.width*.5,0,0),v.halfHeight.set(0,w.height*.5,0),v.halfWidth.applyMatrix4(a),v.halfHeight.applyMatrix4(a),g++}else if(w.isPointLight){const v=n.point[f];v.position.setFromMatrixPosition(w.matrixWorld),v.position.applyMatrix4(m),f++}else if(w.isHemisphereLight){const v=n.hemi[_];v.direction.setFromMatrixPosition(w.matrixWorld),v.direction.transformDirection(m),_++}}}return{setup:o,setupView:l,state:n}}function Zo(s){const t=new rm(s),e=[],n=[];function i(h){c.camera=h,e.length=0,n.length=0}function r(h){e.push(h)}function a(h){n.push(h)}function o(){t.setup(e)}function l(h){t.setupView(e,h)}const c={lightsArray:e,shadowsArray:n,camera:null,lights:t,transmissionRenderTarget:{}};return{init:i,state:c,setupLights:o,setupLightsView:l,pushLight:r,pushShadow:a}}function am(s){let t=new WeakMap;function e(i,r=0){const a=t.get(i);let o;return a===void 0?(o=new Zo(s),t.set(i,[o])):r>=a.length?(o=new Zo(s),a.push(o)):o=a[r],o}function n(){t=new WeakMap}return{get:e,dispose:n}}class om extends Bn{static get type(){return"MeshDepthMaterial"}constructor(t){super(),this.isMeshDepthMaterial=!0,this.depthPacking=Hc,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(t)}copy(t){return super.copy(t),this.depthPacking=t.depthPacking,this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this}}class lm extends Bn{static get type(){return"MeshDistanceMaterial"}constructor(t){super(),this.isMeshDistanceMaterial=!0,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(t)}copy(t){return super.copy(t),this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this}}const cm=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,hm=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function um(s,t,e){let n=new ka;const i=new Pt,r=new Pt,a=new ne,o=new om({depthPacking:Vc}),l=new lm,c={},h=e.maxTextureSize,u={[Fn]:Se,[Se]:Fn,[he]:he},f=new On({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Pt},radius:{value:4}},vertexShader:cm,fragmentShader:hm}),p=f.clone();p.defines.HORIZONTAL_PASS=1;const g=new ve;g.setAttribute("position",new De(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const _=new et(g,f),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Sl;let d=this.type;this.render=function(A,R,L){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||A.length===0)return;const E=s.getRenderTarget(),y=s.getActiveCubeFace(),P=s.getActiveMipmapLevel(),H=s.state;H.setBlending(Dn),H.buffers.color.setClear(1,1,1,1),H.buffers.depth.setTest(!0),H.setScissorTest(!1);const B=d!==gn&&this.type===gn,V=d===gn&&this.type!==gn;for(let q=0,G=A.length;q<G;q++){const J=A[q],W=J.shadow;if(W===void 0){console.warn("THREE.WebGLShadowMap:",J,"has no shadow.");continue}if(W.autoUpdate===!1&&W.needsUpdate===!1)continue;i.copy(W.mapSize);const rt=W.getFrameExtents();if(i.multiply(rt),r.copy(W.mapSize),(i.x>h||i.y>h)&&(i.x>h&&(r.x=Math.floor(h/rt.x),i.x=r.x*rt.x,W.mapSize.x=r.x),i.y>h&&(r.y=Math.floor(h/rt.y),i.y=r.y*rt.y,W.mapSize.y=r.y)),W.map===null||B===!0||V===!0){const Mt=this.type!==gn?{minFilter:We,magFilter:We}:{};W.map!==null&&W.map.dispose(),W.map=new Sn(i.x,i.y,Mt),W.map.texture.name=J.name+".shadowMap",W.camera.updateProjectionMatrix()}s.setRenderTarget(W.map),s.clear();const ut=W.getViewportCount();for(let Mt=0;Mt<ut;Mt++){const Bt=W.getViewport(Mt);a.set(r.x*Bt.x,r.y*Bt.y,r.x*Bt.z,r.y*Bt.w),H.viewport(a),W.updateMatrices(J,Mt),n=W.getFrustum(),v(R,L,W.camera,J,this.type)}W.isPointLightShadow!==!0&&this.type===gn&&S(W,L),W.needsUpdate=!1}d=this.type,m.needsUpdate=!1,s.setRenderTarget(E,y,P)};function S(A,R){const L=t.update(_);f.defines.VSM_SAMPLES!==A.blurSamples&&(f.defines.VSM_SAMPLES=A.blurSamples,p.defines.VSM_SAMPLES=A.blurSamples,f.needsUpdate=!0,p.needsUpdate=!0),A.mapPass===null&&(A.mapPass=new Sn(i.x,i.y)),f.uniforms.shadow_pass.value=A.map.texture,f.uniforms.resolution.value=A.mapSize,f.uniforms.radius.value=A.radius,s.setRenderTarget(A.mapPass),s.clear(),s.renderBufferDirect(R,null,L,f,_,null),p.uniforms.shadow_pass.value=A.mapPass.texture,p.uniforms.resolution.value=A.mapSize,p.uniforms.radius.value=A.radius,s.setRenderTarget(A.map),s.clear(),s.renderBufferDirect(R,null,L,p,_,null)}function w(A,R,L,E){let y=null;const P=L.isPointLight===!0?A.customDistanceMaterial:A.customDepthMaterial;if(P!==void 0)y=P;else if(y=L.isPointLight===!0?l:o,s.localClippingEnabled&&R.clipShadows===!0&&Array.isArray(R.clippingPlanes)&&R.clippingPlanes.length!==0||R.displacementMap&&R.displacementScale!==0||R.alphaMap&&R.alphaTest>0||R.map&&R.alphaTest>0){const H=y.uuid,B=R.uuid;let V=c[H];V===void 0&&(V={},c[H]=V);let q=V[B];q===void 0&&(q=y.clone(),V[B]=q,R.addEventListener("dispose",I)),y=q}if(y.visible=R.visible,y.wireframe=R.wireframe,E===gn?y.side=R.shadowSide!==null?R.shadowSide:R.side:y.side=R.shadowSide!==null?R.shadowSide:u[R.side],y.alphaMap=R.alphaMap,y.alphaTest=R.alphaTest,y.map=R.map,y.clipShadows=R.clipShadows,y.clippingPlanes=R.clippingPlanes,y.clipIntersection=R.clipIntersection,y.displacementMap=R.displacementMap,y.displacementScale=R.displacementScale,y.displacementBias=R.displacementBias,y.wireframeLinewidth=R.wireframeLinewidth,y.linewidth=R.linewidth,L.isPointLight===!0&&y.isMeshDistanceMaterial===!0){const H=s.properties.get(y);H.light=L}return y}function v(A,R,L,E,y){if(A.visible===!1)return;if(A.layers.test(R.layers)&&(A.isMesh||A.isLine||A.isPoints)&&(A.castShadow||A.receiveShadow&&y===gn)&&(!A.frustumCulled||n.intersectsObject(A))){A.modelViewMatrix.multiplyMatrices(L.matrixWorldInverse,A.matrixWorld);const B=t.update(A),V=A.material;if(Array.isArray(V)){const q=B.groups;for(let G=0,J=q.length;G<J;G++){const W=q[G],rt=V[W.materialIndex];if(rt&&rt.visible){const ut=w(A,rt,E,y);A.onBeforeShadow(s,A,R,L,B,ut,W),s.renderBufferDirect(L,null,B,ut,A,W),A.onAfterShadow(s,A,R,L,B,ut,W)}}}else if(V.visible){const q=w(A,V,E,y);A.onBeforeShadow(s,A,R,L,B,q,null),s.renderBufferDirect(L,null,B,q,A,null),A.onAfterShadow(s,A,R,L,B,q,null)}}const H=A.children;for(let B=0,V=H.length;B<V;B++)v(H[B],R,L,E,y)}function I(A){A.target.removeEventListener("dispose",I);for(const L in c){const E=c[L],y=A.target.uuid;y in E&&(E[y].dispose(),delete E[y])}}}const dm={[Hr]:Vr,[Gr]:qr,[Wr]:Yr,[Ti]:Xr,[Vr]:Hr,[qr]:Gr,[Yr]:Wr,[Xr]:Ti};function fm(s,t){function e(){let D=!1;const st=new ne;let X=null;const j=new ne(0,0,0,0);return{setMask:function(ht){X!==ht&&!D&&(s.colorMask(ht,ht,ht,ht),X=ht)},setLocked:function(ht){D=ht},setClear:function(ht,lt,It,pe,Ee){Ee===!0&&(ht*=pe,lt*=pe,It*=pe),st.set(ht,lt,It,pe),j.equals(st)===!1&&(s.clearColor(ht,lt,It,pe),j.copy(st))},reset:function(){D=!1,X=null,j.set(-1,0,0,0)}}}function n(){let D=!1,st=!1,X=null,j=null,ht=null;return{setReversed:function(lt){if(st!==lt){const It=t.get("EXT_clip_control");st?It.clipControlEXT(It.LOWER_LEFT_EXT,It.ZERO_TO_ONE_EXT):It.clipControlEXT(It.LOWER_LEFT_EXT,It.NEGATIVE_ONE_TO_ONE_EXT);const pe=ht;ht=null,this.setClear(pe)}st=lt},getReversed:function(){return st},setTest:function(lt){lt?at(s.DEPTH_TEST):Tt(s.DEPTH_TEST)},setMask:function(lt){X!==lt&&!D&&(s.depthMask(lt),X=lt)},setFunc:function(lt){if(st&&(lt=dm[lt]),j!==lt){switch(lt){case Hr:s.depthFunc(s.NEVER);break;case Vr:s.depthFunc(s.ALWAYS);break;case Gr:s.depthFunc(s.LESS);break;case Ti:s.depthFunc(s.LEQUAL);break;case Wr:s.depthFunc(s.EQUAL);break;case Xr:s.depthFunc(s.GEQUAL);break;case qr:s.depthFunc(s.GREATER);break;case Yr:s.depthFunc(s.NOTEQUAL);break;default:s.depthFunc(s.LEQUAL)}j=lt}},setLocked:function(lt){D=lt},setClear:function(lt){ht!==lt&&(st&&(lt=1-lt),s.clearDepth(lt),ht=lt)},reset:function(){D=!1,X=null,j=null,ht=null,st=!1}}}function i(){let D=!1,st=null,X=null,j=null,ht=null,lt=null,It=null,pe=null,Ee=null;return{setTest:function(Zt){D||(Zt?at(s.STENCIL_TEST):Tt(s.STENCIL_TEST))},setMask:function(Zt){st!==Zt&&!D&&(s.stencilMask(Zt),st=Zt)},setFunc:function(Zt,Ke,cn){(X!==Zt||j!==Ke||ht!==cn)&&(s.stencilFunc(Zt,Ke,cn),X=Zt,j=Ke,ht=cn)},setOp:function(Zt,Ke,cn){(lt!==Zt||It!==Ke||pe!==cn)&&(s.stencilOp(Zt,Ke,cn),lt=Zt,It=Ke,pe=cn)},setLocked:function(Zt){D=Zt},setClear:function(Zt){Ee!==Zt&&(s.clearStencil(Zt),Ee=Zt)},reset:function(){D=!1,st=null,X=null,j=null,ht=null,lt=null,It=null,pe=null,Ee=null}}}const r=new e,a=new n,o=new i,l=new WeakMap,c=new WeakMap;let h={},u={},f=new WeakMap,p=[],g=null,_=!1,m=null,d=null,S=null,w=null,v=null,I=null,A=null,R=new Ot(0,0,0),L=0,E=!1,y=null,P=null,H=null,B=null,V=null;const q=s.getParameter(s.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let G=!1,J=0;const W=s.getParameter(s.VERSION);W.indexOf("WebGL")!==-1?(J=parseFloat(/^WebGL (\d)/.exec(W)[1]),G=J>=1):W.indexOf("OpenGL ES")!==-1&&(J=parseFloat(/^OpenGL ES (\d)/.exec(W)[1]),G=J>=2);let rt=null,ut={};const Mt=s.getParameter(s.SCISSOR_BOX),Bt=s.getParameter(s.VIEWPORT),ie=new ne().fromArray(Mt),$=new ne().fromArray(Bt);function nt(D,st,X,j){const ht=new Uint8Array(4),lt=s.createTexture();s.bindTexture(D,lt),s.texParameteri(D,s.TEXTURE_MIN_FILTER,s.NEAREST),s.texParameteri(D,s.TEXTURE_MAG_FILTER,s.NEAREST);for(let It=0;It<X;It++)D===s.TEXTURE_3D||D===s.TEXTURE_2D_ARRAY?s.texImage3D(st,0,s.RGBA,1,1,j,0,s.RGBA,s.UNSIGNED_BYTE,ht):s.texImage2D(st+It,0,s.RGBA,1,1,0,s.RGBA,s.UNSIGNED_BYTE,ht);return lt}const vt={};vt[s.TEXTURE_2D]=nt(s.TEXTURE_2D,s.TEXTURE_2D,1),vt[s.TEXTURE_CUBE_MAP]=nt(s.TEXTURE_CUBE_MAP,s.TEXTURE_CUBE_MAP_POSITIVE_X,6),vt[s.TEXTURE_2D_ARRAY]=nt(s.TEXTURE_2D_ARRAY,s.TEXTURE_2D_ARRAY,1,1),vt[s.TEXTURE_3D]=nt(s.TEXTURE_3D,s.TEXTURE_3D,1,1),r.setClear(0,0,0,1),a.setClear(1),o.setClear(0),at(s.DEPTH_TEST),a.setFunc(Ti),Ht(!1),Vt(to),at(s.CULL_FACE),F(Dn);function at(D){h[D]!==!0&&(s.enable(D),h[D]=!0)}function Tt(D){h[D]!==!1&&(s.disable(D),h[D]=!1)}function Lt(D,st){return u[D]!==st?(s.bindFramebuffer(D,st),u[D]=st,D===s.DRAW_FRAMEBUFFER&&(u[s.FRAMEBUFFER]=st),D===s.FRAMEBUFFER&&(u[s.DRAW_FRAMEBUFFER]=st),!0):!1}function kt(D,st){let X=p,j=!1;if(D){X=f.get(st),X===void 0&&(X=[],f.set(st,X));const ht=D.textures;if(X.length!==ht.length||X[0]!==s.COLOR_ATTACHMENT0){for(let lt=0,It=ht.length;lt<It;lt++)X[lt]=s.COLOR_ATTACHMENT0+lt;X.length=ht.length,j=!0}}else X[0]!==s.BACK&&(X[0]=s.BACK,j=!0);j&&s.drawBuffers(X)}function ue(D){return g!==D?(s.useProgram(D),g=D,!0):!1}const Wt={[$n]:s.FUNC_ADD,[mc]:s.FUNC_SUBTRACT,[gc]:s.FUNC_REVERSE_SUBTRACT};Wt[_c]=s.MIN,Wt[vc]=s.MAX;const me={[xc]:s.ZERO,[yc]:s.ONE,[Mc]:s.SRC_COLOR,[kr]:s.SRC_ALPHA,[Ac]:s.SRC_ALPHA_SATURATE,[bc]:s.DST_COLOR,[Ec]:s.DST_ALPHA,[Sc]:s.ONE_MINUS_SRC_COLOR,[zr]:s.ONE_MINUS_SRC_ALPHA,[Tc]:s.ONE_MINUS_DST_COLOR,[wc]:s.ONE_MINUS_DST_ALPHA,[Rc]:s.CONSTANT_COLOR,[Cc]:s.ONE_MINUS_CONSTANT_COLOR,[Pc]:s.CONSTANT_ALPHA,[Lc]:s.ONE_MINUS_CONSTANT_ALPHA};function F(D,st,X,j,ht,lt,It,pe,Ee,Zt){if(D===Dn){_===!0&&(Tt(s.BLEND),_=!1);return}if(_===!1&&(at(s.BLEND),_=!0),D!==pc){if(D!==m||Zt!==E){if((d!==$n||v!==$n)&&(s.blendEquation(s.FUNC_ADD),d=$n,v=$n),Zt)switch(D){case Ei:s.blendFuncSeparate(s.ONE,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case eo:s.blendFunc(s.ONE,s.ONE);break;case no:s.blendFuncSeparate(s.ZERO,s.ONE_MINUS_SRC_COLOR,s.ZERO,s.ONE);break;case io:s.blendFuncSeparate(s.ZERO,s.SRC_COLOR,s.ZERO,s.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",D);break}else switch(D){case Ei:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case eo:s.blendFunc(s.SRC_ALPHA,s.ONE);break;case no:s.blendFuncSeparate(s.ZERO,s.ONE_MINUS_SRC_COLOR,s.ZERO,s.ONE);break;case io:s.blendFunc(s.ZERO,s.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",D);break}S=null,w=null,I=null,A=null,R.set(0,0,0),L=0,m=D,E=Zt}return}ht=ht||st,lt=lt||X,It=It||j,(st!==d||ht!==v)&&(s.blendEquationSeparate(Wt[st],Wt[ht]),d=st,v=ht),(X!==S||j!==w||lt!==I||It!==A)&&(s.blendFuncSeparate(me[X],me[j],me[lt],me[It]),S=X,w=j,I=lt,A=It),(pe.equals(R)===!1||Ee!==L)&&(s.blendColor(pe.r,pe.g,pe.b,Ee),R.copy(pe),L=Ee),m=D,E=!1}function Xe(D,st){D.side===he?Tt(s.CULL_FACE):at(s.CULL_FACE);let X=D.side===Se;st&&(X=!X),Ht(X),D.blending===Ei&&D.transparent===!1?F(Dn):F(D.blending,D.blendEquation,D.blendSrc,D.blendDst,D.blendEquationAlpha,D.blendSrcAlpha,D.blendDstAlpha,D.blendColor,D.blendAlpha,D.premultipliedAlpha),a.setFunc(D.depthFunc),a.setTest(D.depthTest),a.setMask(D.depthWrite),r.setMask(D.colorWrite);const j=D.stencilWrite;o.setTest(j),j&&(o.setMask(D.stencilWriteMask),o.setFunc(D.stencilFunc,D.stencilRef,D.stencilFuncMask),o.setOp(D.stencilFail,D.stencilZFail,D.stencilZPass)),oe(D.polygonOffset,D.polygonOffsetFactor,D.polygonOffsetUnits),D.alphaToCoverage===!0?at(s.SAMPLE_ALPHA_TO_COVERAGE):Tt(s.SAMPLE_ALPHA_TO_COVERAGE)}function Ht(D){y!==D&&(D?s.frontFace(s.CW):s.frontFace(s.CCW),y=D)}function Vt(D){D!==uc?(at(s.CULL_FACE),D!==P&&(D===to?s.cullFace(s.BACK):D===dc?s.cullFace(s.FRONT):s.cullFace(s.FRONT_AND_BACK))):Tt(s.CULL_FACE),P=D}function wt(D){D!==H&&(G&&s.lineWidth(D),H=D)}function oe(D,st,X){D?(at(s.POLYGON_OFFSET_FILL),(B!==st||V!==X)&&(s.polygonOffset(st,X),B=st,V=X)):Tt(s.POLYGON_OFFSET_FILL)}function St(D){D?at(s.SCISSOR_TEST):Tt(s.SCISSOR_TEST)}function b(D){D===void 0&&(D=s.TEXTURE0+q-1),rt!==D&&(s.activeTexture(D),rt=D)}function x(D,st,X){X===void 0&&(rt===null?X=s.TEXTURE0+q-1:X=rt);let j=ut[X];j===void 0&&(j={type:void 0,texture:void 0},ut[X]=j),(j.type!==D||j.texture!==st)&&(rt!==X&&(s.activeTexture(X),rt=X),s.bindTexture(D,st||vt[D]),j.type=D,j.texture=st)}function O(){const D=ut[rt];D!==void 0&&D.type!==void 0&&(s.bindTexture(D.type,null),D.type=void 0,D.texture=void 0)}function K(){try{s.compressedTexImage2D.apply(s,arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function Z(){try{s.compressedTexImage3D.apply(s,arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function Y(){try{s.texSubImage2D.apply(s,arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function xt(){try{s.texSubImage3D.apply(s,arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function ot(){try{s.compressedTexSubImage2D.apply(s,arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function dt(){try{s.compressedTexSubImage3D.apply(s,arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function Xt(){try{s.texStorage2D.apply(s,arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function Q(){try{s.texStorage3D.apply(s,arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function ft(){try{s.texImage2D.apply(s,arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function bt(){try{s.texImage3D.apply(s,arguments)}catch(D){console.error("THREE.WebGLState:",D)}}function Rt(D){ie.equals(D)===!1&&(s.scissor(D.x,D.y,D.z,D.w),ie.copy(D))}function pt(D){$.equals(D)===!1&&(s.viewport(D.x,D.y,D.z,D.w),$.copy(D))}function Gt(D,st){let X=c.get(st);X===void 0&&(X=new WeakMap,c.set(st,X));let j=X.get(D);j===void 0&&(j=s.getUniformBlockIndex(st,D.name),X.set(D,j))}function Nt(D,st){const j=c.get(st).get(D);l.get(st)!==j&&(s.uniformBlockBinding(st,j,D.__bindingPointIndex),l.set(st,j))}function se(){s.disable(s.BLEND),s.disable(s.CULL_FACE),s.disable(s.DEPTH_TEST),s.disable(s.POLYGON_OFFSET_FILL),s.disable(s.SCISSOR_TEST),s.disable(s.STENCIL_TEST),s.disable(s.SAMPLE_ALPHA_TO_COVERAGE),s.blendEquation(s.FUNC_ADD),s.blendFunc(s.ONE,s.ZERO),s.blendFuncSeparate(s.ONE,s.ZERO,s.ONE,s.ZERO),s.blendColor(0,0,0,0),s.colorMask(!0,!0,!0,!0),s.clearColor(0,0,0,0),s.depthMask(!0),s.depthFunc(s.LESS),a.setReversed(!1),s.clearDepth(1),s.stencilMask(4294967295),s.stencilFunc(s.ALWAYS,0,4294967295),s.stencilOp(s.KEEP,s.KEEP,s.KEEP),s.clearStencil(0),s.cullFace(s.BACK),s.frontFace(s.CCW),s.polygonOffset(0,0),s.activeTexture(s.TEXTURE0),s.bindFramebuffer(s.FRAMEBUFFER,null),s.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),s.bindFramebuffer(s.READ_FRAMEBUFFER,null),s.useProgram(null),s.lineWidth(1),s.scissor(0,0,s.canvas.width,s.canvas.height),s.viewport(0,0,s.canvas.width,s.canvas.height),h={},rt=null,ut={},u={},f=new WeakMap,p=[],g=null,_=!1,m=null,d=null,S=null,w=null,v=null,I=null,A=null,R=new Ot(0,0,0),L=0,E=!1,y=null,P=null,H=null,B=null,V=null,ie.set(0,0,s.canvas.width,s.canvas.height),$.set(0,0,s.canvas.width,s.canvas.height),r.reset(),a.reset(),o.reset()}return{buffers:{color:r,depth:a,stencil:o},enable:at,disable:Tt,bindFramebuffer:Lt,drawBuffers:kt,useProgram:ue,setBlending:F,setMaterial:Xe,setFlipSided:Ht,setCullFace:Vt,setLineWidth:wt,setPolygonOffset:oe,setScissorTest:St,activeTexture:b,bindTexture:x,unbindTexture:O,compressedTexImage2D:K,compressedTexImage3D:Z,texImage2D:ft,texImage3D:bt,updateUBOMapping:Gt,uniformBlockBinding:Nt,texStorage2D:Xt,texStorage3D:Q,texSubImage2D:Y,texSubImage3D:xt,compressedTexSubImage2D:ot,compressedTexSubImage3D:dt,scissor:Rt,viewport:pt,reset:se}}function Jo(s,t,e,n){const i=pm(n);switch(e){case Cl:return s*t;case Ll:return s*t;case Il:return s*t*2;case Da:return s*t/i.components*i.byteLength;case Ua:return s*t/i.components*i.byteLength;case Dl:return s*t*2/i.components*i.byteLength;case Na:return s*t*2/i.components*i.byteLength;case Pl:return s*t*3/i.components*i.byteLength;case nn:return s*t*4/i.components*i.byteLength;case Fa:return s*t*4/i.components*i.byteLength;case Fs:case Os:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*8;case Bs:case ks:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case Qr:case ea:return Math.max(s,16)*Math.max(t,8)/4;case Jr:case ta:return Math.max(s,8)*Math.max(t,8)/2;case na:case ia:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*8;case sa:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case ra:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case aa:return Math.floor((s+4)/5)*Math.floor((t+3)/4)*16;case oa:return Math.floor((s+4)/5)*Math.floor((t+4)/5)*16;case la:return Math.floor((s+5)/6)*Math.floor((t+4)/5)*16;case ca:return Math.floor((s+5)/6)*Math.floor((t+5)/6)*16;case ha:return Math.floor((s+7)/8)*Math.floor((t+4)/5)*16;case ua:return Math.floor((s+7)/8)*Math.floor((t+5)/6)*16;case da:return Math.floor((s+7)/8)*Math.floor((t+7)/8)*16;case fa:return Math.floor((s+9)/10)*Math.floor((t+4)/5)*16;case pa:return Math.floor((s+9)/10)*Math.floor((t+5)/6)*16;case ma:return Math.floor((s+9)/10)*Math.floor((t+7)/8)*16;case ga:return Math.floor((s+9)/10)*Math.floor((t+9)/10)*16;case _a:return Math.floor((s+11)/12)*Math.floor((t+9)/10)*16;case va:return Math.floor((s+11)/12)*Math.floor((t+11)/12)*16;case zs:case xa:case ya:return Math.ceil(s/4)*Math.ceil(t/4)*16;case Ul:case Ma:return Math.ceil(s/4)*Math.ceil(t/4)*8;case Sa:case Ea:return Math.ceil(s/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${e} format.`)}function pm(s){switch(s){case Mn:case Tl:return{byteLength:1,components:1};case ts:case Al:case ns:return{byteLength:2,components:1};case La:case Ia:return{byteLength:2,components:4};case Jn:case Pa:case on:return{byteLength:4,components:1};case Rl:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${s}.`)}function mm(s,t,e,n,i,r,a){const o=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Pt,h=new WeakMap;let u;const f=new WeakMap;let p=!1;try{p=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function g(b,x){return p?new OffscreenCanvas(b,x):Gs("canvas")}function _(b,x,O){let K=1;const Z=St(b);if((Z.width>O||Z.height>O)&&(K=O/Math.max(Z.width,Z.height)),K<1)if(typeof HTMLImageElement<"u"&&b instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&b instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&b instanceof ImageBitmap||typeof VideoFrame<"u"&&b instanceof VideoFrame){const Y=Math.floor(K*Z.width),xt=Math.floor(K*Z.height);u===void 0&&(u=g(Y,xt));const ot=x?g(Y,xt):u;return ot.width=Y,ot.height=xt,ot.getContext("2d").drawImage(b,0,0,Y,xt),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+Z.width+"x"+Z.height+") to ("+Y+"x"+xt+")."),ot}else return"data"in b&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+Z.width+"x"+Z.height+")."),b;return b}function m(b){return b.generateMipmaps}function d(b){s.generateMipmap(b)}function S(b){return b.isWebGLCubeRenderTarget?s.TEXTURE_CUBE_MAP:b.isWebGL3DRenderTarget?s.TEXTURE_3D:b.isWebGLArrayRenderTarget||b.isCompressedArrayTexture?s.TEXTURE_2D_ARRAY:s.TEXTURE_2D}function w(b,x,O,K,Z=!1){if(b!==null){if(s[b]!==void 0)return s[b];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+b+"'")}let Y=x;if(x===s.RED&&(O===s.FLOAT&&(Y=s.R32F),O===s.HALF_FLOAT&&(Y=s.R16F),O===s.UNSIGNED_BYTE&&(Y=s.R8)),x===s.RED_INTEGER&&(O===s.UNSIGNED_BYTE&&(Y=s.R8UI),O===s.UNSIGNED_SHORT&&(Y=s.R16UI),O===s.UNSIGNED_INT&&(Y=s.R32UI),O===s.BYTE&&(Y=s.R8I),O===s.SHORT&&(Y=s.R16I),O===s.INT&&(Y=s.R32I)),x===s.RG&&(O===s.FLOAT&&(Y=s.RG32F),O===s.HALF_FLOAT&&(Y=s.RG16F),O===s.UNSIGNED_BYTE&&(Y=s.RG8)),x===s.RG_INTEGER&&(O===s.UNSIGNED_BYTE&&(Y=s.RG8UI),O===s.UNSIGNED_SHORT&&(Y=s.RG16UI),O===s.UNSIGNED_INT&&(Y=s.RG32UI),O===s.BYTE&&(Y=s.RG8I),O===s.SHORT&&(Y=s.RG16I),O===s.INT&&(Y=s.RG32I)),x===s.RGB_INTEGER&&(O===s.UNSIGNED_BYTE&&(Y=s.RGB8UI),O===s.UNSIGNED_SHORT&&(Y=s.RGB16UI),O===s.UNSIGNED_INT&&(Y=s.RGB32UI),O===s.BYTE&&(Y=s.RGB8I),O===s.SHORT&&(Y=s.RGB16I),O===s.INT&&(Y=s.RGB32I)),x===s.RGBA_INTEGER&&(O===s.UNSIGNED_BYTE&&(Y=s.RGBA8UI),O===s.UNSIGNED_SHORT&&(Y=s.RGBA16UI),O===s.UNSIGNED_INT&&(Y=s.RGBA32UI),O===s.BYTE&&(Y=s.RGBA8I),O===s.SHORT&&(Y=s.RGBA16I),O===s.INT&&(Y=s.RGBA32I)),x===s.RGB&&O===s.UNSIGNED_INT_5_9_9_9_REV&&(Y=s.RGB9_E5),x===s.RGBA){const xt=Z?js:Yt.getTransfer(K);O===s.FLOAT&&(Y=s.RGBA32F),O===s.HALF_FLOAT&&(Y=s.RGBA16F),O===s.UNSIGNED_BYTE&&(Y=xt===ee?s.SRGB8_ALPHA8:s.RGBA8),O===s.UNSIGNED_SHORT_4_4_4_4&&(Y=s.RGBA4),O===s.UNSIGNED_SHORT_5_5_5_1&&(Y=s.RGB5_A1)}return(Y===s.R16F||Y===s.R32F||Y===s.RG16F||Y===s.RG32F||Y===s.RGBA16F||Y===s.RGBA32F)&&t.get("EXT_color_buffer_float"),Y}function v(b,x){let O;return b?x===null||x===Jn||x===Ci?O=s.DEPTH24_STENCIL8:x===on?O=s.DEPTH32F_STENCIL8:x===ts&&(O=s.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):x===null||x===Jn||x===Ci?O=s.DEPTH_COMPONENT24:x===on?O=s.DEPTH_COMPONENT32F:x===ts&&(O=s.DEPTH_COMPONENT16),O}function I(b,x){return m(b)===!0||b.isFramebufferTexture&&b.minFilter!==We&&b.minFilter!==an?Math.log2(Math.max(x.width,x.height))+1:b.mipmaps!==void 0&&b.mipmaps.length>0?b.mipmaps.length:b.isCompressedTexture&&Array.isArray(b.image)?x.mipmaps.length:1}function A(b){const x=b.target;x.removeEventListener("dispose",A),L(x),x.isVideoTexture&&h.delete(x)}function R(b){const x=b.target;x.removeEventListener("dispose",R),y(x)}function L(b){const x=n.get(b);if(x.__webglInit===void 0)return;const O=b.source,K=f.get(O);if(K){const Z=K[x.__cacheKey];Z.usedTimes--,Z.usedTimes===0&&E(b),Object.keys(K).length===0&&f.delete(O)}n.remove(b)}function E(b){const x=n.get(b);s.deleteTexture(x.__webglTexture);const O=b.source,K=f.get(O);delete K[x.__cacheKey],a.memory.textures--}function y(b){const x=n.get(b);if(b.depthTexture&&(b.depthTexture.dispose(),n.remove(b.depthTexture)),b.isWebGLCubeRenderTarget)for(let K=0;K<6;K++){if(Array.isArray(x.__webglFramebuffer[K]))for(let Z=0;Z<x.__webglFramebuffer[K].length;Z++)s.deleteFramebuffer(x.__webglFramebuffer[K][Z]);else s.deleteFramebuffer(x.__webglFramebuffer[K]);x.__webglDepthbuffer&&s.deleteRenderbuffer(x.__webglDepthbuffer[K])}else{if(Array.isArray(x.__webglFramebuffer))for(let K=0;K<x.__webglFramebuffer.length;K++)s.deleteFramebuffer(x.__webglFramebuffer[K]);else s.deleteFramebuffer(x.__webglFramebuffer);if(x.__webglDepthbuffer&&s.deleteRenderbuffer(x.__webglDepthbuffer),x.__webglMultisampledFramebuffer&&s.deleteFramebuffer(x.__webglMultisampledFramebuffer),x.__webglColorRenderbuffer)for(let K=0;K<x.__webglColorRenderbuffer.length;K++)x.__webglColorRenderbuffer[K]&&s.deleteRenderbuffer(x.__webglColorRenderbuffer[K]);x.__webglDepthRenderbuffer&&s.deleteRenderbuffer(x.__webglDepthRenderbuffer)}const O=b.textures;for(let K=0,Z=O.length;K<Z;K++){const Y=n.get(O[K]);Y.__webglTexture&&(s.deleteTexture(Y.__webglTexture),a.memory.textures--),n.remove(O[K])}n.remove(b)}let P=0;function H(){P=0}function B(){const b=P;return b>=i.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+b+" texture units while this GPU supports only "+i.maxTextures),P+=1,b}function V(b){const x=[];return x.push(b.wrapS),x.push(b.wrapT),x.push(b.wrapR||0),x.push(b.magFilter),x.push(b.minFilter),x.push(b.anisotropy),x.push(b.internalFormat),x.push(b.format),x.push(b.type),x.push(b.generateMipmaps),x.push(b.premultiplyAlpha),x.push(b.flipY),x.push(b.unpackAlignment),x.push(b.colorSpace),x.join()}function q(b,x){const O=n.get(b);if(b.isVideoTexture&&wt(b),b.isRenderTargetTexture===!1&&b.version>0&&O.__version!==b.version){const K=b.image;if(K===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(K.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{$(O,b,x);return}}e.bindTexture(s.TEXTURE_2D,O.__webglTexture,s.TEXTURE0+x)}function G(b,x){const O=n.get(b);if(b.version>0&&O.__version!==b.version){$(O,b,x);return}e.bindTexture(s.TEXTURE_2D_ARRAY,O.__webglTexture,s.TEXTURE0+x)}function J(b,x){const O=n.get(b);if(b.version>0&&O.__version!==b.version){$(O,b,x);return}e.bindTexture(s.TEXTURE_3D,O.__webglTexture,s.TEXTURE0+x)}function W(b,x){const O=n.get(b);if(b.version>0&&O.__version!==b.version){nt(O,b,x);return}e.bindTexture(s.TEXTURE_CUBE_MAP,O.__webglTexture,s.TEXTURE0+x)}const rt={[jr]:s.REPEAT,[jn]:s.CLAMP_TO_EDGE,[Zr]:s.MIRRORED_REPEAT},ut={[We]:s.NEAREST,[zc]:s.NEAREST_MIPMAP_NEAREST,[rs]:s.NEAREST_MIPMAP_LINEAR,[an]:s.LINEAR,[nr]:s.LINEAR_MIPMAP_NEAREST,[Zn]:s.LINEAR_MIPMAP_LINEAR},Mt={[Wc]:s.NEVER,[jc]:s.ALWAYS,[Xc]:s.LESS,[Fl]:s.LEQUAL,[qc]:s.EQUAL,[Kc]:s.GEQUAL,[Yc]:s.GREATER,[$c]:s.NOTEQUAL};function Bt(b,x){if(x.type===on&&t.has("OES_texture_float_linear")===!1&&(x.magFilter===an||x.magFilter===nr||x.magFilter===rs||x.magFilter===Zn||x.minFilter===an||x.minFilter===nr||x.minFilter===rs||x.minFilter===Zn)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),s.texParameteri(b,s.TEXTURE_WRAP_S,rt[x.wrapS]),s.texParameteri(b,s.TEXTURE_WRAP_T,rt[x.wrapT]),(b===s.TEXTURE_3D||b===s.TEXTURE_2D_ARRAY)&&s.texParameteri(b,s.TEXTURE_WRAP_R,rt[x.wrapR]),s.texParameteri(b,s.TEXTURE_MAG_FILTER,ut[x.magFilter]),s.texParameteri(b,s.TEXTURE_MIN_FILTER,ut[x.minFilter]),x.compareFunction&&(s.texParameteri(b,s.TEXTURE_COMPARE_MODE,s.COMPARE_REF_TO_TEXTURE),s.texParameteri(b,s.TEXTURE_COMPARE_FUNC,Mt[x.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(x.magFilter===We||x.minFilter!==rs&&x.minFilter!==Zn||x.type===on&&t.has("OES_texture_float_linear")===!1)return;if(x.anisotropy>1||n.get(x).__currentAnisotropy){const O=t.get("EXT_texture_filter_anisotropic");s.texParameterf(b,O.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(x.anisotropy,i.getMaxAnisotropy())),n.get(x).__currentAnisotropy=x.anisotropy}}}function ie(b,x){let O=!1;b.__webglInit===void 0&&(b.__webglInit=!0,x.addEventListener("dispose",A));const K=x.source;let Z=f.get(K);Z===void 0&&(Z={},f.set(K,Z));const Y=V(x);if(Y!==b.__cacheKey){Z[Y]===void 0&&(Z[Y]={texture:s.createTexture(),usedTimes:0},a.memory.textures++,O=!0),Z[Y].usedTimes++;const xt=Z[b.__cacheKey];xt!==void 0&&(Z[b.__cacheKey].usedTimes--,xt.usedTimes===0&&E(x)),b.__cacheKey=Y,b.__webglTexture=Z[Y].texture}return O}function $(b,x,O){let K=s.TEXTURE_2D;(x.isDataArrayTexture||x.isCompressedArrayTexture)&&(K=s.TEXTURE_2D_ARRAY),x.isData3DTexture&&(K=s.TEXTURE_3D);const Z=ie(b,x),Y=x.source;e.bindTexture(K,b.__webglTexture,s.TEXTURE0+O);const xt=n.get(Y);if(Y.version!==xt.__version||Z===!0){e.activeTexture(s.TEXTURE0+O);const ot=Yt.getPrimaries(Yt.workingColorSpace),dt=x.colorSpace===Ln?null:Yt.getPrimaries(x.colorSpace),Xt=x.colorSpace===Ln||ot===dt?s.NONE:s.BROWSER_DEFAULT_WEBGL;s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,x.flipY),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,x.premultiplyAlpha),s.pixelStorei(s.UNPACK_ALIGNMENT,x.unpackAlignment),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,Xt);let Q=_(x.image,!1,i.maxTextureSize);Q=oe(x,Q);const ft=r.convert(x.format,x.colorSpace),bt=r.convert(x.type);let Rt=w(x.internalFormat,ft,bt,x.colorSpace,x.isVideoTexture);Bt(K,x);let pt;const Gt=x.mipmaps,Nt=x.isVideoTexture!==!0,se=xt.__version===void 0||Z===!0,D=Y.dataReady,st=I(x,Q);if(x.isDepthTexture)Rt=v(x.format===Pi,x.type),se&&(Nt?e.texStorage2D(s.TEXTURE_2D,1,Rt,Q.width,Q.height):e.texImage2D(s.TEXTURE_2D,0,Rt,Q.width,Q.height,0,ft,bt,null));else if(x.isDataTexture)if(Gt.length>0){Nt&&se&&e.texStorage2D(s.TEXTURE_2D,st,Rt,Gt[0].width,Gt[0].height);for(let X=0,j=Gt.length;X<j;X++)pt=Gt[X],Nt?D&&e.texSubImage2D(s.TEXTURE_2D,X,0,0,pt.width,pt.height,ft,bt,pt.data):e.texImage2D(s.TEXTURE_2D,X,Rt,pt.width,pt.height,0,ft,bt,pt.data);x.generateMipmaps=!1}else Nt?(se&&e.texStorage2D(s.TEXTURE_2D,st,Rt,Q.width,Q.height),D&&e.texSubImage2D(s.TEXTURE_2D,0,0,0,Q.width,Q.height,ft,bt,Q.data)):e.texImage2D(s.TEXTURE_2D,0,Rt,Q.width,Q.height,0,ft,bt,Q.data);else if(x.isCompressedTexture)if(x.isCompressedArrayTexture){Nt&&se&&e.texStorage3D(s.TEXTURE_2D_ARRAY,st,Rt,Gt[0].width,Gt[0].height,Q.depth);for(let X=0,j=Gt.length;X<j;X++)if(pt=Gt[X],x.format!==nn)if(ft!==null)if(Nt){if(D)if(x.layerUpdates.size>0){const ht=Jo(pt.width,pt.height,x.format,x.type);for(const lt of x.layerUpdates){const It=pt.data.subarray(lt*ht/pt.data.BYTES_PER_ELEMENT,(lt+1)*ht/pt.data.BYTES_PER_ELEMENT);e.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,X,0,0,lt,pt.width,pt.height,1,ft,It)}x.clearLayerUpdates()}else e.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,X,0,0,0,pt.width,pt.height,Q.depth,ft,pt.data)}else e.compressedTexImage3D(s.TEXTURE_2D_ARRAY,X,Rt,pt.width,pt.height,Q.depth,0,pt.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Nt?D&&e.texSubImage3D(s.TEXTURE_2D_ARRAY,X,0,0,0,pt.width,pt.height,Q.depth,ft,bt,pt.data):e.texImage3D(s.TEXTURE_2D_ARRAY,X,Rt,pt.width,pt.height,Q.depth,0,ft,bt,pt.data)}else{Nt&&se&&e.texStorage2D(s.TEXTURE_2D,st,Rt,Gt[0].width,Gt[0].height);for(let X=0,j=Gt.length;X<j;X++)pt=Gt[X],x.format!==nn?ft!==null?Nt?D&&e.compressedTexSubImage2D(s.TEXTURE_2D,X,0,0,pt.width,pt.height,ft,pt.data):e.compressedTexImage2D(s.TEXTURE_2D,X,Rt,pt.width,pt.height,0,pt.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Nt?D&&e.texSubImage2D(s.TEXTURE_2D,X,0,0,pt.width,pt.height,ft,bt,pt.data):e.texImage2D(s.TEXTURE_2D,X,Rt,pt.width,pt.height,0,ft,bt,pt.data)}else if(x.isDataArrayTexture)if(Nt){if(se&&e.texStorage3D(s.TEXTURE_2D_ARRAY,st,Rt,Q.width,Q.height,Q.depth),D)if(x.layerUpdates.size>0){const X=Jo(Q.width,Q.height,x.format,x.type);for(const j of x.layerUpdates){const ht=Q.data.subarray(j*X/Q.data.BYTES_PER_ELEMENT,(j+1)*X/Q.data.BYTES_PER_ELEMENT);e.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,j,Q.width,Q.height,1,ft,bt,ht)}x.clearLayerUpdates()}else e.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,0,Q.width,Q.height,Q.depth,ft,bt,Q.data)}else e.texImage3D(s.TEXTURE_2D_ARRAY,0,Rt,Q.width,Q.height,Q.depth,0,ft,bt,Q.data);else if(x.isData3DTexture)Nt?(se&&e.texStorage3D(s.TEXTURE_3D,st,Rt,Q.width,Q.height,Q.depth),D&&e.texSubImage3D(s.TEXTURE_3D,0,0,0,0,Q.width,Q.height,Q.depth,ft,bt,Q.data)):e.texImage3D(s.TEXTURE_3D,0,Rt,Q.width,Q.height,Q.depth,0,ft,bt,Q.data);else if(x.isFramebufferTexture){if(se)if(Nt)e.texStorage2D(s.TEXTURE_2D,st,Rt,Q.width,Q.height);else{let X=Q.width,j=Q.height;for(let ht=0;ht<st;ht++)e.texImage2D(s.TEXTURE_2D,ht,Rt,X,j,0,ft,bt,null),X>>=1,j>>=1}}else if(Gt.length>0){if(Nt&&se){const X=St(Gt[0]);e.texStorage2D(s.TEXTURE_2D,st,Rt,X.width,X.height)}for(let X=0,j=Gt.length;X<j;X++)pt=Gt[X],Nt?D&&e.texSubImage2D(s.TEXTURE_2D,X,0,0,ft,bt,pt):e.texImage2D(s.TEXTURE_2D,X,Rt,ft,bt,pt);x.generateMipmaps=!1}else if(Nt){if(se){const X=St(Q);e.texStorage2D(s.TEXTURE_2D,st,Rt,X.width,X.height)}D&&e.texSubImage2D(s.TEXTURE_2D,0,0,0,ft,bt,Q)}else e.texImage2D(s.TEXTURE_2D,0,Rt,ft,bt,Q);m(x)&&d(K),xt.__version=Y.version,x.onUpdate&&x.onUpdate(x)}b.__version=x.version}function nt(b,x,O){if(x.image.length!==6)return;const K=ie(b,x),Z=x.source;e.bindTexture(s.TEXTURE_CUBE_MAP,b.__webglTexture,s.TEXTURE0+O);const Y=n.get(Z);if(Z.version!==Y.__version||K===!0){e.activeTexture(s.TEXTURE0+O);const xt=Yt.getPrimaries(Yt.workingColorSpace),ot=x.colorSpace===Ln?null:Yt.getPrimaries(x.colorSpace),dt=x.colorSpace===Ln||xt===ot?s.NONE:s.BROWSER_DEFAULT_WEBGL;s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,x.flipY),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,x.premultiplyAlpha),s.pixelStorei(s.UNPACK_ALIGNMENT,x.unpackAlignment),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,dt);const Xt=x.isCompressedTexture||x.image[0].isCompressedTexture,Q=x.image[0]&&x.image[0].isDataTexture,ft=[];for(let j=0;j<6;j++)!Xt&&!Q?ft[j]=_(x.image[j],!0,i.maxCubemapSize):ft[j]=Q?x.image[j].image:x.image[j],ft[j]=oe(x,ft[j]);const bt=ft[0],Rt=r.convert(x.format,x.colorSpace),pt=r.convert(x.type),Gt=w(x.internalFormat,Rt,pt,x.colorSpace),Nt=x.isVideoTexture!==!0,se=Y.__version===void 0||K===!0,D=Z.dataReady;let st=I(x,bt);Bt(s.TEXTURE_CUBE_MAP,x);let X;if(Xt){Nt&&se&&e.texStorage2D(s.TEXTURE_CUBE_MAP,st,Gt,bt.width,bt.height);for(let j=0;j<6;j++){X=ft[j].mipmaps;for(let ht=0;ht<X.length;ht++){const lt=X[ht];x.format!==nn?Rt!==null?Nt?D&&e.compressedTexSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,ht,0,0,lt.width,lt.height,Rt,lt.data):e.compressedTexImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,ht,Gt,lt.width,lt.height,0,lt.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Nt?D&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,ht,0,0,lt.width,lt.height,Rt,pt,lt.data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,ht,Gt,lt.width,lt.height,0,Rt,pt,lt.data)}}}else{if(X=x.mipmaps,Nt&&se){X.length>0&&st++;const j=St(ft[0]);e.texStorage2D(s.TEXTURE_CUBE_MAP,st,Gt,j.width,j.height)}for(let j=0;j<6;j++)if(Q){Nt?D&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,0,0,ft[j].width,ft[j].height,Rt,pt,ft[j].data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,Gt,ft[j].width,ft[j].height,0,Rt,pt,ft[j].data);for(let ht=0;ht<X.length;ht++){const It=X[ht].image[j].image;Nt?D&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,ht+1,0,0,It.width,It.height,Rt,pt,It.data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,ht+1,Gt,It.width,It.height,0,Rt,pt,It.data)}}else{Nt?D&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,0,0,Rt,pt,ft[j]):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,0,Gt,Rt,pt,ft[j]);for(let ht=0;ht<X.length;ht++){const lt=X[ht];Nt?D&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,ht+1,0,0,Rt,pt,lt.image[j]):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+j,ht+1,Gt,Rt,pt,lt.image[j])}}}m(x)&&d(s.TEXTURE_CUBE_MAP),Y.__version=Z.version,x.onUpdate&&x.onUpdate(x)}b.__version=x.version}function vt(b,x,O,K,Z,Y){const xt=r.convert(O.format,O.colorSpace),ot=r.convert(O.type),dt=w(O.internalFormat,xt,ot,O.colorSpace),Xt=n.get(x),Q=n.get(O);if(Q.__renderTarget=x,!Xt.__hasExternalTextures){const ft=Math.max(1,x.width>>Y),bt=Math.max(1,x.height>>Y);Z===s.TEXTURE_3D||Z===s.TEXTURE_2D_ARRAY?e.texImage3D(Z,Y,dt,ft,bt,x.depth,0,xt,ot,null):e.texImage2D(Z,Y,dt,ft,bt,0,xt,ot,null)}e.bindFramebuffer(s.FRAMEBUFFER,b),Vt(x)?o.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,K,Z,Q.__webglTexture,0,Ht(x)):(Z===s.TEXTURE_2D||Z>=s.TEXTURE_CUBE_MAP_POSITIVE_X&&Z<=s.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&s.framebufferTexture2D(s.FRAMEBUFFER,K,Z,Q.__webglTexture,Y),e.bindFramebuffer(s.FRAMEBUFFER,null)}function at(b,x,O){if(s.bindRenderbuffer(s.RENDERBUFFER,b),x.depthBuffer){const K=x.depthTexture,Z=K&&K.isDepthTexture?K.type:null,Y=v(x.stencilBuffer,Z),xt=x.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,ot=Ht(x);Vt(x)?o.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,ot,Y,x.width,x.height):O?s.renderbufferStorageMultisample(s.RENDERBUFFER,ot,Y,x.width,x.height):s.renderbufferStorage(s.RENDERBUFFER,Y,x.width,x.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,xt,s.RENDERBUFFER,b)}else{const K=x.textures;for(let Z=0;Z<K.length;Z++){const Y=K[Z],xt=r.convert(Y.format,Y.colorSpace),ot=r.convert(Y.type),dt=w(Y.internalFormat,xt,ot,Y.colorSpace),Xt=Ht(x);O&&Vt(x)===!1?s.renderbufferStorageMultisample(s.RENDERBUFFER,Xt,dt,x.width,x.height):Vt(x)?o.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,Xt,dt,x.width,x.height):s.renderbufferStorage(s.RENDERBUFFER,dt,x.width,x.height)}}s.bindRenderbuffer(s.RENDERBUFFER,null)}function Tt(b,x){if(x&&x.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(e.bindFramebuffer(s.FRAMEBUFFER,b),!(x.depthTexture&&x.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");const K=n.get(x.depthTexture);K.__renderTarget=x,(!K.__webglTexture||x.depthTexture.image.width!==x.width||x.depthTexture.image.height!==x.height)&&(x.depthTexture.image.width=x.width,x.depthTexture.image.height=x.height,x.depthTexture.needsUpdate=!0),q(x.depthTexture,0);const Z=K.__webglTexture,Y=Ht(x);if(x.depthTexture.format===wi)Vt(x)?o.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,s.DEPTH_ATTACHMENT,s.TEXTURE_2D,Z,0,Y):s.framebufferTexture2D(s.FRAMEBUFFER,s.DEPTH_ATTACHMENT,s.TEXTURE_2D,Z,0);else if(x.depthTexture.format===Pi)Vt(x)?o.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,s.DEPTH_STENCIL_ATTACHMENT,s.TEXTURE_2D,Z,0,Y):s.framebufferTexture2D(s.FRAMEBUFFER,s.DEPTH_STENCIL_ATTACHMENT,s.TEXTURE_2D,Z,0);else throw new Error("Unknown depthTexture format")}function Lt(b){const x=n.get(b),O=b.isWebGLCubeRenderTarget===!0;if(x.__boundDepthTexture!==b.depthTexture){const K=b.depthTexture;if(x.__depthDisposeCallback&&x.__depthDisposeCallback(),K){const Z=()=>{delete x.__boundDepthTexture,delete x.__depthDisposeCallback,K.removeEventListener("dispose",Z)};K.addEventListener("dispose",Z),x.__depthDisposeCallback=Z}x.__boundDepthTexture=K}if(b.depthTexture&&!x.__autoAllocateDepthBuffer){if(O)throw new Error("target.depthTexture not supported in Cube render targets");Tt(x.__webglFramebuffer,b)}else if(O){x.__webglDepthbuffer=[];for(let K=0;K<6;K++)if(e.bindFramebuffer(s.FRAMEBUFFER,x.__webglFramebuffer[K]),x.__webglDepthbuffer[K]===void 0)x.__webglDepthbuffer[K]=s.createRenderbuffer(),at(x.__webglDepthbuffer[K],b,!1);else{const Z=b.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,Y=x.__webglDepthbuffer[K];s.bindRenderbuffer(s.RENDERBUFFER,Y),s.framebufferRenderbuffer(s.FRAMEBUFFER,Z,s.RENDERBUFFER,Y)}}else if(e.bindFramebuffer(s.FRAMEBUFFER,x.__webglFramebuffer),x.__webglDepthbuffer===void 0)x.__webglDepthbuffer=s.createRenderbuffer(),at(x.__webglDepthbuffer,b,!1);else{const K=b.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,Z=x.__webglDepthbuffer;s.bindRenderbuffer(s.RENDERBUFFER,Z),s.framebufferRenderbuffer(s.FRAMEBUFFER,K,s.RENDERBUFFER,Z)}e.bindFramebuffer(s.FRAMEBUFFER,null)}function kt(b,x,O){const K=n.get(b);x!==void 0&&vt(K.__webglFramebuffer,b,b.texture,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,0),O!==void 0&&Lt(b)}function ue(b){const x=b.texture,O=n.get(b),K=n.get(x);b.addEventListener("dispose",R);const Z=b.textures,Y=b.isWebGLCubeRenderTarget===!0,xt=Z.length>1;if(xt||(K.__webglTexture===void 0&&(K.__webglTexture=s.createTexture()),K.__version=x.version,a.memory.textures++),Y){O.__webglFramebuffer=[];for(let ot=0;ot<6;ot++)if(x.mipmaps&&x.mipmaps.length>0){O.__webglFramebuffer[ot]=[];for(let dt=0;dt<x.mipmaps.length;dt++)O.__webglFramebuffer[ot][dt]=s.createFramebuffer()}else O.__webglFramebuffer[ot]=s.createFramebuffer()}else{if(x.mipmaps&&x.mipmaps.length>0){O.__webglFramebuffer=[];for(let ot=0;ot<x.mipmaps.length;ot++)O.__webglFramebuffer[ot]=s.createFramebuffer()}else O.__webglFramebuffer=s.createFramebuffer();if(xt)for(let ot=0,dt=Z.length;ot<dt;ot++){const Xt=n.get(Z[ot]);Xt.__webglTexture===void 0&&(Xt.__webglTexture=s.createTexture(),a.memory.textures++)}if(b.samples>0&&Vt(b)===!1){O.__webglMultisampledFramebuffer=s.createFramebuffer(),O.__webglColorRenderbuffer=[],e.bindFramebuffer(s.FRAMEBUFFER,O.__webglMultisampledFramebuffer);for(let ot=0;ot<Z.length;ot++){const dt=Z[ot];O.__webglColorRenderbuffer[ot]=s.createRenderbuffer(),s.bindRenderbuffer(s.RENDERBUFFER,O.__webglColorRenderbuffer[ot]);const Xt=r.convert(dt.format,dt.colorSpace),Q=r.convert(dt.type),ft=w(dt.internalFormat,Xt,Q,dt.colorSpace,b.isXRRenderTarget===!0),bt=Ht(b);s.renderbufferStorageMultisample(s.RENDERBUFFER,bt,ft,b.width,b.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+ot,s.RENDERBUFFER,O.__webglColorRenderbuffer[ot])}s.bindRenderbuffer(s.RENDERBUFFER,null),b.depthBuffer&&(O.__webglDepthRenderbuffer=s.createRenderbuffer(),at(O.__webglDepthRenderbuffer,b,!0)),e.bindFramebuffer(s.FRAMEBUFFER,null)}}if(Y){e.bindTexture(s.TEXTURE_CUBE_MAP,K.__webglTexture),Bt(s.TEXTURE_CUBE_MAP,x);for(let ot=0;ot<6;ot++)if(x.mipmaps&&x.mipmaps.length>0)for(let dt=0;dt<x.mipmaps.length;dt++)vt(O.__webglFramebuffer[ot][dt],b,x,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+ot,dt);else vt(O.__webglFramebuffer[ot],b,x,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+ot,0);m(x)&&d(s.TEXTURE_CUBE_MAP),e.unbindTexture()}else if(xt){for(let ot=0,dt=Z.length;ot<dt;ot++){const Xt=Z[ot],Q=n.get(Xt);e.bindTexture(s.TEXTURE_2D,Q.__webglTexture),Bt(s.TEXTURE_2D,Xt),vt(O.__webglFramebuffer,b,Xt,s.COLOR_ATTACHMENT0+ot,s.TEXTURE_2D,0),m(Xt)&&d(s.TEXTURE_2D)}e.unbindTexture()}else{let ot=s.TEXTURE_2D;if((b.isWebGL3DRenderTarget||b.isWebGLArrayRenderTarget)&&(ot=b.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),e.bindTexture(ot,K.__webglTexture),Bt(ot,x),x.mipmaps&&x.mipmaps.length>0)for(let dt=0;dt<x.mipmaps.length;dt++)vt(O.__webglFramebuffer[dt],b,x,s.COLOR_ATTACHMENT0,ot,dt);else vt(O.__webglFramebuffer,b,x,s.COLOR_ATTACHMENT0,ot,0);m(x)&&d(ot),e.unbindTexture()}b.depthBuffer&&Lt(b)}function Wt(b){const x=b.textures;for(let O=0,K=x.length;O<K;O++){const Z=x[O];if(m(Z)){const Y=S(b),xt=n.get(Z).__webglTexture;e.bindTexture(Y,xt),d(Y),e.unbindTexture()}}}const me=[],F=[];function Xe(b){if(b.samples>0){if(Vt(b)===!1){const x=b.textures,O=b.width,K=b.height;let Z=s.COLOR_BUFFER_BIT;const Y=b.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,xt=n.get(b),ot=x.length>1;if(ot)for(let dt=0;dt<x.length;dt++)e.bindFramebuffer(s.FRAMEBUFFER,xt.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+dt,s.RENDERBUFFER,null),e.bindFramebuffer(s.FRAMEBUFFER,xt.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+dt,s.TEXTURE_2D,null,0);e.bindFramebuffer(s.READ_FRAMEBUFFER,xt.__webglMultisampledFramebuffer),e.bindFramebuffer(s.DRAW_FRAMEBUFFER,xt.__webglFramebuffer);for(let dt=0;dt<x.length;dt++){if(b.resolveDepthBuffer&&(b.depthBuffer&&(Z|=s.DEPTH_BUFFER_BIT),b.stencilBuffer&&b.resolveStencilBuffer&&(Z|=s.STENCIL_BUFFER_BIT)),ot){s.framebufferRenderbuffer(s.READ_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.RENDERBUFFER,xt.__webglColorRenderbuffer[dt]);const Xt=n.get(x[dt]).__webglTexture;s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,Xt,0)}s.blitFramebuffer(0,0,O,K,0,0,O,K,Z,s.NEAREST),l===!0&&(me.length=0,F.length=0,me.push(s.COLOR_ATTACHMENT0+dt),b.depthBuffer&&b.resolveDepthBuffer===!1&&(me.push(Y),F.push(Y),s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,F)),s.invalidateFramebuffer(s.READ_FRAMEBUFFER,me))}if(e.bindFramebuffer(s.READ_FRAMEBUFFER,null),e.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),ot)for(let dt=0;dt<x.length;dt++){e.bindFramebuffer(s.FRAMEBUFFER,xt.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+dt,s.RENDERBUFFER,xt.__webglColorRenderbuffer[dt]);const Xt=n.get(x[dt]).__webglTexture;e.bindFramebuffer(s.FRAMEBUFFER,xt.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+dt,s.TEXTURE_2D,Xt,0)}e.bindFramebuffer(s.DRAW_FRAMEBUFFER,xt.__webglMultisampledFramebuffer)}else if(b.depthBuffer&&b.resolveDepthBuffer===!1&&l){const x=b.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,[x])}}}function Ht(b){return Math.min(i.maxSamples,b.samples)}function Vt(b){const x=n.get(b);return b.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&x.__useRenderToTexture!==!1}function wt(b){const x=a.render.frame;h.get(b)!==x&&(h.set(b,x),b.update())}function oe(b,x){const O=b.colorSpace,K=b.format,Z=b.type;return b.isCompressedTexture===!0||b.isVideoTexture===!0||O!==Ii&&O!==Ln&&(Yt.getTransfer(O)===ee?(K!==nn||Z!==Mn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",O)),x}function St(b){return typeof HTMLImageElement<"u"&&b instanceof HTMLImageElement?(c.width=b.naturalWidth||b.width,c.height=b.naturalHeight||b.height):typeof VideoFrame<"u"&&b instanceof VideoFrame?(c.width=b.displayWidth,c.height=b.displayHeight):(c.width=b.width,c.height=b.height),c}this.allocateTextureUnit=B,this.resetTextureUnits=H,this.setTexture2D=q,this.setTexture2DArray=G,this.setTexture3D=J,this.setTextureCube=W,this.rebindTextures=kt,this.setupRenderTarget=ue,this.updateRenderTargetMipmap=Wt,this.updateMultisampleRenderTarget=Xe,this.setupDepthRenderbuffer=Lt,this.setupFrameBufferTexture=vt,this.useMultisampledRTT=Vt}function gm(s,t){function e(n,i=Ln){let r;const a=Yt.getTransfer(i);if(n===Mn)return s.UNSIGNED_BYTE;if(n===La)return s.UNSIGNED_SHORT_4_4_4_4;if(n===Ia)return s.UNSIGNED_SHORT_5_5_5_1;if(n===Rl)return s.UNSIGNED_INT_5_9_9_9_REV;if(n===Tl)return s.BYTE;if(n===Al)return s.SHORT;if(n===ts)return s.UNSIGNED_SHORT;if(n===Pa)return s.INT;if(n===Jn)return s.UNSIGNED_INT;if(n===on)return s.FLOAT;if(n===ns)return s.HALF_FLOAT;if(n===Cl)return s.ALPHA;if(n===Pl)return s.RGB;if(n===nn)return s.RGBA;if(n===Ll)return s.LUMINANCE;if(n===Il)return s.LUMINANCE_ALPHA;if(n===wi)return s.DEPTH_COMPONENT;if(n===Pi)return s.DEPTH_STENCIL;if(n===Da)return s.RED;if(n===Ua)return s.RED_INTEGER;if(n===Dl)return s.RG;if(n===Na)return s.RG_INTEGER;if(n===Fa)return s.RGBA_INTEGER;if(n===Fs||n===Os||n===Bs||n===ks)if(a===ee)if(r=t.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===Fs)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Os)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Bs)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===ks)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=t.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===Fs)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Os)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Bs)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===ks)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===Jr||n===Qr||n===ta||n===ea)if(r=t.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===Jr)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===Qr)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===ta)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===ea)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===na||n===ia||n===sa)if(r=t.get("WEBGL_compressed_texture_etc"),r!==null){if(n===na||n===ia)return a===ee?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===sa)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===ra||n===aa||n===oa||n===la||n===ca||n===ha||n===ua||n===da||n===fa||n===pa||n===ma||n===ga||n===_a||n===va)if(r=t.get("WEBGL_compressed_texture_astc"),r!==null){if(n===ra)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===aa)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===oa)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===la)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===ca)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===ha)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===ua)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===da)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===fa)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===pa)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===ma)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===ga)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===_a)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===va)return a===ee?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===zs||n===xa||n===ya)if(r=t.get("EXT_texture_compression_bptc"),r!==null){if(n===zs)return a===ee?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===xa)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===ya)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===Ul||n===Ma||n===Sa||n===Ea)if(r=t.get("EXT_texture_compression_rgtc"),r!==null){if(n===zs)return r.COMPRESSED_RED_RGTC1_EXT;if(n===Ma)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===Sa)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===Ea)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===Ci?s.UNSIGNED_INT_24_8:s[n]!==void 0?s[n]:null}return{convert:e}}class _m extends Ie{constructor(t=[]){super(),this.isArrayCamera=!0,this.cameras=t}}class Ae extends Qt{constructor(){super(),this.isGroup=!0,this.type="Group"}}const vm={type:"move"};class Cr{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Ae,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Ae,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new C,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new C),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Ae,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new C,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new C),this._grip}dispatchEvent(t){return this._targetRay!==null&&this._targetRay.dispatchEvent(t),this._grip!==null&&this._grip.dispatchEvent(t),this._hand!==null&&this._hand.dispatchEvent(t),this}connect(t){if(t&&t.hand){const e=this._hand;if(e)for(const n of t.hand.values())this._getHandJoint(e,n)}return this.dispatchEvent({type:"connected",data:t}),this}disconnect(t){return this.dispatchEvent({type:"disconnected",data:t}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(t,e,n){let i=null,r=null,a=null;const o=this._targetRay,l=this._grip,c=this._hand;if(t&&e.session.visibilityState!=="visible-blurred"){if(c&&t.hand){a=!0;for(const _ of t.hand.values()){const m=e.getJointPose(_,n),d=this._getHandJoint(c,_);m!==null&&(d.matrix.fromArray(m.transform.matrix),d.matrix.decompose(d.position,d.rotation,d.scale),d.matrixWorldNeedsUpdate=!0,d.jointRadius=m.radius),d.visible=m!==null}const h=c.joints["index-finger-tip"],u=c.joints["thumb-tip"],f=h.position.distanceTo(u.position),p=.02,g=.005;c.inputState.pinching&&f>p+g?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:t.handedness,target:this})):!c.inputState.pinching&&f<=p-g&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:t.handedness,target:this}))}else l!==null&&t.gripSpace&&(r=e.getPose(t.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1));o!==null&&(i=e.getPose(t.targetRaySpace,n),i===null&&r!==null&&(i=r),i!==null&&(o.matrix.fromArray(i.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,i.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(i.linearVelocity)):o.hasLinearVelocity=!1,i.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(i.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(vm)))}return o!==null&&(o.visible=i!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(t,e){if(t.joints[e.jointName]===void 0){const n=new Ae;n.matrixAutoUpdate=!1,n.visible=!1,t.joints[e.jointName]=n,t.add(n)}return t.joints[e.jointName]}}const xm=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,ym=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class Mm{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(t,e,n){if(this.texture===null){const i=new Re,r=t.properties.get(i);r.__webglTexture=e.texture,(e.depthNear!=n.depthNear||e.depthFar!=n.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=i}}getMesh(t){if(this.texture!==null&&this.mesh===null){const e=t.cameras[0].viewport,n=new On({vertexShader:xm,fragmentShader:ym,uniforms:{depthColor:{value:this.texture},depthWidth:{value:e.z},depthHeight:{value:e.w}}});this.mesh=new et(new _n(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class Sm extends Di{constructor(t,e){super();const n=this;let i=null,r=1,a=null,o="local-floor",l=1,c=null,h=null,u=null,f=null,p=null,g=null;const _=new Mm,m=e.getContextAttributes();let d=null,S=null;const w=[],v=[],I=new Pt;let A=null;const R=new Ie;R.viewport=new ne;const L=new Ie;L.viewport=new ne;const E=[R,L],y=new _m;let P=null,H=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function($){let nt=w[$];return nt===void 0&&(nt=new Cr,w[$]=nt),nt.getTargetRaySpace()},this.getControllerGrip=function($){let nt=w[$];return nt===void 0&&(nt=new Cr,w[$]=nt),nt.getGripSpace()},this.getHand=function($){let nt=w[$];return nt===void 0&&(nt=new Cr,w[$]=nt),nt.getHandSpace()};function B($){const nt=v.indexOf($.inputSource);if(nt===-1)return;const vt=w[nt];vt!==void 0&&(vt.update($.inputSource,$.frame,c||a),vt.dispatchEvent({type:$.type,data:$.inputSource}))}function V(){i.removeEventListener("select",B),i.removeEventListener("selectstart",B),i.removeEventListener("selectend",B),i.removeEventListener("squeeze",B),i.removeEventListener("squeezestart",B),i.removeEventListener("squeezeend",B),i.removeEventListener("end",V),i.removeEventListener("inputsourceschange",q);for(let $=0;$<w.length;$++){const nt=v[$];nt!==null&&(v[$]=null,w[$].disconnect(nt))}P=null,H=null,_.reset(),t.setRenderTarget(d),p=null,f=null,u=null,i=null,S=null,ie.stop(),n.isPresenting=!1,t.setPixelRatio(A),t.setSize(I.width,I.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function($){r=$,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function($){o=$,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function($){c=$},this.getBaseLayer=function(){return f!==null?f:p},this.getBinding=function(){return u},this.getFrame=function(){return g},this.getSession=function(){return i},this.setSession=async function($){if(i=$,i!==null){if(d=t.getRenderTarget(),i.addEventListener("select",B),i.addEventListener("selectstart",B),i.addEventListener("selectend",B),i.addEventListener("squeeze",B),i.addEventListener("squeezestart",B),i.addEventListener("squeezeend",B),i.addEventListener("end",V),i.addEventListener("inputsourceschange",q),m.xrCompatible!==!0&&await e.makeXRCompatible(),A=t.getPixelRatio(),t.getSize(I),i.renderState.layers===void 0){const nt={antialias:m.antialias,alpha:!0,depth:m.depth,stencil:m.stencil,framebufferScaleFactor:r};p=new XRWebGLLayer(i,e,nt),i.updateRenderState({baseLayer:p}),t.setPixelRatio(1),t.setSize(p.framebufferWidth,p.framebufferHeight,!1),S=new Sn(p.framebufferWidth,p.framebufferHeight,{format:nn,type:Mn,colorSpace:t.outputColorSpace,stencilBuffer:m.stencil})}else{let nt=null,vt=null,at=null;m.depth&&(at=m.stencil?e.DEPTH24_STENCIL8:e.DEPTH_COMPONENT24,nt=m.stencil?Pi:wi,vt=m.stencil?Ci:Jn);const Tt={colorFormat:e.RGBA8,depthFormat:at,scaleFactor:r};u=new XRWebGLBinding(i,e),f=u.createProjectionLayer(Tt),i.updateRenderState({layers:[f]}),t.setPixelRatio(1),t.setSize(f.textureWidth,f.textureHeight,!1),S=new Sn(f.textureWidth,f.textureHeight,{format:nn,type:Mn,depthTexture:new Kl(f.textureWidth,f.textureHeight,vt,void 0,void 0,void 0,void 0,void 0,void 0,nt),stencilBuffer:m.stencil,colorSpace:t.outputColorSpace,samples:m.antialias?4:0,resolveDepthBuffer:f.ignoreDepthValues===!1})}S.isXRRenderTarget=!0,this.setFoveation(l),c=null,a=await i.requestReferenceSpace(o),ie.setContext(i),ie.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(i!==null)return i.environmentBlendMode},this.getDepthTexture=function(){return _.getDepthTexture()};function q($){for(let nt=0;nt<$.removed.length;nt++){const vt=$.removed[nt],at=v.indexOf(vt);at>=0&&(v[at]=null,w[at].disconnect(vt))}for(let nt=0;nt<$.added.length;nt++){const vt=$.added[nt];let at=v.indexOf(vt);if(at===-1){for(let Lt=0;Lt<w.length;Lt++)if(Lt>=v.length){v.push(vt),at=Lt;break}else if(v[Lt]===null){v[Lt]=vt,at=Lt;break}if(at===-1)break}const Tt=w[at];Tt&&Tt.connect(vt)}}const G=new C,J=new C;function W($,nt,vt){G.setFromMatrixPosition(nt.matrixWorld),J.setFromMatrixPosition(vt.matrixWorld);const at=G.distanceTo(J),Tt=nt.projectionMatrix.elements,Lt=vt.projectionMatrix.elements,kt=Tt[14]/(Tt[10]-1),ue=Tt[14]/(Tt[10]+1),Wt=(Tt[9]+1)/Tt[5],me=(Tt[9]-1)/Tt[5],F=(Tt[8]-1)/Tt[0],Xe=(Lt[8]+1)/Lt[0],Ht=kt*F,Vt=kt*Xe,wt=at/(-F+Xe),oe=wt*-F;if(nt.matrixWorld.decompose($.position,$.quaternion,$.scale),$.translateX(oe),$.translateZ(wt),$.matrixWorld.compose($.position,$.quaternion,$.scale),$.matrixWorldInverse.copy($.matrixWorld).invert(),Tt[10]===-1)$.projectionMatrix.copy(nt.projectionMatrix),$.projectionMatrixInverse.copy(nt.projectionMatrixInverse);else{const St=kt+wt,b=ue+wt,x=Ht-oe,O=Vt+(at-oe),K=Wt*ue/b*St,Z=me*ue/b*St;$.projectionMatrix.makePerspective(x,O,K,Z,St,b),$.projectionMatrixInverse.copy($.projectionMatrix).invert()}}function rt($,nt){nt===null?$.matrixWorld.copy($.matrix):$.matrixWorld.multiplyMatrices(nt.matrixWorld,$.matrix),$.matrixWorldInverse.copy($.matrixWorld).invert()}this.updateCamera=function($){if(i===null)return;let nt=$.near,vt=$.far;_.texture!==null&&(_.depthNear>0&&(nt=_.depthNear),_.depthFar>0&&(vt=_.depthFar)),y.near=L.near=R.near=nt,y.far=L.far=R.far=vt,(P!==y.near||H!==y.far)&&(i.updateRenderState({depthNear:y.near,depthFar:y.far}),P=y.near,H=y.far),R.layers.mask=$.layers.mask|2,L.layers.mask=$.layers.mask|4,y.layers.mask=R.layers.mask|L.layers.mask;const at=$.parent,Tt=y.cameras;rt(y,at);for(let Lt=0;Lt<Tt.length;Lt++)rt(Tt[Lt],at);Tt.length===2?W(y,R,L):y.projectionMatrix.copy(R.projectionMatrix),ut($,y,at)};function ut($,nt,vt){vt===null?$.matrix.copy(nt.matrixWorld):($.matrix.copy(vt.matrixWorld),$.matrix.invert(),$.matrix.multiply(nt.matrixWorld)),$.matrix.decompose($.position,$.quaternion,$.scale),$.updateMatrixWorld(!0),$.projectionMatrix.copy(nt.projectionMatrix),$.projectionMatrixInverse.copy(nt.projectionMatrixInverse),$.isPerspectiveCamera&&($.fov=es*2*Math.atan(1/$.projectionMatrix.elements[5]),$.zoom=1)}this.getCamera=function(){return y},this.getFoveation=function(){if(!(f===null&&p===null))return l},this.setFoveation=function($){l=$,f!==null&&(f.fixedFoveation=$),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=$)},this.hasDepthSensing=function(){return _.texture!==null},this.getDepthSensingMesh=function(){return _.getMesh(y)};let Mt=null;function Bt($,nt){if(h=nt.getViewerPose(c||a),g=nt,h!==null){const vt=h.views;p!==null&&(t.setRenderTargetFramebuffer(S,p.framebuffer),t.setRenderTarget(S));let at=!1;vt.length!==y.cameras.length&&(y.cameras.length=0,at=!0);for(let Lt=0;Lt<vt.length;Lt++){const kt=vt[Lt];let ue=null;if(p!==null)ue=p.getViewport(kt);else{const me=u.getViewSubImage(f,kt);ue=me.viewport,Lt===0&&(t.setRenderTargetTextures(S,me.colorTexture,f.ignoreDepthValues?void 0:me.depthStencilTexture),t.setRenderTarget(S))}let Wt=E[Lt];Wt===void 0&&(Wt=new Ie,Wt.layers.enable(Lt),Wt.viewport=new ne,E[Lt]=Wt),Wt.matrix.fromArray(kt.transform.matrix),Wt.matrix.decompose(Wt.position,Wt.quaternion,Wt.scale),Wt.projectionMatrix.fromArray(kt.projectionMatrix),Wt.projectionMatrixInverse.copy(Wt.projectionMatrix).invert(),Wt.viewport.set(ue.x,ue.y,ue.width,ue.height),Lt===0&&(y.matrix.copy(Wt.matrix),y.matrix.decompose(y.position,y.quaternion,y.scale)),at===!0&&y.cameras.push(Wt)}const Tt=i.enabledFeatures;if(Tt&&Tt.includes("depth-sensing")){const Lt=u.getDepthInformation(vt[0]);Lt&&Lt.isValid&&Lt.texture&&_.init(t,Lt,i.renderState)}}for(let vt=0;vt<w.length;vt++){const at=v[vt],Tt=w[vt];at!==null&&Tt!==void 0&&Tt.update(at,nt,c||a)}Mt&&Mt($,nt),nt.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:nt}),g=null}const ie=new Yl;ie.setAnimationLoop(Bt),this.setAnimationLoop=function($){Mt=$},this.dispose=function(){}}}const Xn=new ze,Em=new te;function wm(s,t){function e(m,d){m.matrixAutoUpdate===!0&&m.updateMatrix(),d.value.copy(m.matrix)}function n(m,d){d.color.getRGB(m.fogColor.value,Wl(s)),d.isFog?(m.fogNear.value=d.near,m.fogFar.value=d.far):d.isFogExp2&&(m.fogDensity.value=d.density)}function i(m,d,S,w,v){d.isMeshBasicMaterial||d.isMeshLambertMaterial?r(m,d):d.isMeshToonMaterial?(r(m,d),u(m,d)):d.isMeshPhongMaterial?(r(m,d),h(m,d)):d.isMeshStandardMaterial?(r(m,d),f(m,d),d.isMeshPhysicalMaterial&&p(m,d,v)):d.isMeshMatcapMaterial?(r(m,d),g(m,d)):d.isMeshDepthMaterial?r(m,d):d.isMeshDistanceMaterial?(r(m,d),_(m,d)):d.isMeshNormalMaterial?r(m,d):d.isLineBasicMaterial?(a(m,d),d.isLineDashedMaterial&&o(m,d)):d.isPointsMaterial?l(m,d,S,w):d.isSpriteMaterial?c(m,d):d.isShadowMaterial?(m.color.value.copy(d.color),m.opacity.value=d.opacity):d.isShaderMaterial&&(d.uniformsNeedUpdate=!1)}function r(m,d){m.opacity.value=d.opacity,d.color&&m.diffuse.value.copy(d.color),d.emissive&&m.emissive.value.copy(d.emissive).multiplyScalar(d.emissiveIntensity),d.map&&(m.map.value=d.map,e(d.map,m.mapTransform)),d.alphaMap&&(m.alphaMap.value=d.alphaMap,e(d.alphaMap,m.alphaMapTransform)),d.bumpMap&&(m.bumpMap.value=d.bumpMap,e(d.bumpMap,m.bumpMapTransform),m.bumpScale.value=d.bumpScale,d.side===Se&&(m.bumpScale.value*=-1)),d.normalMap&&(m.normalMap.value=d.normalMap,e(d.normalMap,m.normalMapTransform),m.normalScale.value.copy(d.normalScale),d.side===Se&&m.normalScale.value.negate()),d.displacementMap&&(m.displacementMap.value=d.displacementMap,e(d.displacementMap,m.displacementMapTransform),m.displacementScale.value=d.displacementScale,m.displacementBias.value=d.displacementBias),d.emissiveMap&&(m.emissiveMap.value=d.emissiveMap,e(d.emissiveMap,m.emissiveMapTransform)),d.specularMap&&(m.specularMap.value=d.specularMap,e(d.specularMap,m.specularMapTransform)),d.alphaTest>0&&(m.alphaTest.value=d.alphaTest);const S=t.get(d),w=S.envMap,v=S.envMapRotation;w&&(m.envMap.value=w,Xn.copy(v),Xn.x*=-1,Xn.y*=-1,Xn.z*=-1,w.isCubeTexture&&w.isRenderTargetTexture===!1&&(Xn.y*=-1,Xn.z*=-1),m.envMapRotation.value.setFromMatrix4(Em.makeRotationFromEuler(Xn)),m.flipEnvMap.value=w.isCubeTexture&&w.isRenderTargetTexture===!1?-1:1,m.reflectivity.value=d.reflectivity,m.ior.value=d.ior,m.refractionRatio.value=d.refractionRatio),d.lightMap&&(m.lightMap.value=d.lightMap,m.lightMapIntensity.value=d.lightMapIntensity,e(d.lightMap,m.lightMapTransform)),d.aoMap&&(m.aoMap.value=d.aoMap,m.aoMapIntensity.value=d.aoMapIntensity,e(d.aoMap,m.aoMapTransform))}function a(m,d){m.diffuse.value.copy(d.color),m.opacity.value=d.opacity,d.map&&(m.map.value=d.map,e(d.map,m.mapTransform))}function o(m,d){m.dashSize.value=d.dashSize,m.totalSize.value=d.dashSize+d.gapSize,m.scale.value=d.scale}function l(m,d,S,w){m.diffuse.value.copy(d.color),m.opacity.value=d.opacity,m.size.value=d.size*S,m.scale.value=w*.5,d.map&&(m.map.value=d.map,e(d.map,m.uvTransform)),d.alphaMap&&(m.alphaMap.value=d.alphaMap,e(d.alphaMap,m.alphaMapTransform)),d.alphaTest>0&&(m.alphaTest.value=d.alphaTest)}function c(m,d){m.diffuse.value.copy(d.color),m.opacity.value=d.opacity,m.rotation.value=d.rotation,d.map&&(m.map.value=d.map,e(d.map,m.mapTransform)),d.alphaMap&&(m.alphaMap.value=d.alphaMap,e(d.alphaMap,m.alphaMapTransform)),d.alphaTest>0&&(m.alphaTest.value=d.alphaTest)}function h(m,d){m.specular.value.copy(d.specular),m.shininess.value=Math.max(d.shininess,1e-4)}function u(m,d){d.gradientMap&&(m.gradientMap.value=d.gradientMap)}function f(m,d){m.metalness.value=d.metalness,d.metalnessMap&&(m.metalnessMap.value=d.metalnessMap,e(d.metalnessMap,m.metalnessMapTransform)),m.roughness.value=d.roughness,d.roughnessMap&&(m.roughnessMap.value=d.roughnessMap,e(d.roughnessMap,m.roughnessMapTransform)),d.envMap&&(m.envMapIntensity.value=d.envMapIntensity)}function p(m,d,S){m.ior.value=d.ior,d.sheen>0&&(m.sheenColor.value.copy(d.sheenColor).multiplyScalar(d.sheen),m.sheenRoughness.value=d.sheenRoughness,d.sheenColorMap&&(m.sheenColorMap.value=d.sheenColorMap,e(d.sheenColorMap,m.sheenColorMapTransform)),d.sheenRoughnessMap&&(m.sheenRoughnessMap.value=d.sheenRoughnessMap,e(d.sheenRoughnessMap,m.sheenRoughnessMapTransform))),d.clearcoat>0&&(m.clearcoat.value=d.clearcoat,m.clearcoatRoughness.value=d.clearcoatRoughness,d.clearcoatMap&&(m.clearcoatMap.value=d.clearcoatMap,e(d.clearcoatMap,m.clearcoatMapTransform)),d.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=d.clearcoatRoughnessMap,e(d.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),d.clearcoatNormalMap&&(m.clearcoatNormalMap.value=d.clearcoatNormalMap,e(d.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(d.clearcoatNormalScale),d.side===Se&&m.clearcoatNormalScale.value.negate())),d.dispersion>0&&(m.dispersion.value=d.dispersion),d.iridescence>0&&(m.iridescence.value=d.iridescence,m.iridescenceIOR.value=d.iridescenceIOR,m.iridescenceThicknessMinimum.value=d.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=d.iridescenceThicknessRange[1],d.iridescenceMap&&(m.iridescenceMap.value=d.iridescenceMap,e(d.iridescenceMap,m.iridescenceMapTransform)),d.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=d.iridescenceThicknessMap,e(d.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),d.transmission>0&&(m.transmission.value=d.transmission,m.transmissionSamplerMap.value=S.texture,m.transmissionSamplerSize.value.set(S.width,S.height),d.transmissionMap&&(m.transmissionMap.value=d.transmissionMap,e(d.transmissionMap,m.transmissionMapTransform)),m.thickness.value=d.thickness,d.thicknessMap&&(m.thicknessMap.value=d.thicknessMap,e(d.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=d.attenuationDistance,m.attenuationColor.value.copy(d.attenuationColor)),d.anisotropy>0&&(m.anisotropyVector.value.set(d.anisotropy*Math.cos(d.anisotropyRotation),d.anisotropy*Math.sin(d.anisotropyRotation)),d.anisotropyMap&&(m.anisotropyMap.value=d.anisotropyMap,e(d.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=d.specularIntensity,m.specularColor.value.copy(d.specularColor),d.specularColorMap&&(m.specularColorMap.value=d.specularColorMap,e(d.specularColorMap,m.specularColorMapTransform)),d.specularIntensityMap&&(m.specularIntensityMap.value=d.specularIntensityMap,e(d.specularIntensityMap,m.specularIntensityMapTransform))}function g(m,d){d.matcap&&(m.matcap.value=d.matcap)}function _(m,d){const S=t.get(d).light;m.referencePosition.value.setFromMatrixPosition(S.matrixWorld),m.nearDistance.value=S.shadow.camera.near,m.farDistance.value=S.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:i}}function bm(s,t,e,n){let i={},r={},a=[];const o=s.getParameter(s.MAX_UNIFORM_BUFFER_BINDINGS);function l(S,w){const v=w.program;n.uniformBlockBinding(S,v)}function c(S,w){let v=i[S.id];v===void 0&&(g(S),v=h(S),i[S.id]=v,S.addEventListener("dispose",m));const I=w.program;n.updateUBOMapping(S,I);const A=t.render.frame;r[S.id]!==A&&(f(S),r[S.id]=A)}function h(S){const w=u();S.__bindingPointIndex=w;const v=s.createBuffer(),I=S.__size,A=S.usage;return s.bindBuffer(s.UNIFORM_BUFFER,v),s.bufferData(s.UNIFORM_BUFFER,I,A),s.bindBuffer(s.UNIFORM_BUFFER,null),s.bindBufferBase(s.UNIFORM_BUFFER,w,v),v}function u(){for(let S=0;S<o;S++)if(a.indexOf(S)===-1)return a.push(S),S;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function f(S){const w=i[S.id],v=S.uniforms,I=S.__cache;s.bindBuffer(s.UNIFORM_BUFFER,w);for(let A=0,R=v.length;A<R;A++){const L=Array.isArray(v[A])?v[A]:[v[A]];for(let E=0,y=L.length;E<y;E++){const P=L[E];if(p(P,A,E,I)===!0){const H=P.__offset,B=Array.isArray(P.value)?P.value:[P.value];let V=0;for(let q=0;q<B.length;q++){const G=B[q],J=_(G);typeof G=="number"||typeof G=="boolean"?(P.__data[0]=G,s.bufferSubData(s.UNIFORM_BUFFER,H+V,P.__data)):G.isMatrix3?(P.__data[0]=G.elements[0],P.__data[1]=G.elements[1],P.__data[2]=G.elements[2],P.__data[3]=0,P.__data[4]=G.elements[3],P.__data[5]=G.elements[4],P.__data[6]=G.elements[5],P.__data[7]=0,P.__data[8]=G.elements[6],P.__data[9]=G.elements[7],P.__data[10]=G.elements[8],P.__data[11]=0):(G.toArray(P.__data,V),V+=J.storage/Float32Array.BYTES_PER_ELEMENT)}s.bufferSubData(s.UNIFORM_BUFFER,H,P.__data)}}}s.bindBuffer(s.UNIFORM_BUFFER,null)}function p(S,w,v,I){const A=S.value,R=w+"_"+v;if(I[R]===void 0)return typeof A=="number"||typeof A=="boolean"?I[R]=A:I[R]=A.clone(),!0;{const L=I[R];if(typeof A=="number"||typeof A=="boolean"){if(L!==A)return I[R]=A,!0}else if(L.equals(A)===!1)return L.copy(A),!0}return!1}function g(S){const w=S.uniforms;let v=0;const I=16;for(let R=0,L=w.length;R<L;R++){const E=Array.isArray(w[R])?w[R]:[w[R]];for(let y=0,P=E.length;y<P;y++){const H=E[y],B=Array.isArray(H.value)?H.value:[H.value];for(let V=0,q=B.length;V<q;V++){const G=B[V],J=_(G),W=v%I,rt=W%J.boundary,ut=W+rt;v+=rt,ut!==0&&I-ut<J.storage&&(v+=I-ut),H.__data=new Float32Array(J.storage/Float32Array.BYTES_PER_ELEMENT),H.__offset=v,v+=J.storage}}}const A=v%I;return A>0&&(v+=I-A),S.__size=v,S.__cache={},this}function _(S){const w={boundary:0,storage:0};return typeof S=="number"||typeof S=="boolean"?(w.boundary=4,w.storage=4):S.isVector2?(w.boundary=8,w.storage=8):S.isVector3||S.isColor?(w.boundary=16,w.storage=12):S.isVector4?(w.boundary=16,w.storage=16):S.isMatrix3?(w.boundary=48,w.storage=48):S.isMatrix4?(w.boundary=64,w.storage=64):S.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",S),w}function m(S){const w=S.target;w.removeEventListener("dispose",m);const v=a.indexOf(w.__bindingPointIndex);a.splice(v,1),s.deleteBuffer(i[w.id]),delete i[w.id],delete r[w.id]}function d(){for(const S in i)s.deleteBuffer(i[S]);a=[],i={},r={}}return{bind:l,update:c,dispose:d}}class Tm{constructor(t={}){const{canvas:e=fh(),context:n=null,depth:i=!0,stencil:r=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:u=!1,reverseDepthBuffer:f=!1}=t;this.isWebGLRenderer=!0;let p;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");p=n.getContextAttributes().alpha}else p=a;const g=new Uint32Array(4),_=new Int32Array(4);let m=null,d=null;const S=[],w=[];this.domElement=e,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=Be,this.toneMapping=Un,this.toneMappingExposure=1;const v=this;let I=!1,A=0,R=0,L=null,E=-1,y=null;const P=new ne,H=new ne;let B=null;const V=new Ot(0);let q=0,G=e.width,J=e.height,W=1,rt=null,ut=null;const Mt=new ne(0,0,G,J),Bt=new ne(0,0,G,J);let ie=!1;const $=new ka;let nt=!1,vt=!1;const at=new te,Tt=new te,Lt=new C,kt=new ne,ue={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let Wt=!1;function me(){return L===null?W:1}let F=n;function Xe(M,U){return e.getContext(M,U)}try{const M={alpha:!0,depth:i,stencil:r,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:u};if("setAttribute"in e&&e.setAttribute("data-engine",`three.js r${Ca}`),e.addEventListener("webglcontextlost",j,!1),e.addEventListener("webglcontextrestored",ht,!1),e.addEventListener("webglcontextcreationerror",lt,!1),F===null){const U="webgl2";if(F=Xe(U,M),F===null)throw Xe(U)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(M){throw console.error("THREE.WebGLRenderer: "+M.message),M}let Ht,Vt,wt,oe,St,b,x,O,K,Z,Y,xt,ot,dt,Xt,Q,ft,bt,Rt,pt,Gt,Nt,se,D;function st(){Ht=new Lf(F),Ht.init(),Nt=new gm(F,Ht),Vt=new bf(F,Ht,t,Nt),wt=new fm(F,Ht),Vt.reverseDepthBuffer&&f&&wt.buffers.depth.setReversed(!0),oe=new Uf(F),St=new Jp,b=new mm(F,Ht,wt,St,Vt,Nt,oe),x=new Af(v),O=new Pf(v),K=new zh(F),se=new Ef(F,K),Z=new If(F,K,oe,se),Y=new Ff(F,Z,K,oe),Rt=new Nf(F,Vt,b),Q=new Tf(St),xt=new Zp(v,x,O,Ht,Vt,se,Q),ot=new wm(v,St),dt=new tm,Xt=new am(Ht),bt=new Sf(v,x,O,wt,Y,p,l),ft=new um(v,Y,Vt),D=new bm(F,oe,Vt,wt),pt=new wf(F,Ht,oe),Gt=new Df(F,Ht,oe),oe.programs=xt.programs,v.capabilities=Vt,v.extensions=Ht,v.properties=St,v.renderLists=dt,v.shadowMap=ft,v.state=wt,v.info=oe}st();const X=new Sm(v,F);this.xr=X,this.getContext=function(){return F},this.getContextAttributes=function(){return F.getContextAttributes()},this.forceContextLoss=function(){const M=Ht.get("WEBGL_lose_context");M&&M.loseContext()},this.forceContextRestore=function(){const M=Ht.get("WEBGL_lose_context");M&&M.restoreContext()},this.getPixelRatio=function(){return W},this.setPixelRatio=function(M){M!==void 0&&(W=M,this.setSize(G,J,!1))},this.getSize=function(M){return M.set(G,J)},this.setSize=function(M,U,k=!0){if(X.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}G=M,J=U,e.width=Math.floor(M*W),e.height=Math.floor(U*W),k===!0&&(e.style.width=M+"px",e.style.height=U+"px"),this.setViewport(0,0,M,U)},this.getDrawingBufferSize=function(M){return M.set(G*W,J*W).floor()},this.setDrawingBufferSize=function(M,U,k){G=M,J=U,W=k,e.width=Math.floor(M*k),e.height=Math.floor(U*k),this.setViewport(0,0,M,U)},this.getCurrentViewport=function(M){return M.copy(P)},this.getViewport=function(M){return M.copy(Mt)},this.setViewport=function(M,U,k,z){M.isVector4?Mt.set(M.x,M.y,M.z,M.w):Mt.set(M,U,k,z),wt.viewport(P.copy(Mt).multiplyScalar(W).round())},this.getScissor=function(M){return M.copy(Bt)},this.setScissor=function(M,U,k,z){M.isVector4?Bt.set(M.x,M.y,M.z,M.w):Bt.set(M,U,k,z),wt.scissor(H.copy(Bt).multiplyScalar(W).round())},this.getScissorTest=function(){return ie},this.setScissorTest=function(M){wt.setScissorTest(ie=M)},this.setOpaqueSort=function(M){rt=M},this.setTransparentSort=function(M){ut=M},this.getClearColor=function(M){return M.copy(bt.getClearColor())},this.setClearColor=function(){bt.setClearColor.apply(bt,arguments)},this.getClearAlpha=function(){return bt.getClearAlpha()},this.setClearAlpha=function(){bt.setClearAlpha.apply(bt,arguments)},this.clear=function(M=!0,U=!0,k=!0){let z=0;if(M){let N=!1;if(L!==null){const tt=L.texture.format;N=tt===Fa||tt===Na||tt===Ua}if(N){const tt=L.texture.type,ct=tt===Mn||tt===Jn||tt===ts||tt===Ci||tt===La||tt===Ia,mt=bt.getClearColor(),gt=bt.getClearAlpha(),Ct=mt.r,Dt=mt.g,_t=mt.b;ct?(g[0]=Ct,g[1]=Dt,g[2]=_t,g[3]=gt,F.clearBufferuiv(F.COLOR,0,g)):(_[0]=Ct,_[1]=Dt,_[2]=_t,_[3]=gt,F.clearBufferiv(F.COLOR,0,_))}else z|=F.COLOR_BUFFER_BIT}U&&(z|=F.DEPTH_BUFFER_BIT),k&&(z|=F.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),F.clear(z)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){e.removeEventListener("webglcontextlost",j,!1),e.removeEventListener("webglcontextrestored",ht,!1),e.removeEventListener("webglcontextcreationerror",lt,!1),dt.dispose(),Xt.dispose(),St.dispose(),x.dispose(),O.dispose(),Y.dispose(),se.dispose(),D.dispose(),xt.dispose(),X.dispose(),X.removeEventListener("sessionstart",qa),X.removeEventListener("sessionend",Ya),kn.stop()};function j(M){M.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),I=!0}function ht(){console.log("THREE.WebGLRenderer: Context Restored."),I=!1;const M=oe.autoReset,U=ft.enabled,k=ft.autoUpdate,z=ft.needsUpdate,N=ft.type;st(),oe.autoReset=M,ft.enabled=U,ft.autoUpdate=k,ft.needsUpdate=z,ft.type=N}function lt(M){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",M.statusMessage)}function It(M){const U=M.target;U.removeEventListener("dispose",It),pe(U)}function pe(M){Ee(M),St.remove(M)}function Ee(M){const U=St.get(M).programs;U!==void 0&&(U.forEach(function(k){xt.releaseProgram(k)}),M.isShaderMaterial&&xt.releaseShaderCache(M))}this.renderBufferDirect=function(M,U,k,z,N,tt){U===null&&(U=ue);const ct=N.isMesh&&N.matrixWorld.determinant()<0,mt=ac(M,U,k,z,N);wt.setMaterial(z,ct);let gt=k.index,Ct=1;if(z.wireframe===!0){if(gt=Z.getWireframeAttribute(k),gt===void 0)return;Ct=2}const Dt=k.drawRange,_t=k.attributes.position;let $t=Dt.start*Ct,re=(Dt.start+Dt.count)*Ct;tt!==null&&($t=Math.max($t,tt.start*Ct),re=Math.min(re,(tt.start+tt.count)*Ct)),gt!==null?($t=Math.max($t,0),re=Math.min(re,gt.count)):_t!=null&&($t=Math.max($t,0),re=Math.min(re,_t.count));const le=re-$t;if(le<0||le===1/0)return;se.setup(N,z,mt,k,gt);let Ue,Kt=pt;if(gt!==null&&(Ue=K.get(gt),Kt=Gt,Kt.setIndex(Ue)),N.isMesh)z.wireframe===!0?(wt.setLineWidth(z.wireframeLinewidth*me()),Kt.setMode(F.LINES)):Kt.setMode(F.TRIANGLES);else if(N.isLine){let yt=z.linewidth;yt===void 0&&(yt=1),wt.setLineWidth(yt*me()),N.isLineSegments?Kt.setMode(F.LINES):N.isLineLoop?Kt.setMode(F.LINE_LOOP):Kt.setMode(F.LINE_STRIP)}else N.isPoints?Kt.setMode(F.POINTS):N.isSprite&&Kt.setMode(F.TRIANGLES);if(N.isBatchedMesh)if(N._multiDrawInstances!==null)Kt.renderMultiDrawInstances(N._multiDrawStarts,N._multiDrawCounts,N._multiDrawCount,N._multiDrawInstances);else if(Ht.get("WEBGL_multi_draw"))Kt.renderMultiDraw(N._multiDrawStarts,N._multiDrawCounts,N._multiDrawCount);else{const yt=N._multiDrawStarts,hn=N._multiDrawCounts,jt=N._multiDrawCount,je=gt?K.get(gt).bytesPerElement:1,ni=St.get(z).currentProgram.getUniforms();for(let He=0;He<jt;He++)ni.setValue(F,"_gl_DrawID",He),Kt.render(yt[He]/je,hn[He])}else if(N.isInstancedMesh)Kt.renderInstances($t,le,N.count);else if(k.isInstancedBufferGeometry){const yt=k._maxInstanceCount!==void 0?k._maxInstanceCount:1/0,hn=Math.min(k.instanceCount,yt);Kt.renderInstances($t,le,hn)}else Kt.render($t,le)};function Zt(M,U,k){M.transparent===!0&&M.side===he&&M.forceSinglePass===!1?(M.side=Se,M.needsUpdate=!0,ss(M,U,k),M.side=Fn,M.needsUpdate=!0,ss(M,U,k),M.side=he):ss(M,U,k)}this.compile=function(M,U,k=null){k===null&&(k=M),d=Xt.get(k),d.init(U),w.push(d),k.traverseVisible(function(N){N.isLight&&N.layers.test(U.layers)&&(d.pushLight(N),N.castShadow&&d.pushShadow(N))}),M!==k&&M.traverseVisible(function(N){N.isLight&&N.layers.test(U.layers)&&(d.pushLight(N),N.castShadow&&d.pushShadow(N))}),d.setupLights();const z=new Set;return M.traverse(function(N){if(!(N.isMesh||N.isPoints||N.isLine||N.isSprite))return;const tt=N.material;if(tt)if(Array.isArray(tt))for(let ct=0;ct<tt.length;ct++){const mt=tt[ct];Zt(mt,k,N),z.add(mt)}else Zt(tt,k,N),z.add(tt)}),w.pop(),d=null,z},this.compileAsync=function(M,U,k=null){const z=this.compile(M,U,k);return new Promise(N=>{function tt(){if(z.forEach(function(ct){St.get(ct).currentProgram.isReady()&&z.delete(ct)}),z.size===0){N(M);return}setTimeout(tt,10)}Ht.get("KHR_parallel_shader_compile")!==null?tt():setTimeout(tt,10)})};let Ke=null;function cn(M){Ke&&Ke(M)}function qa(){kn.stop()}function Ya(){kn.start()}const kn=new Yl;kn.setAnimationLoop(cn),typeof self<"u"&&kn.setContext(self),this.setAnimationLoop=function(M){Ke=M,X.setAnimationLoop(M),M===null?kn.stop():kn.start()},X.addEventListener("sessionstart",qa),X.addEventListener("sessionend",Ya),this.render=function(M,U){if(U!==void 0&&U.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(I===!0)return;if(M.matrixWorldAutoUpdate===!0&&M.updateMatrixWorld(),U.parent===null&&U.matrixWorldAutoUpdate===!0&&U.updateMatrixWorld(),X.enabled===!0&&X.isPresenting===!0&&(X.cameraAutoUpdate===!0&&X.updateCamera(U),U=X.getCamera()),M.isScene===!0&&M.onBeforeRender(v,M,U,L),d=Xt.get(M,w.length),d.init(U),w.push(d),Tt.multiplyMatrices(U.projectionMatrix,U.matrixWorldInverse),$.setFromProjectionMatrix(Tt),vt=this.localClippingEnabled,nt=Q.init(this.clippingPlanes,vt),m=dt.get(M,S.length),m.init(),S.push(m),X.enabled===!0&&X.isPresenting===!0){const tt=v.xr.getDepthSensingMesh();tt!==null&&er(tt,U,-1/0,v.sortObjects)}er(M,U,0,v.sortObjects),m.finish(),v.sortObjects===!0&&m.sort(rt,ut),Wt=X.enabled===!1||X.isPresenting===!1||X.hasDepthSensing()===!1,Wt&&bt.addToRenderList(m,M),this.info.render.frame++,nt===!0&&Q.beginShadows();const k=d.state.shadowsArray;ft.render(k,M,U),nt===!0&&Q.endShadows(),this.info.autoReset===!0&&this.info.reset();const z=m.opaque,N=m.transmissive;if(d.setupLights(),U.isArrayCamera){const tt=U.cameras;if(N.length>0)for(let ct=0,mt=tt.length;ct<mt;ct++){const gt=tt[ct];Ka(z,N,M,gt)}Wt&&bt.render(M);for(let ct=0,mt=tt.length;ct<mt;ct++){const gt=tt[ct];$a(m,M,gt,gt.viewport)}}else N.length>0&&Ka(z,N,M,U),Wt&&bt.render(M),$a(m,M,U);L!==null&&(b.updateMultisampleRenderTarget(L),b.updateRenderTargetMipmap(L)),M.isScene===!0&&M.onAfterRender(v,M,U),se.resetDefaultState(),E=-1,y=null,w.pop(),w.length>0?(d=w[w.length-1],nt===!0&&Q.setGlobalState(v.clippingPlanes,d.state.camera)):d=null,S.pop(),S.length>0?m=S[S.length-1]:m=null};function er(M,U,k,z){if(M.visible===!1)return;if(M.layers.test(U.layers)){if(M.isGroup)k=M.renderOrder;else if(M.isLOD)M.autoUpdate===!0&&M.update(U);else if(M.isLight)d.pushLight(M),M.castShadow&&d.pushShadow(M);else if(M.isSprite){if(!M.frustumCulled||$.intersectsSprite(M)){z&&kt.setFromMatrixPosition(M.matrixWorld).applyMatrix4(Tt);const ct=Y.update(M),mt=M.material;mt.visible&&m.push(M,ct,mt,k,kt.z,null)}}else if((M.isMesh||M.isLine||M.isPoints)&&(!M.frustumCulled||$.intersectsObject(M))){const ct=Y.update(M),mt=M.material;if(z&&(M.boundingSphere!==void 0?(M.boundingSphere===null&&M.computeBoundingSphere(),kt.copy(M.boundingSphere.center)):(ct.boundingSphere===null&&ct.computeBoundingSphere(),kt.copy(ct.boundingSphere.center)),kt.applyMatrix4(M.matrixWorld).applyMatrix4(Tt)),Array.isArray(mt)){const gt=ct.groups;for(let Ct=0,Dt=gt.length;Ct<Dt;Ct++){const _t=gt[Ct],$t=mt[_t.materialIndex];$t&&$t.visible&&m.push(M,ct,$t,k,kt.z,_t)}}else mt.visible&&m.push(M,ct,mt,k,kt.z,null)}}const tt=M.children;for(let ct=0,mt=tt.length;ct<mt;ct++)er(tt[ct],U,k,z)}function $a(M,U,k,z){const N=M.opaque,tt=M.transmissive,ct=M.transparent;d.setupLightsView(k),nt===!0&&Q.setGlobalState(v.clippingPlanes,k),z&&wt.viewport(P.copy(z)),N.length>0&&is(N,U,k),tt.length>0&&is(tt,U,k),ct.length>0&&is(ct,U,k),wt.buffers.depth.setTest(!0),wt.buffers.depth.setMask(!0),wt.buffers.color.setMask(!0),wt.setPolygonOffset(!1)}function Ka(M,U,k,z){if((k.isScene===!0?k.overrideMaterial:null)!==null)return;d.state.transmissionRenderTarget[z.id]===void 0&&(d.state.transmissionRenderTarget[z.id]=new Sn(1,1,{generateMipmaps:!0,type:Ht.has("EXT_color_buffer_half_float")||Ht.has("EXT_color_buffer_float")?ns:Mn,minFilter:Zn,samples:4,stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:Yt.workingColorSpace}));const tt=d.state.transmissionRenderTarget[z.id],ct=z.viewport||P;tt.setSize(ct.z,ct.w);const mt=v.getRenderTarget();v.setRenderTarget(tt),v.getClearColor(V),q=v.getClearAlpha(),q<1&&v.setClearColor(16777215,.5),v.clear(),Wt&&bt.render(k);const gt=v.toneMapping;v.toneMapping=Un;const Ct=z.viewport;if(z.viewport!==void 0&&(z.viewport=void 0),d.setupLightsView(z),nt===!0&&Q.setGlobalState(v.clippingPlanes,z),is(M,k,z),b.updateMultisampleRenderTarget(tt),b.updateRenderTargetMipmap(tt),Ht.has("WEBGL_multisampled_render_to_texture")===!1){let Dt=!1;for(let _t=0,$t=U.length;_t<$t;_t++){const re=U[_t],le=re.object,Ue=re.geometry,Kt=re.material,yt=re.group;if(Kt.side===he&&le.layers.test(z.layers)){const hn=Kt.side;Kt.side=Se,Kt.needsUpdate=!0,ja(le,k,z,Ue,Kt,yt),Kt.side=hn,Kt.needsUpdate=!0,Dt=!0}}Dt===!0&&(b.updateMultisampleRenderTarget(tt),b.updateRenderTargetMipmap(tt))}v.setRenderTarget(mt),v.setClearColor(V,q),Ct!==void 0&&(z.viewport=Ct),v.toneMapping=gt}function is(M,U,k){const z=U.isScene===!0?U.overrideMaterial:null;for(let N=0,tt=M.length;N<tt;N++){const ct=M[N],mt=ct.object,gt=ct.geometry,Ct=z===null?ct.material:z,Dt=ct.group;mt.layers.test(k.layers)&&ja(mt,U,k,gt,Ct,Dt)}}function ja(M,U,k,z,N,tt){M.onBeforeRender(v,U,k,z,N,tt),M.modelViewMatrix.multiplyMatrices(k.matrixWorldInverse,M.matrixWorld),M.normalMatrix.getNormalMatrix(M.modelViewMatrix),N.onBeforeRender(v,U,k,z,M,tt),N.transparent===!0&&N.side===he&&N.forceSinglePass===!1?(N.side=Se,N.needsUpdate=!0,v.renderBufferDirect(k,U,z,N,M,tt),N.side=Fn,N.needsUpdate=!0,v.renderBufferDirect(k,U,z,N,M,tt),N.side=he):v.renderBufferDirect(k,U,z,N,M,tt),M.onAfterRender(v,U,k,z,N,tt)}function ss(M,U,k){U.isScene!==!0&&(U=ue);const z=St.get(M),N=d.state.lights,tt=d.state.shadowsArray,ct=N.state.version,mt=xt.getParameters(M,N.state,tt,U,k),gt=xt.getProgramCacheKey(mt);let Ct=z.programs;z.environment=M.isMeshStandardMaterial?U.environment:null,z.fog=U.fog,z.envMap=(M.isMeshStandardMaterial?O:x).get(M.envMap||z.environment),z.envMapRotation=z.environment!==null&&M.envMap===null?U.environmentRotation:M.envMapRotation,Ct===void 0&&(M.addEventListener("dispose",It),Ct=new Map,z.programs=Ct);let Dt=Ct.get(gt);if(Dt!==void 0){if(z.currentProgram===Dt&&z.lightsStateVersion===ct)return Ja(M,mt),Dt}else mt.uniforms=xt.getUniforms(M),M.onBeforeCompile(mt,v),Dt=xt.acquireProgram(mt,gt),Ct.set(gt,Dt),z.uniforms=mt.uniforms;const _t=z.uniforms;return(!M.isShaderMaterial&&!M.isRawShaderMaterial||M.clipping===!0)&&(_t.clippingPlanes=Q.uniform),Ja(M,mt),z.needsLights=lc(M),z.lightsStateVersion=ct,z.needsLights&&(_t.ambientLightColor.value=N.state.ambient,_t.lightProbe.value=N.state.probe,_t.directionalLights.value=N.state.directional,_t.directionalLightShadows.value=N.state.directionalShadow,_t.spotLights.value=N.state.spot,_t.spotLightShadows.value=N.state.spotShadow,_t.rectAreaLights.value=N.state.rectArea,_t.ltc_1.value=N.state.rectAreaLTC1,_t.ltc_2.value=N.state.rectAreaLTC2,_t.pointLights.value=N.state.point,_t.pointLightShadows.value=N.state.pointShadow,_t.hemisphereLights.value=N.state.hemi,_t.directionalShadowMap.value=N.state.directionalShadowMap,_t.directionalShadowMatrix.value=N.state.directionalShadowMatrix,_t.spotShadowMap.value=N.state.spotShadowMap,_t.spotLightMatrix.value=N.state.spotLightMatrix,_t.spotLightMap.value=N.state.spotLightMap,_t.pointShadowMap.value=N.state.pointShadowMap,_t.pointShadowMatrix.value=N.state.pointShadowMatrix),z.currentProgram=Dt,z.uniformsList=null,Dt}function Za(M){if(M.uniformsList===null){const U=M.currentProgram.getUniforms();M.uniformsList=Hs.seqWithValue(U.seq,M.uniforms)}return M.uniformsList}function Ja(M,U){const k=St.get(M);k.outputColorSpace=U.outputColorSpace,k.batching=U.batching,k.batchingColor=U.batchingColor,k.instancing=U.instancing,k.instancingColor=U.instancingColor,k.instancingMorph=U.instancingMorph,k.skinning=U.skinning,k.morphTargets=U.morphTargets,k.morphNormals=U.morphNormals,k.morphColors=U.morphColors,k.morphTargetsCount=U.morphTargetsCount,k.numClippingPlanes=U.numClippingPlanes,k.numIntersection=U.numClipIntersection,k.vertexAlphas=U.vertexAlphas,k.vertexTangents=U.vertexTangents,k.toneMapping=U.toneMapping}function ac(M,U,k,z,N){U.isScene!==!0&&(U=ue),b.resetTextureUnits();const tt=U.fog,ct=z.isMeshStandardMaterial?U.environment:null,mt=L===null?v.outputColorSpace:L.isXRRenderTarget===!0?L.texture.colorSpace:Ii,gt=(z.isMeshStandardMaterial?O:x).get(z.envMap||ct),Ct=z.vertexColors===!0&&!!k.attributes.color&&k.attributes.color.itemSize===4,Dt=!!k.attributes.tangent&&(!!z.normalMap||z.anisotropy>0),_t=!!k.morphAttributes.position,$t=!!k.morphAttributes.normal,re=!!k.morphAttributes.color;let le=Un;z.toneMapped&&(L===null||L.isXRRenderTarget===!0)&&(le=v.toneMapping);const Ue=k.morphAttributes.position||k.morphAttributes.normal||k.morphAttributes.color,Kt=Ue!==void 0?Ue.length:0,yt=St.get(z),hn=d.state.lights;if(nt===!0&&(vt===!0||M!==y)){const qe=M===y&&z.id===E;Q.setState(z,M,qe)}let jt=!1;z.version===yt.__version?(yt.needsLights&&yt.lightsStateVersion!==hn.state.version||yt.outputColorSpace!==mt||N.isBatchedMesh&&yt.batching===!1||!N.isBatchedMesh&&yt.batching===!0||N.isBatchedMesh&&yt.batchingColor===!0&&N.colorTexture===null||N.isBatchedMesh&&yt.batchingColor===!1&&N.colorTexture!==null||N.isInstancedMesh&&yt.instancing===!1||!N.isInstancedMesh&&yt.instancing===!0||N.isSkinnedMesh&&yt.skinning===!1||!N.isSkinnedMesh&&yt.skinning===!0||N.isInstancedMesh&&yt.instancingColor===!0&&N.instanceColor===null||N.isInstancedMesh&&yt.instancingColor===!1&&N.instanceColor!==null||N.isInstancedMesh&&yt.instancingMorph===!0&&N.morphTexture===null||N.isInstancedMesh&&yt.instancingMorph===!1&&N.morphTexture!==null||yt.envMap!==gt||z.fog===!0&&yt.fog!==tt||yt.numClippingPlanes!==void 0&&(yt.numClippingPlanes!==Q.numPlanes||yt.numIntersection!==Q.numIntersection)||yt.vertexAlphas!==Ct||yt.vertexTangents!==Dt||yt.morphTargets!==_t||yt.morphNormals!==$t||yt.morphColors!==re||yt.toneMapping!==le||yt.morphTargetsCount!==Kt)&&(jt=!0):(jt=!0,yt.__version=z.version);let je=yt.currentProgram;jt===!0&&(je=ss(z,U,N));let ni=!1,He=!1,Ni=!1;const ce=je.getUniforms(),sn=yt.uniforms;if(wt.useProgram(je.program)&&(ni=!0,He=!0,Ni=!0),z.id!==E&&(E=z.id,He=!0),ni||y!==M){wt.buffers.depth.getReversed()?(at.copy(M.projectionMatrix),mh(at),gh(at),ce.setValue(F,"projectionMatrix",at)):ce.setValue(F,"projectionMatrix",M.projectionMatrix),ce.setValue(F,"viewMatrix",M.matrixWorldInverse);const En=ce.map.cameraPosition;En!==void 0&&En.setValue(F,Lt.setFromMatrixPosition(M.matrixWorld)),Vt.logarithmicDepthBuffer&&ce.setValue(F,"logDepthBufFC",2/(Math.log(M.far+1)/Math.LN2)),(z.isMeshPhongMaterial||z.isMeshToonMaterial||z.isMeshLambertMaterial||z.isMeshBasicMaterial||z.isMeshStandardMaterial||z.isShaderMaterial)&&ce.setValue(F,"isOrthographic",M.isOrthographicCamera===!0),y!==M&&(y=M,He=!0,Ni=!0)}if(N.isSkinnedMesh){ce.setOptional(F,N,"bindMatrix"),ce.setOptional(F,N,"bindMatrixInverse");const qe=N.skeleton;qe&&(qe.boneTexture===null&&qe.computeBoneTexture(),ce.setValue(F,"boneTexture",qe.boneTexture,b))}N.isBatchedMesh&&(ce.setOptional(F,N,"batchingTexture"),ce.setValue(F,"batchingTexture",N._matricesTexture,b),ce.setOptional(F,N,"batchingIdTexture"),ce.setValue(F,"batchingIdTexture",N._indirectTexture,b),ce.setOptional(F,N,"batchingColorTexture"),N._colorsTexture!==null&&ce.setValue(F,"batchingColorTexture",N._colorsTexture,b));const Fi=k.morphAttributes;if((Fi.position!==void 0||Fi.normal!==void 0||Fi.color!==void 0)&&Rt.update(N,k,je),(He||yt.receiveShadow!==N.receiveShadow)&&(yt.receiveShadow=N.receiveShadow,ce.setValue(F,"receiveShadow",N.receiveShadow)),z.isMeshGouraudMaterial&&z.envMap!==null&&(sn.envMap.value=gt,sn.flipEnvMap.value=gt.isCubeTexture&&gt.isRenderTargetTexture===!1?-1:1),z.isMeshStandardMaterial&&z.envMap===null&&U.environment!==null&&(sn.envMapIntensity.value=U.environmentIntensity),He&&(ce.setValue(F,"toneMappingExposure",v.toneMappingExposure),yt.needsLights&&oc(sn,Ni),tt&&z.fog===!0&&ot.refreshFogUniforms(sn,tt),ot.refreshMaterialUniforms(sn,z,W,J,d.state.transmissionRenderTarget[M.id]),Hs.upload(F,Za(yt),sn,b)),z.isShaderMaterial&&z.uniformsNeedUpdate===!0&&(Hs.upload(F,Za(yt),sn,b),z.uniformsNeedUpdate=!1),z.isSpriteMaterial&&ce.setValue(F,"center",N.center),ce.setValue(F,"modelViewMatrix",N.modelViewMatrix),ce.setValue(F,"normalMatrix",N.normalMatrix),ce.setValue(F,"modelMatrix",N.matrixWorld),z.isShaderMaterial||z.isRawShaderMaterial){const qe=z.uniformsGroups;for(let En=0,wn=qe.length;En<wn;En++){const Qa=qe[En];D.update(Qa,je),D.bind(Qa,je)}}return je}function oc(M,U){M.ambientLightColor.needsUpdate=U,M.lightProbe.needsUpdate=U,M.directionalLights.needsUpdate=U,M.directionalLightShadows.needsUpdate=U,M.pointLights.needsUpdate=U,M.pointLightShadows.needsUpdate=U,M.spotLights.needsUpdate=U,M.spotLightShadows.needsUpdate=U,M.rectAreaLights.needsUpdate=U,M.hemisphereLights.needsUpdate=U}function lc(M){return M.isMeshLambertMaterial||M.isMeshToonMaterial||M.isMeshPhongMaterial||M.isMeshStandardMaterial||M.isShadowMaterial||M.isShaderMaterial&&M.lights===!0}this.getActiveCubeFace=function(){return A},this.getActiveMipmapLevel=function(){return R},this.getRenderTarget=function(){return L},this.setRenderTargetTextures=function(M,U,k){St.get(M.texture).__webglTexture=U,St.get(M.depthTexture).__webglTexture=k;const z=St.get(M);z.__hasExternalTextures=!0,z.__autoAllocateDepthBuffer=k===void 0,z.__autoAllocateDepthBuffer||Ht.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),z.__useRenderToTexture=!1)},this.setRenderTargetFramebuffer=function(M,U){const k=St.get(M);k.__webglFramebuffer=U,k.__useDefaultFramebuffer=U===void 0},this.setRenderTarget=function(M,U=0,k=0){L=M,A=U,R=k;let z=!0,N=null,tt=!1,ct=!1;if(M){const gt=St.get(M);if(gt.__useDefaultFramebuffer!==void 0)wt.bindFramebuffer(F.FRAMEBUFFER,null),z=!1;else if(gt.__webglFramebuffer===void 0)b.setupRenderTarget(M);else if(gt.__hasExternalTextures)b.rebindTextures(M,St.get(M.texture).__webglTexture,St.get(M.depthTexture).__webglTexture);else if(M.depthBuffer){const _t=M.depthTexture;if(gt.__boundDepthTexture!==_t){if(_t!==null&&St.has(_t)&&(M.width!==_t.image.width||M.height!==_t.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");b.setupDepthRenderbuffer(M)}}const Ct=M.texture;(Ct.isData3DTexture||Ct.isDataArrayTexture||Ct.isCompressedArrayTexture)&&(ct=!0);const Dt=St.get(M).__webglFramebuffer;M.isWebGLCubeRenderTarget?(Array.isArray(Dt[U])?N=Dt[U][k]:N=Dt[U],tt=!0):M.samples>0&&b.useMultisampledRTT(M)===!1?N=St.get(M).__webglMultisampledFramebuffer:Array.isArray(Dt)?N=Dt[k]:N=Dt,P.copy(M.viewport),H.copy(M.scissor),B=M.scissorTest}else P.copy(Mt).multiplyScalar(W).floor(),H.copy(Bt).multiplyScalar(W).floor(),B=ie;if(wt.bindFramebuffer(F.FRAMEBUFFER,N)&&z&&wt.drawBuffers(M,N),wt.viewport(P),wt.scissor(H),wt.setScissorTest(B),tt){const gt=St.get(M.texture);F.framebufferTexture2D(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0,F.TEXTURE_CUBE_MAP_POSITIVE_X+U,gt.__webglTexture,k)}else if(ct){const gt=St.get(M.texture),Ct=U||0;F.framebufferTextureLayer(F.FRAMEBUFFER,F.COLOR_ATTACHMENT0,gt.__webglTexture,k||0,Ct)}E=-1},this.readRenderTargetPixels=function(M,U,k,z,N,tt,ct){if(!(M&&M.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let mt=St.get(M).__webglFramebuffer;if(M.isWebGLCubeRenderTarget&&ct!==void 0&&(mt=mt[ct]),mt){wt.bindFramebuffer(F.FRAMEBUFFER,mt);try{const gt=M.texture,Ct=gt.format,Dt=gt.type;if(!Vt.textureFormatReadable(Ct)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!Vt.textureTypeReadable(Dt)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}U>=0&&U<=M.width-z&&k>=0&&k<=M.height-N&&F.readPixels(U,k,z,N,Nt.convert(Ct),Nt.convert(Dt),tt)}finally{const gt=L!==null?St.get(L).__webglFramebuffer:null;wt.bindFramebuffer(F.FRAMEBUFFER,gt)}}},this.readRenderTargetPixelsAsync=async function(M,U,k,z,N,tt,ct){if(!(M&&M.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let mt=St.get(M).__webglFramebuffer;if(M.isWebGLCubeRenderTarget&&ct!==void 0&&(mt=mt[ct]),mt){const gt=M.texture,Ct=gt.format,Dt=gt.type;if(!Vt.textureFormatReadable(Ct))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!Vt.textureTypeReadable(Dt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");if(U>=0&&U<=M.width-z&&k>=0&&k<=M.height-N){wt.bindFramebuffer(F.FRAMEBUFFER,mt);const _t=F.createBuffer();F.bindBuffer(F.PIXEL_PACK_BUFFER,_t),F.bufferData(F.PIXEL_PACK_BUFFER,tt.byteLength,F.STREAM_READ),F.readPixels(U,k,z,N,Nt.convert(Ct),Nt.convert(Dt),0);const $t=L!==null?St.get(L).__webglFramebuffer:null;wt.bindFramebuffer(F.FRAMEBUFFER,$t);const re=F.fenceSync(F.SYNC_GPU_COMMANDS_COMPLETE,0);return F.flush(),await ph(F,re,4),F.bindBuffer(F.PIXEL_PACK_BUFFER,_t),F.getBufferSubData(F.PIXEL_PACK_BUFFER,0,tt),F.deleteBuffer(_t),F.deleteSync(re),tt}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")}},this.copyFramebufferToTexture=function(M,U=null,k=0){M.isTexture!==!0&&(Ki("WebGLRenderer: copyFramebufferToTexture function signature has changed."),U=arguments[0]||null,M=arguments[1]);const z=Math.pow(2,-k),N=Math.floor(M.image.width*z),tt=Math.floor(M.image.height*z),ct=U!==null?U.x:0,mt=U!==null?U.y:0;b.setTexture2D(M,0),F.copyTexSubImage2D(F.TEXTURE_2D,k,0,0,ct,mt,N,tt),wt.unbindTexture()},this.copyTextureToTexture=function(M,U,k=null,z=null,N=0){M.isTexture!==!0&&(Ki("WebGLRenderer: copyTextureToTexture function signature has changed."),z=arguments[0]||null,M=arguments[1],U=arguments[2],N=arguments[3]||0,k=null);let tt,ct,mt,gt,Ct,Dt,_t,$t,re;const le=M.isCompressedTexture?M.mipmaps[N]:M.image;k!==null?(tt=k.max.x-k.min.x,ct=k.max.y-k.min.y,mt=k.isBox3?k.max.z-k.min.z:1,gt=k.min.x,Ct=k.min.y,Dt=k.isBox3?k.min.z:0):(tt=le.width,ct=le.height,mt=le.depth||1,gt=0,Ct=0,Dt=0),z!==null?(_t=z.x,$t=z.y,re=z.z):(_t=0,$t=0,re=0);const Ue=Nt.convert(U.format),Kt=Nt.convert(U.type);let yt;U.isData3DTexture?(b.setTexture3D(U,0),yt=F.TEXTURE_3D):U.isDataArrayTexture||U.isCompressedArrayTexture?(b.setTexture2DArray(U,0),yt=F.TEXTURE_2D_ARRAY):(b.setTexture2D(U,0),yt=F.TEXTURE_2D),F.pixelStorei(F.UNPACK_FLIP_Y_WEBGL,U.flipY),F.pixelStorei(F.UNPACK_PREMULTIPLY_ALPHA_WEBGL,U.premultiplyAlpha),F.pixelStorei(F.UNPACK_ALIGNMENT,U.unpackAlignment);const hn=F.getParameter(F.UNPACK_ROW_LENGTH),jt=F.getParameter(F.UNPACK_IMAGE_HEIGHT),je=F.getParameter(F.UNPACK_SKIP_PIXELS),ni=F.getParameter(F.UNPACK_SKIP_ROWS),He=F.getParameter(F.UNPACK_SKIP_IMAGES);F.pixelStorei(F.UNPACK_ROW_LENGTH,le.width),F.pixelStorei(F.UNPACK_IMAGE_HEIGHT,le.height),F.pixelStorei(F.UNPACK_SKIP_PIXELS,gt),F.pixelStorei(F.UNPACK_SKIP_ROWS,Ct),F.pixelStorei(F.UNPACK_SKIP_IMAGES,Dt);const Ni=M.isDataArrayTexture||M.isData3DTexture,ce=U.isDataArrayTexture||U.isData3DTexture;if(M.isRenderTargetTexture||M.isDepthTexture){const sn=St.get(M),Fi=St.get(U),qe=St.get(sn.__renderTarget),En=St.get(Fi.__renderTarget);wt.bindFramebuffer(F.READ_FRAMEBUFFER,qe.__webglFramebuffer),wt.bindFramebuffer(F.DRAW_FRAMEBUFFER,En.__webglFramebuffer);for(let wn=0;wn<mt;wn++)Ni&&F.framebufferTextureLayer(F.READ_FRAMEBUFFER,F.COLOR_ATTACHMENT0,St.get(M).__webglTexture,N,Dt+wn),M.isDepthTexture?(ce&&F.framebufferTextureLayer(F.DRAW_FRAMEBUFFER,F.COLOR_ATTACHMENT0,St.get(U).__webglTexture,N,re+wn),F.blitFramebuffer(gt,Ct,tt,ct,_t,$t,tt,ct,F.DEPTH_BUFFER_BIT,F.NEAREST)):ce?F.copyTexSubImage3D(yt,N,_t,$t,re+wn,gt,Ct,tt,ct):F.copyTexSubImage2D(yt,N,_t,$t,re+wn,gt,Ct,tt,ct);wt.bindFramebuffer(F.READ_FRAMEBUFFER,null),wt.bindFramebuffer(F.DRAW_FRAMEBUFFER,null)}else ce?M.isDataTexture||M.isData3DTexture?F.texSubImage3D(yt,N,_t,$t,re,tt,ct,mt,Ue,Kt,le.data):U.isCompressedArrayTexture?F.compressedTexSubImage3D(yt,N,_t,$t,re,tt,ct,mt,Ue,le.data):F.texSubImage3D(yt,N,_t,$t,re,tt,ct,mt,Ue,Kt,le):M.isDataTexture?F.texSubImage2D(F.TEXTURE_2D,N,_t,$t,tt,ct,Ue,Kt,le.data):M.isCompressedTexture?F.compressedTexSubImage2D(F.TEXTURE_2D,N,_t,$t,le.width,le.height,Ue,le.data):F.texSubImage2D(F.TEXTURE_2D,N,_t,$t,tt,ct,Ue,Kt,le);F.pixelStorei(F.UNPACK_ROW_LENGTH,hn),F.pixelStorei(F.UNPACK_IMAGE_HEIGHT,jt),F.pixelStorei(F.UNPACK_SKIP_PIXELS,je),F.pixelStorei(F.UNPACK_SKIP_ROWS,ni),F.pixelStorei(F.UNPACK_SKIP_IMAGES,He),N===0&&U.generateMipmaps&&F.generateMipmap(yt),wt.unbindTexture()},this.copyTextureToTexture3D=function(M,U,k=null,z=null,N=0){return M.isTexture!==!0&&(Ki("WebGLRenderer: copyTextureToTexture3D function signature has changed."),k=arguments[0]||null,z=arguments[1]||null,M=arguments[2],U=arguments[3],N=arguments[4]||0),Ki('WebGLRenderer: copyTextureToTexture3D function has been deprecated. Use "copyTextureToTexture" instead.'),this.copyTextureToTexture(M,U,k,z,N)},this.initRenderTarget=function(M){St.get(M).__webglFramebuffer===void 0&&b.setupRenderTarget(M)},this.initTexture=function(M){M.isCubeTexture?b.setTextureCube(M,0):M.isData3DTexture?b.setTexture3D(M,0):M.isDataArrayTexture||M.isCompressedArrayTexture?b.setTexture2DArray(M,0):b.setTexture2D(M,0),wt.unbindTexture()},this.resetState=function(){A=0,R=0,L=null,wt.reset(),se.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return vn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t;const e=this.getContext();e.drawingBufferColorspace=Yt._getDrawingBufferColorSpace(t),e.unpackColorSpace=Yt._getUnpackColorSpace()}}class Ha{constructor(t,e=25e-5){this.isFogExp2=!0,this.name="",this.color=new Ot(t),this.density=e}clone(){return new Ha(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}}class Am extends Qt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new ze,this.environmentIntensity=1,this.environmentRotation=new ze,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){const e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(e.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(e.object.backgroundIntensity=this.backgroundIntensity),e.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(e.object.environmentIntensity=this.environmentIntensity),e.object.environmentRotation=this.environmentRotation.toArray(),e}}class Rm{constructor(t,e){this.isInterleavedBuffer=!0,this.array=t,this.stride=e,this.count=t!==void 0?t.length/e:0,this.usage=wa,this.updateRanges=[],this.version=0,this.uuid=xn()}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.array=new t.array.constructor(t.array),this.count=t.count,this.stride=t.stride,this.usage=t.usage,this}copyAt(t,e,n){t*=this.stride,n*=e.stride;for(let i=0,r=this.stride;i<r;i++)this.array[t+i]=e.array[n+i];return this}set(t,e=0){return this.array.set(t,e),this}clone(t){t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=xn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);const e=new this.array.constructor(t.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(e,this.stride);return n.setUsage(this.usage),n}onUpload(t){return this.onUploadCallback=t,this}toJSON(t){return t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=xn()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}}const Ce=new C;class Ws{constructor(t,e,n,i=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=t,this.itemSize=e,this.offset=n,this.normalized=i}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(t){this.data.needsUpdate=t}applyMatrix4(t){for(let e=0,n=this.data.count;e<n;e++)Ce.fromBufferAttribute(this,e),Ce.applyMatrix4(t),this.setXYZ(e,Ce.x,Ce.y,Ce.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)Ce.fromBufferAttribute(this,e),Ce.applyNormalMatrix(t),this.setXYZ(e,Ce.x,Ce.y,Ce.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)Ce.fromBufferAttribute(this,e),Ce.transformDirection(t),this.setXYZ(e,Ce.x,Ce.y,Ce.z);return this}getComponent(t,e){let n=this.array[t*this.data.stride+this.offset+e];return this.normalized&&(n=en(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=Jt(n,this.array)),this.data.array[t*this.data.stride+this.offset+e]=n,this}setX(t,e){return this.normalized&&(e=Jt(e,this.array)),this.data.array[t*this.data.stride+this.offset]=e,this}setY(t,e){return this.normalized&&(e=Jt(e,this.array)),this.data.array[t*this.data.stride+this.offset+1]=e,this}setZ(t,e){return this.normalized&&(e=Jt(e,this.array)),this.data.array[t*this.data.stride+this.offset+2]=e,this}setW(t,e){return this.normalized&&(e=Jt(e,this.array)),this.data.array[t*this.data.stride+this.offset+3]=e,this}getX(t){let e=this.data.array[t*this.data.stride+this.offset];return this.normalized&&(e=en(e,this.array)),e}getY(t){let e=this.data.array[t*this.data.stride+this.offset+1];return this.normalized&&(e=en(e,this.array)),e}getZ(t){let e=this.data.array[t*this.data.stride+this.offset+2];return this.normalized&&(e=en(e,this.array)),e}getW(t){let e=this.data.array[t*this.data.stride+this.offset+3];return this.normalized&&(e=en(e,this.array)),e}setXY(t,e,n){return t=t*this.data.stride+this.offset,this.normalized&&(e=Jt(e,this.array),n=Jt(n,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this}setXYZ(t,e,n,i){return t=t*this.data.stride+this.offset,this.normalized&&(e=Jt(e,this.array),n=Jt(n,this.array),i=Jt(i,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this.data.array[t+2]=i,this}setXYZW(t,e,n,i,r){return t=t*this.data.stride+this.offset,this.normalized&&(e=Jt(e,this.array),n=Jt(n,this.array),i=Jt(i,this.array),r=Jt(r,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this.data.array[t+2]=i,this.data.array[t+3]=r,this}clone(t){if(t===void 0){console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let n=0;n<this.count;n++){const i=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)e.push(this.data.array[i+r])}return new De(new this.array.constructor(e),this.itemSize,this.normalized)}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.clone(t)),new Ws(t.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(t){if(t===void 0){console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let n=0;n<this.count;n++){const i=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)e.push(this.data.array[i+r])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:e,normalized:this.normalized}}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.toJSON(t)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}}class Va extends Bn{static get type(){return"SpriteMaterial"}constructor(t){super(),this.isSpriteMaterial=!0,this.color=new Ot(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.rotation=t.rotation,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}}let _i;const Hi=new C,vi=new C,xi=new C,yi=new Pt,Vi=new Pt,tc=new te,Ts=new C,Gi=new C,As=new C,Qo=new Pt,Pr=new Pt,tl=new Pt;class ec extends Qt{constructor(t=new Va){if(super(),this.isSprite=!0,this.type="Sprite",_i===void 0){_i=new ve;const e=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),n=new Rm(e,5);_i.setIndex([0,1,2,0,2,3]),_i.setAttribute("position",new Ws(n,3,0,!1)),_i.setAttribute("uv",new Ws(n,2,3,!1))}this.geometry=_i,this.material=t,this.center=new Pt(.5,.5)}raycast(t,e){t.camera===null&&console.error('THREE.Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),vi.setFromMatrixScale(this.matrixWorld),tc.copy(t.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(t.camera.matrixWorldInverse,this.matrixWorld),xi.setFromMatrixPosition(this.modelViewMatrix),t.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&vi.multiplyScalar(-xi.z);const n=this.material.rotation;let i,r;n!==0&&(r=Math.cos(n),i=Math.sin(n));const a=this.center;Rs(Ts.set(-.5,-.5,0),xi,a,vi,i,r),Rs(Gi.set(.5,-.5,0),xi,a,vi,i,r),Rs(As.set(.5,.5,0),xi,a,vi,i,r),Qo.set(0,0),Pr.set(1,0),tl.set(1,1);let o=t.ray.intersectTriangle(Ts,Gi,As,!1,Hi);if(o===null&&(Rs(Gi.set(-.5,.5,0),xi,a,vi,i,r),Pr.set(0,1),o=t.ray.intersectTriangle(Ts,As,Gi,!1,Hi),o===null))return;const l=t.ray.origin.distanceTo(Hi);l<t.near||l>t.far||e.push({distance:l,point:Hi.clone(),uv:$e.getInterpolation(Hi,Ts,Gi,As,Qo,Pr,tl,new Pt),face:null,object:this})}copy(t,e){return super.copy(t,e),t.center!==void 0&&this.center.copy(t.center),this.material=t.material,this}}function Rs(s,t,e,n,i,r){yi.subVectors(s,e).addScalar(.5).multiply(n),i!==void 0?(Vi.x=r*yi.x-i*yi.y,Vi.y=i*yi.x+r*yi.y):Vi.copy(yi),s.copy(t),s.x+=Vi.x,s.y+=Vi.y,s.applyMatrix4(tc)}class Cm extends Re{constructor(t=null,e=1,n=1,i,r,a,o,l,c=We,h=We,u,f){super(null,a,o,l,c,h,i,r,u,f),this.isDataTexture=!0,this.image={data:t,width:e,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class el extends De{constructor(t,e,n,i=1){super(t,e,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=i}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}toJSON(){const t=super.toJSON();return t.meshPerAttribute=this.meshPerAttribute,t.isInstancedBufferAttribute=!0,t}}const Mi=new te,nl=new te,Cs=[],il=new ti,Pm=new te,Wi=new et,Xi=new ei;class Ne extends et{constructor(t,e,n){super(t,e),this.isInstancedMesh=!0,this.instanceMatrix=new el(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let i=0;i<n;i++)this.setMatrixAt(i,Pm)}computeBoundingBox(){const t=this.geometry,e=this.count;this.boundingBox===null&&(this.boundingBox=new ti),t.boundingBox===null&&t.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,Mi),il.copy(t.boundingBox).applyMatrix4(Mi),this.boundingBox.union(il)}computeBoundingSphere(){const t=this.geometry,e=this.count;this.boundingSphere===null&&(this.boundingSphere=new ei),t.boundingSphere===null&&t.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,Mi),Xi.copy(t.boundingSphere).applyMatrix4(Mi),this.boundingSphere.union(Xi)}copy(t,e){return super.copy(t,e),this.instanceMatrix.copy(t.instanceMatrix),t.morphTexture!==null&&(this.morphTexture=t.morphTexture.clone()),t.instanceColor!==null&&(this.instanceColor=t.instanceColor.clone()),this.count=t.count,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}getColorAt(t,e){e.fromArray(this.instanceColor.array,t*3)}getMatrixAt(t,e){e.fromArray(this.instanceMatrix.array,t*16)}getMorphAt(t,e){const n=e.morphTargetInfluences,i=this.morphTexture.source.data.data,r=n.length+1,a=t*r+1;for(let o=0;o<n.length;o++)n[o]=i[a+o]}raycast(t,e){const n=this.matrixWorld,i=this.count;if(Wi.geometry=this.geometry,Wi.material=this.material,Wi.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Xi.copy(this.boundingSphere),Xi.applyMatrix4(n),t.ray.intersectsSphere(Xi)!==!1))for(let r=0;r<i;r++){this.getMatrixAt(r,Mi),nl.multiplyMatrices(n,Mi),Wi.matrixWorld=nl,Wi.raycast(t,Cs);for(let a=0,o=Cs.length;a<o;a++){const l=Cs[a];l.instanceId=r,l.object=this,e.push(l)}Cs.length=0}}setColorAt(t,e){this.instanceColor===null&&(this.instanceColor=new el(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),e.toArray(this.instanceColor.array,t*3)}setMatrixAt(t,e){e.toArray(this.instanceMatrix.array,t*16)}setMorphAt(t,e){const n=e.morphTargetInfluences,i=n.length+1;this.morphTexture===null&&(this.morphTexture=new Cm(new Float32Array(i*this.count),i,this.count,Da,on));const r=this.morphTexture.source.data.data;let a=0;for(let c=0;c<n.length;c++)a+=n[c];const o=this.geometry.morphTargetsRelative?1:1-a,l=i*t;r[l]=o,r.set(n,l+1)}updateMorphTargets(){}dispose(){return this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null),this}}class nc extends Bn{static get type(){return"LineBasicMaterial"}constructor(t){super(),this.isLineBasicMaterial=!0,this.color=new Ot(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.linewidth=t.linewidth,this.linecap=t.linecap,this.linejoin=t.linejoin,this.fog=t.fog,this}}const Xs=new C,qs=new C,sl=new te,qi=new Ba,Ps=new ei,Lr=new C,rl=new C;class Lm extends Qt{constructor(t=new ve,e=new nc){super(),this.isLine=!0,this.type="Line",this.geometry=t,this.material=e,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}computeLineDistances(){const t=this.geometry;if(t.index===null){const e=t.attributes.position,n=[0];for(let i=1,r=e.count;i<r;i++)Xs.fromBufferAttribute(e,i-1),qs.fromBufferAttribute(e,i),n[i]=n[i-1],n[i]+=Xs.distanceTo(qs);t.setAttribute("lineDistance",new ae(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(t,e){const n=this.geometry,i=this.matrixWorld,r=t.params.Line.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Ps.copy(n.boundingSphere),Ps.applyMatrix4(i),Ps.radius+=r,t.ray.intersectsSphere(Ps)===!1)return;sl.copy(i).invert(),qi.copy(t.ray).applyMatrix4(sl);const o=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,c=this.isLineSegments?2:1,h=n.index,f=n.attributes.position;if(h!==null){const p=Math.max(0,a.start),g=Math.min(h.count,a.start+a.count);for(let _=p,m=g-1;_<m;_+=c){const d=h.getX(_),S=h.getX(_+1),w=Ls(this,t,qi,l,d,S);w&&e.push(w)}if(this.isLineLoop){const _=h.getX(g-1),m=h.getX(p),d=Ls(this,t,qi,l,_,m);d&&e.push(d)}}else{const p=Math.max(0,a.start),g=Math.min(f.count,a.start+a.count);for(let _=p,m=g-1;_<m;_+=c){const d=Ls(this,t,qi,l,_,_+1);d&&e.push(d)}if(this.isLineLoop){const _=Ls(this,t,qi,l,g-1,p);_&&e.push(_)}}}updateMorphTargets(){const e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){const i=e[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=i.length;r<a;r++){const o=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}}function Ls(s,t,e,n,i,r){const a=s.geometry.attributes.position;if(Xs.fromBufferAttribute(a,i),qs.fromBufferAttribute(a,r),e.distanceSqToSegment(Xs,qs,Lr,rl)>n)return;Lr.applyMatrix4(s.matrixWorld);const l=t.ray.origin.distanceTo(Lr);if(!(l<t.near||l>t.far))return{distance:l,point:rl.clone().applyMatrix4(s.matrixWorld),index:i,face:null,faceIndex:null,barycoord:null,object:s}}class Ys extends Bn{static get type(){return"PointsMaterial"}constructor(t){super(),this.isPointsMaterial=!0,this.color=new Ot(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.size=t.size,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}}const al=new te,Ta=new Ba,Is=new ei,Ds=new C;class Aa extends Qt{constructor(t=new ve,e=new Ys){super(),this.isPoints=!0,this.type="Points",this.geometry=t,this.material=e,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}raycast(t,e){const n=this.geometry,i=this.matrixWorld,r=t.params.Points.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Is.copy(n.boundingSphere),Is.applyMatrix4(i),Is.radius+=r,t.ray.intersectsSphere(Is)===!1)return;al.copy(i).invert(),Ta.copy(t.ray).applyMatrix4(al);const o=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,c=n.index,u=n.attributes.position;if(c!==null){const f=Math.max(0,a.start),p=Math.min(c.count,a.start+a.count);for(let g=f,_=p;g<_;g++){const m=c.getX(g);Ds.fromBufferAttribute(u,m),ol(Ds,m,l,i,t,e,this)}}else{const f=Math.max(0,a.start),p=Math.min(u.count,a.start+a.count);for(let g=f,_=p;g<_;g++)Ds.fromBufferAttribute(u,g),ol(Ds,g,l,i,t,e,this)}}updateMorphTargets(){const e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){const i=e[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=i.length;r<a;r++){const o=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}}function ol(s,t,e,n,i,r,a){const o=Ta.distanceSqToPoint(s);if(o<e){const l=new C;Ta.closestPointToPoint(s,l),l.applyMatrix4(n);const c=i.ray.origin.distanceTo(l);if(c<i.near||c>i.far)return;r.push({distance:c,distanceToRay:Math.sqrt(o),point:l,index:t,face:null,faceIndex:null,barycoord:null,object:a})}}class Ga extends Re{constructor(t,e,n,i,r,a,o,l,c){super(t,e,n,i,r,a,o,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}}class Oe extends ve{constructor(t=1,e=32,n=0,i=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:t,segments:e,thetaStart:n,thetaLength:i},e=Math.max(3,e);const r=[],a=[],o=[],l=[],c=new C,h=new Pt;a.push(0,0,0),o.push(0,0,1),l.push(.5,.5);for(let u=0,f=3;u<=e;u++,f+=3){const p=n+u/e*i;c.x=t*Math.cos(p),c.y=t*Math.sin(p),a.push(c.x,c.y,c.z),o.push(0,0,1),h.x=(a[f]/t+1)/2,h.y=(a[f+1]/t+1)/2,l.push(h.x,h.y)}for(let u=1;u<=e;u++)r.push(u,u+1,0);this.setIndex(r),this.setAttribute("position",new ae(a,3)),this.setAttribute("normal",new ae(o,3)),this.setAttribute("uv",new ae(l,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Oe(t.radius,t.segments,t.thetaStart,t.thetaLength)}}class ke extends ve{constructor(t=1,e=1,n=1,i=32,r=1,a=!1,o=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:t,radiusBottom:e,height:n,radialSegments:i,heightSegments:r,openEnded:a,thetaStart:o,thetaLength:l};const c=this;i=Math.floor(i),r=Math.floor(r);const h=[],u=[],f=[],p=[];let g=0;const _=[],m=n/2;let d=0;S(),a===!1&&(t>0&&w(!0),e>0&&w(!1)),this.setIndex(h),this.setAttribute("position",new ae(u,3)),this.setAttribute("normal",new ae(f,3)),this.setAttribute("uv",new ae(p,2));function S(){const v=new C,I=new C;let A=0;const R=(e-t)/n;for(let L=0;L<=r;L++){const E=[],y=L/r,P=y*(e-t)+t;for(let H=0;H<=i;H++){const B=H/i,V=B*l+o,q=Math.sin(V),G=Math.cos(V);I.x=P*q,I.y=-y*n+m,I.z=P*G,u.push(I.x,I.y,I.z),v.set(q,R,G).normalize(),f.push(v.x,v.y,v.z),p.push(B,1-y),E.push(g++)}_.push(E)}for(let L=0;L<i;L++)for(let E=0;E<r;E++){const y=_[E][L],P=_[E+1][L],H=_[E+1][L+1],B=_[E][L+1];(t>0||E!==0)&&(h.push(y,P,B),A+=3),(e>0||E!==r-1)&&(h.push(P,H,B),A+=3)}c.addGroup(d,A,0),d+=A}function w(v){const I=g,A=new Pt,R=new C;let L=0;const E=v===!0?t:e,y=v===!0?1:-1;for(let H=1;H<=i;H++)u.push(0,m*y,0),f.push(0,y,0),p.push(.5,.5),g++;const P=g;for(let H=0;H<=i;H++){const V=H/i*l+o,q=Math.cos(V),G=Math.sin(V);R.x=E*G,R.y=m*y,R.z=E*q,u.push(R.x,R.y,R.z),f.push(0,y,0),A.x=q*.5+.5,A.y=G*.5*y+.5,p.push(A.x,A.y),g++}for(let H=0;H<i;H++){const B=I+H,V=P+H;v===!0?h.push(V,V+1,B):h.push(V+1,V,B),L+=3}c.addGroup(d,L,v===!0?1:2),d+=L}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new ke(t.radiusTop,t.radiusBottom,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class Nn extends ke{constructor(t=1,e=1,n=32,i=1,r=!1,a=0,o=Math.PI*2){super(0,t,e,n,i,r,a,o),this.type="ConeGeometry",this.parameters={radius:t,height:e,radialSegments:n,heightSegments:i,openEnded:r,thetaStart:a,thetaLength:o}}static fromJSON(t){return new Nn(t.radius,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class Js extends ve{constructor(t=[],e=[],n=1,i=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:t,indices:e,radius:n,detail:i};const r=[],a=[];o(i),c(n),h(),this.setAttribute("position",new ae(r,3)),this.setAttribute("normal",new ae(r.slice(),3)),this.setAttribute("uv",new ae(a,2)),i===0?this.computeVertexNormals():this.normalizeNormals();function o(S){const w=new C,v=new C,I=new C;for(let A=0;A<e.length;A+=3)p(e[A+0],w),p(e[A+1],v),p(e[A+2],I),l(w,v,I,S)}function l(S,w,v,I){const A=I+1,R=[];for(let L=0;L<=A;L++){R[L]=[];const E=S.clone().lerp(v,L/A),y=w.clone().lerp(v,L/A),P=A-L;for(let H=0;H<=P;H++)H===0&&L===A?R[L][H]=E:R[L][H]=E.clone().lerp(y,H/P)}for(let L=0;L<A;L++)for(let E=0;E<2*(A-L)-1;E++){const y=Math.floor(E/2);E%2===0?(f(R[L][y+1]),f(R[L+1][y]),f(R[L][y])):(f(R[L][y+1]),f(R[L+1][y+1]),f(R[L+1][y]))}}function c(S){const w=new C;for(let v=0;v<r.length;v+=3)w.x=r[v+0],w.y=r[v+1],w.z=r[v+2],w.normalize().multiplyScalar(S),r[v+0]=w.x,r[v+1]=w.y,r[v+2]=w.z}function h(){const S=new C;for(let w=0;w<r.length;w+=3){S.x=r[w+0],S.y=r[w+1],S.z=r[w+2];const v=m(S)/2/Math.PI+.5,I=d(S)/Math.PI+.5;a.push(v,1-I)}g(),u()}function u(){for(let S=0;S<a.length;S+=6){const w=a[S+0],v=a[S+2],I=a[S+4],A=Math.max(w,v,I),R=Math.min(w,v,I);A>.9&&R<.1&&(w<.2&&(a[S+0]+=1),v<.2&&(a[S+2]+=1),I<.2&&(a[S+4]+=1))}}function f(S){r.push(S.x,S.y,S.z)}function p(S,w){const v=S*3;w.x=t[v+0],w.y=t[v+1],w.z=t[v+2]}function g(){const S=new C,w=new C,v=new C,I=new C,A=new Pt,R=new Pt,L=new Pt;for(let E=0,y=0;E<r.length;E+=9,y+=6){S.set(r[E+0],r[E+1],r[E+2]),w.set(r[E+3],r[E+4],r[E+5]),v.set(r[E+6],r[E+7],r[E+8]),A.set(a[y+0],a[y+1]),R.set(a[y+2],a[y+3]),L.set(a[y+4],a[y+5]),I.copy(S).add(w).add(v).divideScalar(3);const P=m(I);_(A,y+0,S,P),_(R,y+2,w,P),_(L,y+4,v,P)}}function _(S,w,v,I){I<0&&S.x===1&&(a[w]=S.x-1),v.x===0&&v.z===0&&(a[w]=I/2/Math.PI+.5)}function m(S){return Math.atan2(S.z,-S.x)}function d(S){return Math.atan2(-S.y,Math.sqrt(S.x*S.x+S.z*S.z))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Js(t.vertices,t.indices,t.radius,t.details)}}class Qs extends Js{constructor(t=1,e=0){const n=(1+Math.sqrt(5))/2,i=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],r=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(i,r,t,e),this.type="IcosahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new Qs(t.radius,t.detail)}}class Wa extends Js{constructor(t=1,e=0){const n=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],i=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super(n,i,t,e),this.type="OctahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new Wa(t.radius,t.detail)}}class Qi extends ve{constructor(t=.5,e=1,n=32,i=1,r=0,a=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:t,outerRadius:e,thetaSegments:n,phiSegments:i,thetaStart:r,thetaLength:a},n=Math.max(3,n),i=Math.max(1,i);const o=[],l=[],c=[],h=[];let u=t;const f=(e-t)/i,p=new C,g=new Pt;for(let _=0;_<=i;_++){for(let m=0;m<=n;m++){const d=r+m/n*a;p.x=u*Math.cos(d),p.y=u*Math.sin(d),l.push(p.x,p.y,p.z),c.push(0,0,1),g.x=(p.x/e+1)/2,g.y=(p.y/e+1)/2,h.push(g.x,g.y)}u+=f}for(let _=0;_<i;_++){const m=_*(n+1);for(let d=0;d<n;d++){const S=d+m,w=S,v=S+n+1,I=S+n+2,A=S+1;o.push(w,v,A),o.push(v,I,A)}}this.setIndex(o),this.setAttribute("position",new ae(l,3)),this.setAttribute("normal",new ae(c,3)),this.setAttribute("uv",new ae(h,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Qi(t.innerRadius,t.outerRadius,t.thetaSegments,t.phiSegments,t.thetaStart,t.thetaLength)}}class Te extends ve{constructor(t=1,e=32,n=16,i=0,r=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:t,widthSegments:e,heightSegments:n,phiStart:i,phiLength:r,thetaStart:a,thetaLength:o},e=Math.max(3,Math.floor(e)),n=Math.max(2,Math.floor(n));const l=Math.min(a+o,Math.PI);let c=0;const h=[],u=new C,f=new C,p=[],g=[],_=[],m=[];for(let d=0;d<=n;d++){const S=[],w=d/n;let v=0;d===0&&a===0?v=.5/e:d===n&&l===Math.PI&&(v=-.5/e);for(let I=0;I<=e;I++){const A=I/e;u.x=-t*Math.cos(i+A*r)*Math.sin(a+w*o),u.y=t*Math.cos(a+w*o),u.z=t*Math.sin(i+A*r)*Math.sin(a+w*o),g.push(u.x,u.y,u.z),f.copy(u).normalize(),_.push(f.x,f.y,f.z),m.push(A+v,1-w),S.push(c++)}h.push(S)}for(let d=0;d<n;d++)for(let S=0;S<e;S++){const w=h[d][S+1],v=h[d][S],I=h[d+1][S],A=h[d+1][S+1];(d!==0||a>0)&&p.push(w,v,A),(d!==n-1||l<Math.PI)&&p.push(v,I,A)}this.setIndex(p),this.setAttribute("position",new ae(g,3)),this.setAttribute("normal",new ae(_,3)),this.setAttribute("uv",new ae(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Te(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}}class Qn extends ve{constructor(t=1,e=.4,n=12,i=48,r=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:t,tube:e,radialSegments:n,tubularSegments:i,arc:r},n=Math.floor(n),i=Math.floor(i);const a=[],o=[],l=[],c=[],h=new C,u=new C,f=new C;for(let p=0;p<=n;p++)for(let g=0;g<=i;g++){const _=g/i*r,m=p/n*Math.PI*2;u.x=(t+e*Math.cos(m))*Math.cos(_),u.y=(t+e*Math.cos(m))*Math.sin(_),u.z=e*Math.sin(m),o.push(u.x,u.y,u.z),h.x=t*Math.cos(_),h.y=t*Math.sin(_),f.subVectors(u,h).normalize(),l.push(f.x,f.y,f.z),c.push(g/i),c.push(p/n)}for(let p=1;p<=n;p++)for(let g=1;g<=i;g++){const _=(i+1)*p+g-1,m=(i+1)*(p-1)+g-1,d=(i+1)*(p-1)+g,S=(i+1)*p+g;a.push(_,m,S),a.push(m,d,S)}this.setIndex(a),this.setAttribute("position",new ae(o,3)),this.setAttribute("normal",new ae(l,3)),this.setAttribute("uv",new ae(c,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Qn(t.radius,t.tube,t.radialSegments,t.tubularSegments,t.arc)}}class ge extends Bn{static get type(){return"MeshStandardMaterial"}constructor(t){super(),this.isMeshStandardMaterial=!0,this.defines={STANDARD:""},this.color=new Ot(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ot(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Nl,this.normalScale=new Pt(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new ze,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={STANDARD:""},this.color.copy(t.color),this.roughness=t.roughness,this.metalness=t.metalness,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.roughnessMap=t.roughnessMap,this.metalnessMap=t.metalnessMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.envMapIntensity=t.envMapIntensity,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}class tr extends Qt{constructor(t,e=1){super(),this.isLight=!0,this.type="Light",this.color=new Ot(t),this.intensity=e}dispose(){}copy(t,e){return super.copy(t,e),this.color.copy(t.color),this.intensity=t.intensity,this}toJSON(t){const e=super.toJSON(t);return e.object.color=this.color.getHex(),e.object.intensity=this.intensity,this.groundColor!==void 0&&(e.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(e.object.distance=this.distance),this.angle!==void 0&&(e.object.angle=this.angle),this.decay!==void 0&&(e.object.decay=this.decay),this.penumbra!==void 0&&(e.object.penumbra=this.penumbra),this.shadow!==void 0&&(e.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(e.object.target=this.target.uuid),e}}class Im extends tr{constructor(t,e,n){super(t,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(Qt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Ot(e)}copy(t,e){return super.copy(t,e),this.groundColor.copy(t.groundColor),this}}const Ir=new te,ll=new C,cl=new C;class ic{constructor(t){this.camera=t,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Pt(512,512),this.map=null,this.mapPass=null,this.matrix=new te,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new ka,this._frameExtents=new Pt(1,1),this._viewportCount=1,this._viewports=[new ne(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(t){const e=this.camera,n=this.matrix;ll.setFromMatrixPosition(t.matrixWorld),e.position.copy(ll),cl.setFromMatrixPosition(t.target.matrixWorld),e.lookAt(cl),e.updateMatrixWorld(),Ir.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Ir),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Ir)}getViewport(t){return this._viewports[t]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(t){return this.camera=t.camera.clone(),this.intensity=t.intensity,this.bias=t.bias,this.radius=t.radius,this.mapSize.copy(t.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const t={};return this.intensity!==1&&(t.intensity=this.intensity),this.bias!==0&&(t.bias=this.bias),this.normalBias!==0&&(t.normalBias=this.normalBias),this.radius!==1&&(t.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(t.mapSize=this.mapSize.toArray()),t.camera=this.camera.toJSON(!1).object,delete t.camera.matrix,t}}const hl=new te,Yi=new C,Dr=new C;class Dm extends ic{constructor(){super(new Ie(90,1,.5,500)),this.isPointLightShadow=!0,this._frameExtents=new Pt(4,2),this._viewportCount=6,this._viewports=[new ne(2,1,1,1),new ne(0,1,1,1),new ne(3,1,1,1),new ne(1,1,1,1),new ne(3,0,1,1),new ne(1,0,1,1)],this._cubeDirections=[new C(1,0,0),new C(-1,0,0),new C(0,0,1),new C(0,0,-1),new C(0,1,0),new C(0,-1,0)],this._cubeUps=[new C(0,1,0),new C(0,1,0),new C(0,1,0),new C(0,1,0),new C(0,0,1),new C(0,0,-1)]}updateMatrices(t,e=0){const n=this.camera,i=this.matrix,r=t.distance||n.far;r!==n.far&&(n.far=r,n.updateProjectionMatrix()),Yi.setFromMatrixPosition(t.matrixWorld),n.position.copy(Yi),Dr.copy(n.position),Dr.add(this._cubeDirections[e]),n.up.copy(this._cubeUps[e]),n.lookAt(Dr),n.updateMatrixWorld(),i.makeTranslation(-Yi.x,-Yi.y,-Yi.z),hl.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(hl)}}class Xa extends tr{constructor(t,e,n=0,i=2){super(t,e),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=i,this.shadow=new Dm}get power(){return this.intensity*4*Math.PI}set power(t){this.intensity=t/(4*Math.PI)}dispose(){this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.decay=t.decay,this.shadow=t.shadow.clone(),this}}class Um extends ic{constructor(){super(new $l(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class Nm extends tr{constructor(t,e){super(t,e),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(Qt.DEFAULT_UP),this.updateMatrix(),this.target=new Qt,this.shadow=new Um}dispose(){this.shadow.dispose()}copy(t){return super.copy(t),this.target=t.target.clone(),this.shadow=t.shadow.clone(),this}}class Fm extends tr{constructor(t,e){super(t,e),this.isAmbientLight=!0,this.type="AmbientLight"}}class Om{constructor(t=!0){this.autoStart=t,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1}start(){this.startTime=ul(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let t=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){const e=ul();t=(e-this.oldTime)/1e3,this.oldTime=e,this.elapsedTime+=t}return t}}function ul(){return performance.now()}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Ca}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Ca);const dl={mouseSens:1,volume:.6,invertY:!1,mute:!1},Fe={plasma:{id:"plasma",name:"PLASMA",damage:18,fireRate:6,projectileSpeed:220,splashRadius:0,ammo:-1,heatPerShot:0,selfDamageScale:0,color:61695,trailColor:6750207},rocket:{id:"rocket",name:"ROCKET",damage:72,fireRate:.55,projectileSpeed:78,splashRadius:16,ammo:4,heatPerShot:0,selfDamageScale:.45,color:16739115,trailColor:16755268},rail:{id:"rail",name:"RAIL",damage:95,fireRate:.55,projectileSpeed:0,splashRadius:0,ammo:8,heatPerShot:0,selfDamageScale:0,color:16722902,trailColor:16738030},laser:{id:"laser",name:"LASER",damage:9,fireRate:14,projectileSpeed:0,splashRadius:0,ammo:80,heatPerShot:0,selfDamageScale:0,color:3800968,trailColor:8978346},torpedo:{id:"torpedo",name:"TORPEDO",damage:110,fireRate:.45,projectileSpeed:55,splashRadius:22,ammo:4,heatPerShot:0,selfDamageScale:.7,color:16724753,trailColor:16746564},scatter:{id:"scatter",name:"SCATTER",damage:11,fireRate:2.2,projectileSpeed:160,splashRadius:0,ammo:24,heatPerShot:0,selfDamageScale:0,color:16770406,trailColor:16773290}},de={maxSpeed:95,afterburnerMax:155,accel:55,strafeAccel:42,verticalAccel:48,drag:1.8,afterburnerDrag:.9,mouseYaw:1.8,mousePitch:1.5,energyMax:100,energyDrain:28,energyRegen:12,fovNormal:70,fovBoost:88,collisionDamage:25,bounceRestitution:.45},fe={maxHealth:100,maxShield:100,shieldRegenDelay:3.2,shieldRegenRate:18,shieldDeployCost:100,shieldDeployDuration:3.5,shieldAbsorb:1,respawnDelay:2.5,hitMarkerMs:120,enemyHitRadius:2.85,enemyHitscanRadius:2.7,localHitRadius:2.35,projectileHitRadius:.55,aimAssist:.032,aimAssistRange:110,aimAssistCone:.12},Us={acquireSec:1.15,decaySec:.45,maxRange:165,coneDot:.92},Ra={"sky-city":{id:"sky-city",name:"SKY CITY",bounds:840,minAlt:8,maxAlt:220,fogColor:3803720,fogDensity:9e-4,ambient:3809888,sunColor:16742212,sunIntensity:1.35,skyTop:1311784,skyBottom:16726664,style:"open",hasGround:!0,spawnPoints:[[0,40,80],[60,50,-40],[-70,45,30],[40,60,100],[-50,55,-90],[100,40,20],[-90,70,60],[20,35,-120]]},"the-pit":{id:"the-pit",name:"THE PIT",bounds:400,minAlt:6,maxAlt:140,fogColor:2756672,fogDensity:.0018,ambient:2232627,sunColor:11167487,sunIntensity:.9,skyTop:656408,skyBottom:6689092,style:"pit",hasGround:!0,spawnPoints:[[0,30,40],[35,25,-30],[-40,35,10],[20,50,-50],[-25,40,55],[50,28,20]]},"cloud-sea":{id:"cloud-sea",name:"CLOUD SEA",bounds:960,minAlt:20,maxAlt:200,fogColor:9090264,fogDensity:.001,ambient:8956620,sunColor:16773320,sunIntensity:1.8,skyTop:5937872,skyBottom:15266047,style:"clouds",hasGround:!0,spawnPoints:[[0,70,60],[80,85,-50],[-90,75,40],[40,95,100],[-60,80,-80]]},"upper-atmo":{id:"upper-atmo",name:"UPPER ATMO",bounds:1e3,minAlt:10,maxAlt:280,fogColor:661560,fogDensity:4e-4,ambient:3359846,sunColor:16771276,sunIntensity:1.35,skyTop:132368,skyBottom:1720448,style:"atmo",hasGround:!1,spawnPoints:[[0,80,50],[100,100,-40],[-80,90,70],[50,120,-90]]},"deep-space":{id:"deep-space",name:"DEEP SPACE",bounds:1040,minAlt:-180,maxAlt:220,fogColor:328976,fogDensity:22e-5,ambient:1116194,sunColor:8939263,sunIntensity:.55,skyTop:131592,skyBottom:656408,style:"space",hasGround:!1,spawnPoints:[[0,20,40],[70,-20,-50],[-60,40,30],[30,10,-80]]}},tn={rounds:4,targetsPerRound:[3,4,5,6],roundTime:90,lives:3,killScore:100,timeBonusPerSec:2},$s={botCount:6,matchTime:300,ffa:!0},sc={rivalCount:5},In={collectRadius:5.5,mapCount:24,respawnSec:20,rocketPickupAmmo:2};class Bm{constructor(t){T(this,"keys",new Set);T(this,"mouseDX",0);T(this,"mouseDY",0);T(this,"mouseButtons",new Set);T(this,"wheel",0);T(this,"pointerLocked",!1);T(this,"engaged",!1);T(this,"lockError",null);T(this,"canvas");T(this,"lockRequestInFlight",!1);T(this,"onKeyDown",t=>{(t.code==="Tab"||t.code==="F3")&&t.preventDefault(),this.keys.add(t.code)});T(this,"onKeyUp",t=>{this.keys.delete(t.code)});T(this,"onLockChange",()=>{const t=document.pointerLockElement===this.canvas,e=this.pointerLocked;this.pointerLocked=t,this.lockRequestInFlight=!1,t?(this.engaged=!0,this.lockError=null):e&&(this.engaged=!1)});T(this,"onLockError",()=>{this.lockRequestInFlight=!1,this.lockError="Pointer lock denied — free-mouse mode (look still works)",console.warn("[NEON VEIL] pointerlockerror — continuing without lock")});T(this,"onMouseDown",t=>{this.mouseButtons.add(t.button),this.engaged&&!this.pointerLocked&&this.requestLock()});T(this,"onMouseUp",t=>{this.mouseButtons.delete(t.button)});T(this,"onMouseMove",t=>{this.engaged&&(this.mouseDX+=t.movementX,this.mouseDY+=t.movementY)});T(this,"onWheel",t=>{this.wheel+=Math.sign(t.deltaY)});this.canvas=t,window.addEventListener("keydown",this.onKeyDown),window.addEventListener("keyup",this.onKeyUp),document.addEventListener("pointerlockchange",this.onLockChange),document.addEventListener("pointerlockerror",this.onLockError),t.addEventListener("mousedown",this.onMouseDown),window.addEventListener("mouseup",this.onMouseUp),window.addEventListener("mousemove",this.onMouseMove),t.addEventListener("wheel",this.onWheel,{passive:!0}),t.addEventListener("contextmenu",e=>e.preventDefault())}dispose(){window.removeEventListener("keydown",this.onKeyDown),window.removeEventListener("keyup",this.onKeyUp),document.removeEventListener("pointerlockchange",this.onLockChange),document.removeEventListener("pointerlockerror",this.onLockError),this.canvas.removeEventListener("mousedown",this.onMouseDown),window.removeEventListener("mouseup",this.onMouseUp),window.removeEventListener("mousemove",this.onMouseMove),this.canvas.removeEventListener("wheel",this.onWheel)}engage(){this.engaged=!0,this.requestLock()}disengage(){this.engaged=!1,this.releaseLock()}requestLock(){if(document.pointerLockElement!==this.canvas&&!this.lockRequestInFlight){if(typeof this.canvas.requestPointerLock!="function"){this.lockError="Pointer lock not supported — free-mouse mode";return}this.lockRequestInFlight=!0;try{const t=this.canvas.requestPointerLock();t&&typeof t.then=="function"?t.then(()=>{this.lockRequestInFlight=!1,this.lockError=null}).catch(e=>{this.lockRequestInFlight=!1;const n=e instanceof Error?e.message:"Pointer lock denied";this.lockError=`${n} — free-mouse mode (look still works)`,console.warn("[NEON VEIL] pointer lock failed, using free-mouse",e)}):window.setTimeout(()=>{this.lockRequestInFlight=!1,document.pointerLockElement!==this.canvas&&(this.lockError="Pointer lock unavailable — free-mouse mode")},120)}catch(t){this.lockRequestInFlight=!1,this.lockError="Pointer lock error — free-mouse mode",console.warn("[NEON VEIL] requestPointerLock threw",t)}}}releaseLock(){if(document.pointerLockElement===this.canvas)try{document.exitPointerLock()}catch{}}endFrame(){this.mouseDX=0,this.mouseDY=0,this.wheel=0}isDown(t){return this.keys.has(t)}isMouseDown(t){return this.mouseButtons.has(t)}isControlActive(){return this.engaged}}const km={"sky-city":"music/biome-sky-city.mp3","the-pit":"music/biome-the-pit.mp3","cloud-sea":"music/biome-cloud-sea.mp3","upper-atmo":"music/biome-upper-atmo.mp3","deep-space":"music/biome-deep-space.mp3"},fl="music/biome-sky-city.mp3";class zm{constructor(t){T(this,"ctx",null);T(this,"master",null);T(this,"sfx",null);T(this,"musicGain",null);T(this,"engineOsc",null);T(this,"engineGain",null);T(this,"engineFilter",null);T(this,"boostNoise",null);T(this,"boostGain",null);T(this,"settings");T(this,"unlocked",!1);T(this,"lastBoost",!1);T(this,"musicEl",null);T(this,"musicStarted",!1);T(this,"currentBiome",null);T(this,"musicWired",!1);this.settings=t}async unlock(){if(this.unlocked)return;const t=window.AudioContext||window.webkitAudioContext;this.ctx=new t,this.master=this.ctx.createGain(),this.master.gain.value=this.settings.mute?0:this.settings.volume,this.master.connect(this.ctx.destination),this.sfx=this.ctx.createGain(),this.sfx.gain.value=.9,this.sfx.connect(this.master),this.musicGain=this.ctx.createGain(),this.musicGain.gain.value=this.settings.mute?0:.28,this.musicGain.connect(this.master),this.ctx.state==="suspended"&&await this.ctx.resume(),this.startEngine(),this.unlocked=!0;try{window.__AUDIO_CTX__=this.ctx}catch{}this.setBiomeMusic(this.currentBiome&&this.currentBiome!=="menu"?this.currentBiome:"sky-city")}applySettings(t){this.settings=t,this.master&&(this.master.gain.value=t.mute?0:t.volume),this.musicGain&&(this.musicGain.gain.value=t.mute?0:.28),this.musicEl&&(this.musicWired||(this.musicEl.volume=t.mute?0:.32*t.volume),t.mute?this.musicEl.pause():this.musicStarted&&this.musicEl.play().catch(()=>{}))}setBiomeMusic(t){if(this.currentBiome=t,!this.unlocked||this.settings.mute)return;const e=t==="menu"?fl:km[t]||fl;if(this.ensureMusicEl(),!!this.musicEl){if(this.musicStarted&&this.musicEl.src.includes(e.replace("music/",""))){this.musicEl.play().catch(()=>{});return}this.musicEl.loop=!0,this.musicEl.src=e,this.musicEl.play().catch(n=>{console.warn("[NEON VEIL] biome music failed",e,n)}),this.musicStarted=!0}}ensureMusicEl(){if(!this.musicEl&&(this.musicEl=new Audio,this.musicEl.preload="auto",this.musicEl.loop=!0,this.musicEl.volume=.32*this.settings.volume,this.ctx&&this.musicGain&&!this.musicWired))try{this.ctx.createMediaElementSource(this.musicEl).connect(this.musicGain),this.musicEl.volume=1,this.musicGain.gain.value=.28,this.musicWired=!0}catch{}}async startMusic(){this.setBiomeMusic(this.currentBiome&&this.currentBiome!=="menu"?this.currentBiome:"sky-city")}stopMusic(){this.musicEl&&(this.musicEl.pause(),this.musicStarted=!1)}setEngineThrust(t,e){if(!this.engineGain||!this.engineOsc||!this.ctx||!this.engineFilter)return;const n=this.ctx.currentTime,i=.018+t*.07;this.engineGain.gain.setTargetAtTime(i*(e?1.7:1),n,.05),this.engineOsc.frequency.setTargetAtTime(48+t*55+(e?40:0),n,.08),this.engineFilter.frequency.setTargetAtTime(220+t*400+(e?500:0),n,.08),e&&!this.lastBoost?(this.playBoost(),this.startBoostLoop()):!e&&this.lastBoost&&this.stopBoostLoop(),this.lastBoost=e}playUI(){this.beep(880,.05,"square",.04),this.beep(1320,.04,"sine",.025)}playPlasma(){this.noiseBurst(.05,.06,2200,.06),this.beep(380,.06,"sawtooth",.055),this.beep(760,.04,"square",.03),this.slide(500,180,.08,"sawtooth",.04)}playRocket(){this.noiseBurst(.22,.14,350,.18),this.slide(90,40,.25,"sawtooth",.1),this.beep(55,.15,"sine",.06)}playRail(){this.noiseBurst(.08,.08,4e3,.06),this.beep(1600,.1,"square",.07),this.beep(2400,.07,"sine",.05),this.slide(2800,400,.12,"sawtooth",.04)}playLaser(){this.beep(1900,.035,"square",.04),this.beep(2600,.03,"sine",.03),this.noiseBurst(.03,.03,5e3,.03)}playScatter(){this.noiseBurst(.09,.09,1600,.08),this.beep(280,.05,"sawtooth",.05),this.beep(420,.04,"square",.03)}playPickup(){this.beep(660,.05,"sine",.05),this.beep(990,.07,"sine",.045),this.beep(1320,.09,"sine",.035),this.beep(1760,.06,"triangle",.025)}playLockTick(t=.5){const e=620+t*900;this.beep(e,.045,"square",.04+t*.02)}playLockTone(){this.beep(1400,.08,"square",.06),this.beep(1800,.1,"sine",.05),this.beep(2200,.06,"triangle",.03)}playLockLost(){this.beep(400,.08,"sawtooth",.04),this.slide(500,180,.12,"square",.03)}playExplosion(){this.noiseBurst(.4,.28,180,.35),this.noiseBurst(.15,.12,800,.12),this.beep(70,.2,"sine",.08),this.slide(120,30,.25,"sawtooth",.06)}playHitConfirm(){this.beep(880,.04,"square",.05),this.beep(1320,.05,"sine",.04),this.noiseBurst(.03,.04,3e3,.03)}playHit(){this.noiseBurst(.1,.1,600,.09),this.beep(180,.08,"square",.07),this.beep(90,.1,"sawtooth",.05)}playCrit(){this.beep(1200,.06,"square",.06),this.beep(1800,.08,"sine",.05),this.beep(2400,.1,"triangle",.04),this.noiseBurst(.06,.06,2500,.05)}playShieldHit(){this.beep(520,.05,"triangle",.05),this.beep(780,.07,"sine",.04),this.noiseBurst(.05,.04,1800,.04)}playShieldUp(){this.slide(400,900,.18,"sine",.06),this.beep(900,.15,"triangle",.04)}playShieldDown(){this.slide(700,200,.15,"sine",.05),this.noiseBurst(.08,.05,500,.08)}playBoost(){this.noiseBurst(.12,.1,1100,.1),this.slide(200,500,.12,"sawtooth",.05)}playDeath(){this.slide(200,40,.45,"sawtooth",.1),this.noiseBurst(.5,.3,140,.4),this.beep(60,.35,"sine",.08)}playWarp(){this.slide(200,1400,.35,"sine",.07),this.noiseBurst(.25,.12,900,.2),this.beep(1100,.12,"triangle",.04)}playKill(){this.beep(660,.06,"square",.05),this.beep(990,.08,"sine",.05),this.beep(1480,.12,"triangle",.04)}startBoostLoop(){if(!this.ctx||!this.sfx||this.boostGain)return;const t=this.ctx.currentTime,e=this.ctx.createGain();e.gain.setValueAtTime(1e-4,t),e.gain.exponentialRampToValueAtTime(.05,t+.08),e.connect(this.sfx);const n=Math.floor(this.ctx.sampleRate*.4),i=this.ctx.createBuffer(1,n,this.ctx.sampleRate),r=i.getChannelData(0);for(let l=0;l<n;l++)r[l]=(Math.random()*2-1)*.6;const a=this.ctx.createBufferSource();a.buffer=i,a.loop=!0;const o=this.ctx.createBiquadFilter();o.type="bandpass",o.frequency.value=900,o.Q.value=.7,a.connect(o),o.connect(e),a.start(),this.boostNoise=a,this.boostGain=e}stopBoostLoop(){if(!this.ctx||!this.boostGain||!this.boostNoise)return;const t=this.ctx.currentTime;try{this.boostGain.gain.cancelScheduledValues(t),this.boostGain.gain.setValueAtTime(Math.max(1e-4,this.boostGain.gain.value),t),this.boostGain.gain.exponentialRampToValueAtTime(1e-4,t+.12)}catch{}const e=this.boostNoise,n=this.boostGain;this.boostNoise=null,this.boostGain=null,window.setTimeout(()=>{try{e.stop(),e.disconnect(),n.disconnect()}catch{}},150)}startEngine(){!this.ctx||!this.master||(this.engineOsc=this.ctx.createOscillator(),this.engineOsc.type="sawtooth",this.engineOsc.frequency.value=55,this.engineFilter=this.ctx.createBiquadFilter(),this.engineFilter.type="lowpass",this.engineFilter.frequency.value=260,this.engineGain=this.ctx.createGain(),this.engineGain.gain.value=.025,this.engineOsc.connect(this.engineFilter),this.engineFilter.connect(this.engineGain),this.engineGain.connect(this.master),this.engineOsc.start())}dest(){return this.sfx??this.master}beep(t,e,n,i){if(!this.ctx||!this.dest()||this.settings.mute)return;const r=this.ctx.currentTime,a=this.ctx.createOscillator(),o=this.ctx.createGain();a.type=n,a.frequency.value=t,o.gain.setValueAtTime(i,r),o.gain.exponentialRampToValueAtTime(.001,r+e),a.connect(o),o.connect(this.dest()),a.start(r),a.stop(r+e+.02)}slide(t,e,n,i,r){if(!this.ctx||!this.dest()||this.settings.mute)return;const a=this.ctx.currentTime,o=this.ctx.createOscillator(),l=this.ctx.createGain();o.type=i,o.frequency.setValueAtTime(t,a),o.frequency.exponentialRampToValueAtTime(Math.max(20,e),a+n),l.gain.setValueAtTime(r,a),l.gain.exponentialRampToValueAtTime(.001,a+n),o.connect(l),l.connect(this.dest()),o.start(a),o.stop(a+n+.02)}noiseBurst(t,e,n,i){if(!this.ctx||!this.dest()||this.settings.mute)return;const r=this.ctx.currentTime,a=Math.floor(this.ctx.sampleRate*t),o=this.ctx.createBuffer(1,a,this.ctx.sampleRate),l=o.getChannelData(0);for(let f=0;f<a;f++)l[f]=(Math.random()*2-1)*(1-f/a);const c=this.ctx.createBufferSource();c.buffer=o;const h=this.ctx.createBiquadFilter();h.type="lowpass",h.frequency.value=n;const u=this.ctx.createGain();u.gain.setValueAtTime(e,r),u.gain.exponentialRampToValueAtTime(.001,r+i),c.connect(h),h.connect(u),u.connect(this.dest()),c.start(r)}}new C(1,0,0);const Hm=new C(0,1,0);new C(0,0,-1);const pl=qt.degToRad(82),Ur=qt.degToRad(28),Vm=.16;class Gm{constructor(){T(this,"position",new C(0,40,0));T(this,"velocity",new C);T(this,"quaternion",new ln);T(this,"euler",new ze(0,0,0,"YXZ"));T(this,"energy",de.energyMax);T(this,"boosting",!1);T(this,"speed",0);T(this,"lookBack",!1);T(this,"zooming",!1);T(this,"stunTimer",0);T(this,"forward",new C);T(this,"right",new C);T(this,"up",new C);T(this,"tmp",new C);T(this,"qDelta",new ln);T(this,"lookBackFlip",new ln().setFromAxisAngle(Hm,Math.PI))}update(t,e,n,i,r,a,o=0){this.stunTimer=Math.max(0,this.stunTimer-t);const l=this.stunTimer>0,c=n.mouseSens*.0022,h=n.invertY?-1:1;let u=0;if(e.isControlActive()&&!this.lookBack&&!l){const v=-e.mouseDX*c*de.mouseYaw,I=-e.mouseDY*c*de.mousePitch*h;let A=0;e.isDown("KeyQ")&&(A-=1),e.isDown("KeyE")&&(A+=1),A=qt.clamp(A+o,-1,1),this.euler.y+=v,this.euler.x=qt.clamp(this.euler.x+I,-pl,pl);const R=v/Math.max(t,1e-4);u=qt.clamp(-R*Vm+A*Ur,-Ur,Ur)}const f=1-Math.exp(-5*t);this.euler.z=qt.lerp(this.euler.z,u,f),this.quaternion.setFromEuler(this.euler),this.lookBack=!l&&e.isDown("KeyC"),this.zooming=!l&&e.isMouseDown(1);const p=!l&&(e.isMouseDown(2)||e.isDown("KeyB"));this.boosting=p&&this.energy>1,this.boosting?(this.energy=Math.max(0,this.energy-de.energyDrain*t),this.energy<=0&&(this.boosting=!1)):this.energy=Math.min(de.energyMax,this.energy+de.energyRegen*t),this.forward.set(0,0,-1).applyQuaternion(this.quaternion),this.right.set(1,0,0).applyQuaternion(this.quaternion),this.up.set(0,1,0).applyQuaternion(this.quaternion);let g=0,_=0,m=0;l||(e.isDown("KeyW")&&(g+=1),e.isDown("KeyS")&&(g-=.7),e.isDown("KeyD")&&(_+=1),e.isDown("KeyA")&&(_-=1),e.isDown("Space")&&(m+=1),(e.isDown("ShiftLeft")||e.isDown("ShiftRight"))&&(m-=1));const d=this.boosting?de.afterburnerMax:de.maxSpeed,S=this.boosting?de.afterburnerDrag:de.drag;this.tmp.copy(this.forward).multiplyScalar(g*de.accel*(this.boosting?1.6:1)),this.velocity.addScaledVector(this.tmp,t),this.tmp.copy(this.right).multiplyScalar(_*de.strafeAccel),this.velocity.addScaledVector(this.tmp,t),this.tmp.copy(this.up).multiplyScalar(m*de.verticalAccel),this.velocity.addScaledVector(this.tmp,t);const w=Math.exp(-S*t);this.velocity.multiplyScalar(w),this.speed=this.velocity.length(),this.speed>d&&(this.velocity.multiplyScalar(d/this.speed),this.speed=d),this.position.addScaledVector(this.velocity,t),this.clampWorld(i,r,a)}bounce(t,e=1){const n=this.velocity.dot(t);n<0?this.velocity.addScaledVector(t,-n*(1+de.bounceRestitution)):this.velocity.addScaledVector(t,Math.min(8,n*.15)),this.position.addScaledVector(t,.35);const i=this.velocity.length();return i>de.maxSpeed*.85&&this.velocity.multiplyScalar(de.maxSpeed*.85/i),this.speed=this.velocity.length(),Math.min(de.collisionDamage*e,Math.abs(n)*.85+2)}integrateSubstep(t){this.position.addScaledVector(this.velocity,t)}clampWorld(t,e,n){this.position.y=qt.clamp(this.position.y,t,e);const i=n*.95;this.position.x=qt.clamp(this.position.x,-i,i),this.position.z=qt.clamp(this.position.z,-i,i)}getAimDirection(t){return t.set(0,0,-1).applyQuaternion(this.quaternion)}getCameraQuaternion(t){return this.lookBack?t.copy(this.quaternion).multiply(this.lookBackFlip):t.copy(this.quaternion),t}reset(t,e=0){this.position.copy(t),this.velocity.set(0,0,0),this.euler.set(0,e,0),this.quaternion.setFromEuler(this.euler),this.energy=de.energyMax,this.boosting=!1,this.speed=0,this.stunTimer=0}applyStun(t){this.stunTimer=Math.max(this.stunTimer,t),this.boosting=!1,this.velocity.multiplyScalar(.35)}}class rc{constructor(t=61695,e=!1,n="interceptor"){T(this,"group",new Ae);T(this,"body");T(this,"shieldMesh");T(this,"hullType");T(this,"thrusterMats",[]);this.hullType=n,this.body=new Ae,this.group.add(this.body);const i=new ge({color:1708072,metalness:.7,roughness:.35,emissive:t,emissiveIntensity:.15}),r=new Et({color:t,transparent:!0,opacity:.95}),a=new ge({color:2245734,metalness:.2,roughness:.1,transparent:!0,opacity:.45,emissive:1127253,emissiveIntensity:.3});let o;switch(n){case"gunship":o=this.buildGunship(i,r,a);break;case"striker":o=this.buildStriker(i,r,a);break;case"interceptor":default:o=this.buildInterceptor(i,r,a);break}if(e){const l=new et(new zt(1.6,.12,1.2),new ge({color:1181724,metalness:.8,roughness:.3,emissive:t,emissiveIntensity:.2}));l.position.set(0,-.55,-.9),this.group.add(l);const c=new et(new zt(1.8,.08,.5),new Et({color:43724}));c.position.set(0,-.48,-.5),this.group.add(c),this.body.visible=!1,l.visible=!0,c.visible=!0}this.shieldMesh=new et(new Te(o,16,12),new Et({color:61695,transparent:!0,opacity:.18,wireframe:!0,depthWrite:!1})),this.shieldMesh.visible=!1,this.group.add(this.shieldMesh)}addThruster(t,e,n,i){const r=new Et({color:16737826});this.thrusterMats.push(r);const a=new et(t,r);a.rotation.x=Math.PI/2,a.position.set(e,n,i),this.body.add(a)}addCanopy(t,e,n,i,r,a,o,l=.55){const c=new et(new Te(l,8,6,0,Math.PI*2,0,Math.PI*.55),t);c.position.set(e,n,i),c.scale.set(r,a,o),this.body.add(c)}buildInterceptor(t,e,n){const i=new et(new zt(2.2,.55,3.4),t);i.position.y=-.15,this.body.add(i);const r=new et(new Nn(.55,1.4,6),t);r.rotation.x=-Math.PI/2,r.position.set(0,-.1,-2.1),this.body.add(r),this.addCanopy(n,0,.25,-.3,1.1,.7,1.4,.55);const a=new et(new zt(3.6,.08,1.1),t);a.position.set(0,-.2,.4),this.body.add(a);const o=new et(new zt(3.5,.04,.06),e);o.position.set(0,-.15,.4),this.body.add(o);const l=new ke(.18,.25,.4,8);return this.addThruster(l,-.55,-.1,1.7),this.addThruster(l,.55,-.1,1.7),2.4}buildGunship(t,e,n){const i=new et(new zt(2.9,.8,3.2),t);i.position.y=-.1,this.body.add(i);const r=new et(new zt(1.5,.5,2.2),t);r.position.set(0,.35,.2),this.body.add(r);const a=new et(new Nn(.85,1,6),t);a.rotation.x=-Math.PI/2,a.position.set(0,-.05,-1.9),this.body.add(a);const o=new ke(.12,.12,2,6);for(const u of[-.95,.95]){const f=new et(o,t);f.rotation.x=Math.PI/2,f.position.set(u,-.15,-1.6),this.body.add(f);const p=new et(new zt(.26,.26,.12),e);p.position.set(u,-.15,-2.6),this.body.add(p)}this.addCanopy(n,0,.6,-.35,1.2,.75,1.3,.6);const l=new et(new zt(3.4,.18,1.5),t);l.position.set(0,-.2,.55),this.body.add(l);for(const u of[-1.5,1.5]){const f=new et(new zt(.5,.4,1.6),t);f.position.set(u,-.15,.6),this.body.add(f)}const c=new et(new zt(3.3,.05,.08),e);c.position.set(0,-.1,0),this.body.add(c);const h=new ke(.24,.32,.55,8);for(const u of[-1.5,-.55,.55,1.5])this.addThruster(h,u,-.1,1.75);return 2.9}buildStriker(t,e,n){const i=new et(new zt(1.5,.42,3.8),t);i.position.y=-.1,this.body.add(i);const r=new et(new Nn(.4,2,6),t);r.rotation.x=-Math.PI/2,r.position.set(0,-.08,-2.7),this.body.add(r);for(const o of[-.8,.8]){const l=new et(new zt(1,.05,.5),t);l.position.set(o,-.05,-1.4),l.rotation.y=o<0?.35:-.35,this.body.add(l)}this.addCanopy(n,0,.18,-.7,.85,.6,1.7,.48);for(const o of[-1,1]){const l=new et(new zt(2.1,.06,1),t);l.position.set(o*1.15,-.12,.2),l.rotation.y=o*-.5,l.rotation.z=o*.18,this.body.add(l);const c=new et(new zt(2,.05,.06),e);c.position.set(o*1.15,-.09,-.15),c.rotation.y=o*-.5,c.rotation.z=o*.18,this.body.add(c)}const a=new ke(.16,.22,.45,8);return this.addThruster(a,-.35,-.08,1.95),this.addThruster(a,.35,-.08,1.95),2.6}setTransform(t,e){this.group.position.copy(t),this.group.quaternion.copy(e)}setBoost(t){for(const e of this.thrusterMats)e.color.setHSL(.08,1,.4+t*.4)}setShield(t){if(this.shieldMesh.visible=t,t){const e=this.shieldMesh.material;e.opacity=.22+Math.sin(performance.now()*.01)*.05}}setColor(t){this.body.traverse(e=>{if(e.isMesh){const n=e.material;n.emissive&&n.emissive.setHex(t)}})}dispose(){this.group.traverse(t=>{const e=t;if(e.geometry&&e.geometry.dispose(),e.material){const n=e.material;Array.isArray(n)?n.forEach(i=>i.dispose()):n.dispose()}})}}const Wm=["plasma","rocket","rail","laser","torpedo","scatter"];class Xm{constructor(t){T(this,"current","plasma");T(this,"unlocked",new Set(["plasma"]));T(this,"ammo",{plasma:-1,rocket:Fe.rocket.ammo,rail:Fe.rail.ammo,laser:0,torpedo:0,scatter:0});T(this,"cooldown",0);T(this,"order",["plasma","rocket","rail","laser","torpedo","scatter"]);T(this,"pool",[]);T(this,"scene");T(this,"trailGroup");T(this,"railBeams",[]);T(this,"muzzleFlash",new Xa(61695,0,12));this.scene=t,this.trailGroup=new Ae,t.add(this.trailGroup),t.add(this.muzzleFlash);for(let e=0;e<64;e++){const n=new Et({color:61695,transparent:!0,opacity:.95}),i=new et(new Te(.25,6,6),n);i.visible=!1,this.trailGroup.add(i),this.pool.push({active:!1,position:new C,velocity:new C,weapon:"plasma",ownerId:"",life:0,damage:0,splash:0,mesh:i,selfDamageScale:0,targetId:null,homing:0,maxSpeed:220})}}get def(){return Fe[this.current]}select(t){t!=="plasma"&&!this.unlocked.has(t)&&this.ammo[t]<=0||(this.current=t)}unlock(t){this.unlocked.add(t)}grantWeapon(t,e){if(this.unlock(t),this.ammo[t]<0)return;const n=Math.max(Fe[t].ammo*2,e);this.ammo[t]=Math.min(n,Math.max(0,this.ammo[t])+e),this.current=t}grantAmmoAll(t=.5){for(const e of Wm){if(e==="plasma"||!this.unlocked.has(e)&&this.ammo[e]<=0)continue;const n=Fe[e].ammo;n<0||(this.ammo[e]=Math.min(n*2,this.ammo[e]+Math.ceil(n*t)))}}cycle(t){const e=this.order.filter(r=>r==="plasma"||this.unlocked.has(r)||this.ammo[r]>0);if(e.length===0)return;const n=e.indexOf(this.current),i=(Math.max(0,n)+t+e.length)%e.length;this.current=e[i]}trySelectSlot(t){if(t>=1&&t<=this.order.length){const e=this.order[t-1];(e==="plasma"||this.unlocked.has(e)||this.ammo[e]>0)&&(this.current=e)}}update(t,e=[]){this.cooldown>0&&(this.cooldown-=t),this.muzzleFlash.intensity=Math.max(0,this.muzzleFlash.intensity-t*40);const n=new C;for(const i of this.pool)if(i.active){if(i.life-=t,i.homing>0&&i.targetId){const r=e.find(a=>a.id===i.targetId&&a.alive);if(r){n.copy(r.position).sub(i.position).normalize();const a=Math.max(i.maxSpeed*.55,i.velocity.length()),o=i.homing*t;i.velocity.lerp(n.multiplyScalar(a),Math.min(1,o));const l=i.velocity.length();l>i.maxSpeed?i.velocity.multiplyScalar(i.maxSpeed/l):l<i.maxSpeed*.7&&i.velocity.multiplyScalar(i.maxSpeed*.85/Math.max(l,.001))}else i.homing=0,i.targetId=null}i.weapon==="torpedo"&&i.homing<=0&&(i.velocity.y-=4*t),i.position.addScaledVector(i.velocity,t),i.mesh.position.copy(i.position),i.homing>0&&i.velocity.lengthSq()>1&&i.mesh.lookAt(i.position.x+i.velocity.x,i.position.y+i.velocity.y,i.position.z+i.velocity.z),i.life<=0&&this.deactivate(i)}for(let i=this.railBeams.length-1;i>=0;i--){const r=this.railBeams[i];r.life-=t;const a=r.line.material;a.opacity=Math.max(0,r.life*5),r.life<=0&&(this.scene.remove(r.line),r.line.geometry.dispose(),a.dispose(),this.railBeams.splice(i,1))}}canFire(){if(this.cooldown>0)return!1;const t=this.ammo[this.current];return t===-1||t>0}fire(t,e,n,i){if(!this.canFire())return null;const r=this.def;if(r.id==="rocket"&&i?.requireLock!==!1&&!i?.lockTargetId)return null;if(this.cooldown=1/r.fireRate,this.ammo[this.current]>0&&this.ammo[this.current]--,this.muzzleFlash.color.setHex(r.color),this.muzzleFlash.intensity=r.id==="laser"?5:8,this.muzzleFlash.position.copy(e),r.projectileSpeed<=0){const l=r.id==="laser"?280:400,c=e.clone().addScaledVector(n,l);return this.spawnRailBeam(e,c,r.trailColor,r.id==="laser"?.08:.25),{hitscan:[{weapon:r.id,ownerId:t,origin:e.clone(),direction:n.clone(),damage:r.damage,end:c}]}}if(r.id==="scatter"){const l=[];for(let c=0;c<5;c++){const h=n.clone();h.x+=(Math.random()-.5)*.18,h.y+=(Math.random()-.5)*.14,h.z+=(Math.random()-.5)*.18,h.normalize();const u=this.spawnProjectile(t,e,h,r,null);u&&l.push(u)}return l.length?{projectiles:l}:null}const a=i?.lockTargetId??null,o=this.spawnProjectile(t,e,n,r,a);return o?{projectiles:[o]}:null}spawnProjectile(t,e,n,i,r){const a=this.pool.find(l=>!l.active);if(!a)return null;a.active=!0,a.position.copy(e),a.velocity.copy(n).multiplyScalar(i.projectileSpeed),a.weapon=i.id,a.ownerId=t,a.life=i.id==="torpedo"?7:i.id==="rocket"?5.5:i.id==="scatter"?1.5:2.4,a.damage=i.damage,a.splash=i.splashRadius,a.selfDamageScale=i.selfDamageScale,a.targetId=r,a.maxSpeed=i.projectileSpeed*(i.id==="rocket"?1.15:1),i.id==="rocket"&&r?a.homing=3.6:i.id==="torpedo"&&r?a.homing=1.35:a.homing=0,a.mesh.visible=!0;const o=i.id==="torpedo"?1.9:i.id==="rocket"?1.55:i.id==="scatter"?.6:.9;return a.mesh.scale.setScalar(o),a.mesh.material.color.setHex(i.color),a.mesh.position.copy(a.position),a}deactivate(t){t.active=!1,t.mesh.visible=!1,t.targetId=null,t.homing=0}spawnRailBeam(t,e,n,i=.25){const r=new ve().setFromPoints([t.clone(),e.clone()]),a=new nc({color:n,transparent:!0,opacity:1,linewidth:2}),o=new Lm(r,a);this.scene.add(o),this.railBeams.push({line:o,life:i})}refill(){this.ammo.plasma=-1,this.ammo.rocket=Fe.rocket.ammo,this.ammo.rail=Fe.rail.ammo,this.ammo.laser=this.unlocked.has("laser")?Fe.laser.ammo:0,this.ammo.torpedo=this.unlocked.has("torpedo")?Fe.torpedo.ammo:0,this.ammo.scatter=this.unlocked.has("scatter")?Fe.scatter.ammo:0,this.cooldown=0}dispose(){for(const t of this.pool)t.mesh.geometry.dispose(),t.mesh.material.dispose();this.scene.remove(this.trailGroup),this.scene.remove(this.muzzleFlash)}}class qm{constructor(){T(this,"phase","off");T(this,"progress",0);T(this,"targetId",null);T(this,"targetPos",new C);T(this,"beepTimer",0);T(this,"wasLocked",!1)}get locked(){return this.phase==="locked"&&!!this.targetId}reset(){this.phase="off",this.progress=0,this.targetId=null,this.beepTimer=0,this.wasLocked=!1}update(t,e,n,i,r,a){if(!e){const h=this.progress>.05||this.wasLocked;return this.reset(),h?"lost":null}const o=this.pickTarget(n,i,r,a);let l=null;if(!o)return this.progress>0||this.phase==="locked"?(this.progress=Math.max(0,this.progress-t/Us.decaySec),this.progress<=.001?((this.wasLocked||this.phase!=="off")&&(l="lost"),this.phase="off",this.targetId=null,this.wasLocked=!1,this.progress=0):this.phase="locking"):(this.phase="seeking",this.targetId=null),l;if(this.targetId&&this.targetId!==o.id&&(this.progress=0,this.wasLocked=!1,l="lost"),this.targetId=o.id,this.targetPos.copy(o.position),this.progress>=1)return this.phase="locked",this.progress=1,this.wasLocked?(this.beepTimer-=t,this.beepTimer<=0&&(this.beepTimer=.22,l="tick")):(this.wasLocked=!0,l="locked"),l;this.phase="locking",this.progress=Math.min(1,this.progress+t/Us.acquireSec),this.beepTimer-=t;const c=.55-this.progress*.4;return this.beepTimer<=0&&(this.beepTimer=Math.max(.12,c),l="tick"),this.progress>=1&&(this.phase="locked",this.wasLocked=!0,l="locked"),l}pickTarget(t,e,n,i){let r=null,a=-1/0;const o=new C;for(const l of n){if(!l.alive)continue;o.copy(l.position).sub(t);const c=o.length();if(c<8||c>Us.maxRange)continue;o.multiplyScalar(1/c);const h=e.dot(o);if(h<Us.coneDot||!i(t,l.position))continue;const u=h*3-c*.01+(l.id===this.targetId?.4:0);u>a&&(a=u,r=l)}return r}}class Ym{constructor(){T(this,"charge",fe.maxShield);T(this,"deployed",!1);T(this,"deployTimer",0);T(this,"timeSinceDamage",999)}get fullyCharged(){return this.charge>=fe.maxShield-.5&&!this.deployed}update(t,e){return this.deployed?(this.deployTimer-=t,this.deployTimer<=0?(this.deployed=!1,this.charge=0,"down"):null):e&&this.fullyCharged?(this.deployed=!0,this.deployTimer=fe.shieldDeployDuration,"up"):(this.timeSinceDamage+=t,this.timeSinceDamage>=fe.shieldRegenDelay&&(this.charge=Math.min(fe.maxShield,this.charge+fe.shieldRegenRate*t)),null)}absorb(t){if(this.timeSinceDamage=0,this.deployed)return t*(1-fe.shieldAbsorb*.85);if(this.charge>0){const e=Math.min(this.charge,t);return this.charge-=e,t-e}return t}reset(){this.charge=fe.maxShield,this.deployed=!1,this.deployTimer=0,this.timeSinceDamage=999}}class $m{constructor(){T(this,"group",new Ae);T(this,"colliders",[]);T(this,"buildingCount",0);T(this,"groundCollide",!0);T(this,"ground",null);T(this,"spatial",new Map);T(this,"spatialCell",40)}build(t){switch(this.clear(),this.groundCollide=t.hasGround!==!1&&t.style!=="space"&&t.style!=="atmo",t.style){case"pit":this.buildPit(t);break;case"clouds":this.buildCloudSea(t);break;case"atmo":this.buildUpperAtmo(t);break;case"space":this.buildDeepSpace(t);break;default:this.buildSkyCity(t);break}this.rebuildSpatial()}buildSkyCity(t){const e=t.bounds;this.addCityFloor(e),this.addSunset(t),this.addMountains(e,24);const n=15,i=Math.floor(e/n),r=[];for(let I=-i;I<=i;I++)for(let A=-i;A<=i;A++){if(I===0||A===0||Math.abs(I)%5===0||Math.abs(A)%5===0||Math.abs(I)<2&&Math.abs(A)<2)continue;const R=At(I,A),L=Math.hypot(I,A)/i,E=L>.85?.28:L>.55?.12:.04;R<E||r.push({gx:I,gz:A,roll:R})}const a=520;r.sort((I,A)=>I.roll-A.roll);const o=r.length>a?r.slice(0,a):r,l=new zt(1,1,1),c=new ge({color:1708080,metalness:.45,roughness:.62,emissive:2228275,emissiveIntensity:.28}),h=new Ne(l,c,o.length);h.castShadow=!1,h.receiveShadow=!0,h.frustumCulled=!0;const u=new zt(1.02,.07,1.02),f=new Et({color:16777215,toneMapped:!1}),p=new Ne(u,f,o.length*2);p.frustumCulled=!0;const g=new zt(1.01,.35,1.01),_=new Et({color:61695,transparent:!0,opacity:.35,toneMapped:!1}),m=new Ne(g,_,o.length);m.frustumCulled=!0;const d=new Qt,S=[61695,16722902,16770406,3800968,16739115,11167487];let w=0,v=0;for(const{gx:I,gz:A,roll:R}of o){const L=(R-.5)*5,E=I*n+L,y=A*n+(At(A,I)-.5)*5,P=Math.hypot(I,A)/i,H=P<.35?50+R*40:P<.65?15:0,B=7+R*12+(1-P)*4,V=7+At(I+3,A)*12+(1-P)*4,q=18+R*70+H+(At(I,A+9)<.12?55:0);d.position.set(E,q/2,y),d.scale.set(B,q,V),d.rotation.set(0,0,0),d.updateMatrix(),h.setMatrixAt(v,d.matrix);const G=S[v%S.length];for(let J=0;J<2;J++){const W=q*(.3+J*.35);d.position.set(E,W,y),d.scale.set(B,1,V),d.updateMatrix(),p.setMatrixAt(w,d.matrix),p.setColorAt(w,new Ot(G)),w++}d.position.set(E,q*.55,y),d.scale.set(B,1,V),d.updateMatrix(),m.setMatrixAt(v,d.matrix),this.colliders.push(this.makeCollider(E,q/2,y,B/2,q/2,V/2)),v++}h.count=v,p.count=w,m.count=v,h.instanceMatrix.needsUpdate=!0,p.instanceMatrix.needsUpdate=!0,m.instanceMatrix.needsUpdate=!0,p.instanceColor&&(p.instanceColor.needsUpdate=!0),this.group.add(h),this.group.add(p),this.group.add(m),this.buildingCount=v,this.addPads(18,e*.42,28,95),this.addStreetLightsInstanced(e),this.addBillboards(o.length>80?40:20,e*.7)}buildPit(t){const e=t.bounds;this.addGround(e,787988);const n=48,i=55,r=new zt(1,1,1),a=new ge({color:1577e3,metalness:.5,roughness:.55,emissive:3346756,emissiveIntensity:.3}),o=new Ne(r,a,n+i),l=new Ne(new zt(1.05,.12,1.05),new Et({color:16722902,toneMapped:!1}),n),c=new Qt,h=e*.72;for(let p=0;p<n;p++){const g=p/n*Math.PI*2,_=Math.cos(g)*h,m=Math.sin(g)*h,d=50+At(p,1)*40,S=14+At(p,2)*10;c.position.set(_,d/2,m),c.scale.set(S,d,S),c.lookAt(0,d/2,0),c.updateMatrix(),o.setMatrixAt(p,c.matrix),c.position.set(_,d*.6,m),c.scale.set(S,1,S),c.updateMatrix(),l.setMatrixAt(p,c.matrix),this.colliders.push(this.makeCollider(_,d/2,m,S/2,d/2,S/2))}let u=0;for(let p=0;p<i*2&&u<i;p++){const g=At(p,7)*Math.PI*2,_=At(p,8)*h*.55,m=Math.cos(g)*_,d=Math.sin(g)*_;if(Math.hypot(m,d)<25)continue;const S=15+At(p,9)*45,w=6+At(p,10)*10;c.position.set(m,S/2,d),c.scale.set(w,S,w),c.rotation.set(0,0,0),c.updateMatrix(),o.setMatrixAt(n+u,c.matrix),this.colliders.push(this.makeCollider(m,S/2,d,w/2,S/2,w/2)),u++}o.count=n+u,l.count=n,o.instanceMatrix.needsUpdate=!0,l.instanceMatrix.needsUpdate=!0,this.group.add(o),this.group.add(l),this.buildingCount=n+u;const f=new et(new ke(22,24,3,12),new ge({color:2232627,emissive:61695,emissiveIntensity:.2,metalness:.6,roughness:.4}));f.position.y=1.5,this.group.add(f),this.colliders.push(this.makeCollider(0,1.5,0,22,1.5,22)),this.addPitFloor(e),this.addSunset(t)}buildCloudSea(t){const e=t.bounds;this.addCloudSeaFloor(e),this.addCloudLayer(e,40,8,22,12114168,.5);const n=180,i=new Te(1,8,6),r=new ge({color:14544639,emissive:4482730,emissiveIntensity:.35,transparent:!0,opacity:.72,roughness:1,metalness:0}),a=new Ne(i,r,n),o=new Qt;for(let f=0;f<n;f++){const p=At(f,1)*Math.PI*2,g=At(f,2)*e*.95,_=Math.cos(p)*g,m=Math.sin(p)*g,d=25+At(f,3)*90,S=8+At(f,4)*22;o.position.set(_,d,m),o.scale.set(S*1.6,S*.55,S*1.2),o.updateMatrix(),a.setMatrixAt(f,o.matrix)}a.instanceMatrix.needsUpdate=!0,this.group.add(a),this.addPads(28,e*.55,40,110);const l=40,c=new ke(.8,1.2,1,6),h=new Et({color:6745855,toneMapped:!1}),u=new Ne(c,h,l);for(let f=0;f<l;f++){const p=f/l*Math.PI*2,g=40+f%5*35,_=30+At(f,5)*50;o.position.set(Math.cos(p)*g,_/2,Math.sin(p)*g),o.scale.set(1,_,1),o.updateMatrix(),u.setMatrixAt(f,o.matrix),this.colliders.push(this.makeCollider(Math.cos(p)*g,_/2,Math.sin(p)*g,1.2,_/2,1.2))}u.instanceMatrix.needsUpdate=!0,this.group.add(u),this.buildingCount=n+l,this.addCloudLayer(e,70,40,100,16777215,.4),this.addSunset(t)}buildUpperAtmo(t){const e=t.bounds,n=new et(new Oe(e*1.35,64),new Et({color:1718896,transparent:!0,opacity:.22,side:he,fog:!1,depthWrite:!1}));n.rotation.x=-Math.PI/2,n.position.y=-35,this.group.add(n);const i=new et(new Oe(e*.85,48),new Et({color:4491468,transparent:!0,opacity:.12,side:he,fog:!1,depthWrite:!1}));i.rotation.x=-Math.PI/2,i.position.y=-28,this.group.add(i);const r=new Qn(e*.35,3,8,48),a=new ge({color:4478310,metalness:.7,roughness:.35,emissive:2241348,emissiveIntensity:.4}),o=new et(r,a);o.rotation.x=Math.PI/2,o.position.y=60,this.group.add(o);const l=70,c=new zt(1,1,1),h=new ge({color:3359846,metalness:.7,roughness:.35,emissive:1122884,emissiveIntensity:.4}),u=new Ne(c,h,l),f=new Ne(new zt(1.05,.1,1.05),new Et({color:8956671,toneMapped:!1}),l),p=new Qt;for(let g=0;g<l;g++){const _=At(g,1)*Math.PI*2,m=30+At(g,2)*e*.7,d=Math.cos(_)*m,S=Math.sin(_)*m,w=20+At(g,3)*140,v=4+At(g,4)*14,I=3+At(g,5)*10,A=4+At(g,6)*14;p.position.set(d,w,S),p.scale.set(v,I,A),p.rotation.set(At(g,7)*.4,At(g,8)*Math.PI,0),p.updateMatrix(),u.setMatrixAt(g,p.matrix),p.scale.set(v,1,A),p.updateMatrix(),f.setMatrixAt(g,p.matrix),this.colliders.push(this.makeCollider(d,w,S,v/2,I/2,A/2))}u.instanceMatrix.needsUpdate=!0,f.instanceMatrix.needsUpdate=!0,this.group.add(u),this.group.add(f),this.buildingCount=l,this.addPads(20,e*.55,40,140),this.addStarfield(1200,e*2.8,.55)}buildDeepSpace(t){const e=t.bounds;this.addStarfield(2200,e*3.2,1);const n=180,i=new Qs(1,0),r=new ge({color:5588070,metalness:.25,roughness:.85,emissive:1114146,emissiveIntensity:.15}),a=new Ne(i,r,n),o=new Qt;for(let c=0;c<n;c++){const h=At(c,1)*Math.PI*2,u=25+At(c,2)*e*.85,f=Math.cos(h)*u,p=Math.sin(h)*u,g=(At(c,3)-.5)*e*.6,_=2+At(c,4)*12;o.position.set(f,g,p),o.scale.set(_,_*(.6+At(c,5)*.8),_),o.rotation.set(At(c,6)*6,At(c,7)*6,At(c,8)*6),o.updateMatrix(),a.setMatrixAt(c,o.matrix),this.colliders.push(this.makeCollider(f,g,p,_,_,_))}a.instanceMatrix.needsUpdate=!0,this.group.add(a),this.buildingCount=n,this.addPads(14,e*.45,-50,90);const l=new et(new Qn(28,2.2,10,40),new Et({color:11167487,toneMapped:!1}));l.position.set(0,20,-80),this.group.add(l),this.colliders.push(this.makeCollider(0,20,-80,30,4,4))}addCloudLayer(t,e,n,i,r,a){const o=new Te(1,7,5),l=new ge({color:r,emissive:r,emissiveIntensity:.15,transparent:!0,opacity:a,roughness:1,metalness:0,depthWrite:!1}),c=new Ne(o,l,e),h=new Qt;for(let u=0;u<e;u++){const f=At(u,50)*Math.PI*2,p=At(u,51)*t*.9;h.position.set(Math.cos(f)*p,n+At(u,52)*(i-n),Math.sin(f)*p);const g=10+At(u,53)*28;h.scale.set(g*1.8,g*.45,g*1.4),h.updateMatrix(),c.setMatrixAt(u,h.matrix)}c.instanceMatrix.needsUpdate=!0,this.group.add(c)}addStarfield(t,e,n){const i=new Float32Array(t*3);for(let o=0;o<t;o++){const l=At(o,11),c=At(o,12),h=l*Math.PI*2,u=Math.acos(2*c-1),f=e*(.55+At(o,13)*.45);i[o*3]=f*Math.sin(u)*Math.cos(h),i[o*3+1]=f*Math.cos(u)*.6,i[o*3+2]=f*Math.sin(u)*Math.sin(h)}const r=new ve;r.setAttribute("position",new De(i,3));const a=new Ys({color:16777215,size:1.2,sizeAttenuation:!0,transparent:!0,opacity:n,depthWrite:!1,fog:!1});this.group.add(new Aa(r,a))}addBillboards(t,e){const n=new _n(8,4),r=[61695,16722902,16770406].map(a=>new Et({color:a,transparent:!0,opacity:.55,side:he,toneMapped:!1}));for(let a=0;a<t;a++){const o=new et(n,r[a%r.length]),l=At(a,20)*Math.PI*2,c=40+At(a,21)*e;o.position.set(Math.cos(l)*c,25+At(a,22)*60,Math.sin(l)*c),o.rotation.y=l+Math.PI/2,this.group.add(o)}}addGround(t,e,n){const i=n?.scale??2.4;this.ground=new et(new _n(t*i,t*i,1,1),new ge({color:e,metalness:n?.metalness??.15,roughness:n?.roughness??.92,emissive:n?.emissive??0,emissiveIntensity:n?.emissiveIntensity??0})),this.ground.rotation.x=-Math.PI/2,this.ground.position.y=n?.y??0,this.ground.receiveShadow=!0,this.group.add(this.ground)}addCityFloor(t){this.addGround(t,920088,{metalness:.35,roughness:.88,emissive:1706032,emissiveIntensity:.12,scale:2.5});const e=new et(new Oe(t*.55,48),new Et({color:16722902,transparent:!0,opacity:.06,depthWrite:!1,toneMapped:!1}));e.rotation.x=-Math.PI/2,e.position.y=.04,this.group.add(e);const n=t*.95,i=14,r=new ge({color:656916,metalness:.4,roughness:.75,emissive:1312800,emissiveIntensity:.15}),a=new Et({color:61695,transparent:!0,opacity:.55,toneMapped:!1}),o=h=>{const u=new et(new _n(h?n*2:i,h?i:n*2),r);u.rotation.x=-Math.PI/2,u.position.y=.06,this.group.add(u);for(const f of[-1,1]){const p=new et(new _n(h?n*2:.35,h?.35:n*2),a);p.rotation.x=-Math.PI/2,p.position.y=.08,h?p.position.z=f*(i*.48):p.position.x=f*(i*.48),this.group.add(p)}};o(!0),o(!1);const l=new et(new Qi(t*.38,t*.38+10,64),new Et({color:16722902,transparent:!0,opacity:.12,side:he,depthWrite:!1,toneMapped:!1}));l.rotation.x=-Math.PI/2,l.position.y=.07,this.group.add(l);const c=new et(new Oe(22,32),new ge({color:1708080,metalness:.55,roughness:.45,emissive:61695,emissiveIntensity:.18}));c.rotation.x=-Math.PI/2,c.position.y=.09,this.group.add(c)}addPitFloor(t){const e=new et(new Oe(t*.78,48),new ge({color:1181720,metalness:.55,roughness:.55,emissive:2754624,emissiveIntensity:.22}));e.rotation.x=-Math.PI/2,e.position.y=.05,this.group.add(e);for(let n=0;n<3;n++){const i=28+n*32,r=i+1.4,a=new et(new Qi(i,r,48),new Et({color:n%2===0?16722902:61695,transparent:!0,opacity:.28-n*.06,side:he,depthWrite:!1,toneMapped:!1}));a.rotation.x=-Math.PI/2,a.position.y=.08+n*.01,this.group.add(a)}}addCloudSeaFloor(t){this.addGround(t,796744,{metalness:.72,roughness:.22,emissive:663608,emissiveIntensity:.2,scale:2.8});const e=new et(new _n(t*2.6,t*2.6),new Et({color:13164792,transparent:!0,opacity:.18,depthWrite:!1,side:he}));e.rotation.x=-Math.PI/2,e.position.y=1.2,this.group.add(e);const n=new et(new Qi(t*.9,t*1.05,64),new Et({color:11063536,transparent:!0,opacity:.2,side:he,depthWrite:!1,fog:!1}));n.rotation.x=-Math.PI/2,n.position.y=.4,this.group.add(n);const i=new et(new Oe(t*.25,40),new Et({color:15267071,transparent:!0,opacity:.12,depthWrite:!1}));i.rotation.x=-Math.PI/2,i.position.y=.15,this.group.add(i)}addSunset(t){const e=t.bounds,n=new et(new Oe(48,32),new Et({color:t.sunColor,fog:!1,transparent:!0,opacity:.95}));n.position.set(-180,40,-e*.9),this.group.add(n);const i=new et(new Oe(70,32),new Et({color:16729224,fog:!1,transparent:!0,opacity:.25}));i.position.copy(n.position),i.position.z+=1,this.group.add(i)}addMountains(t,e){const n=new Et({color:2756672,transparent:!0,opacity:.75}),i=new Nn(1,1,5),r=new Ne(i,n,e),a=new Qt;for(let o=0;o<e;o++){const l=o/e*Math.PI*2,c=t*1.12,h=45+At(o,30)*90,u=28+At(o,31)*40;a.position.set(Math.cos(l)*c,h*.35,Math.sin(l)*c),a.scale.set(u,h,u),a.updateMatrix(),r.setMatrixAt(o,a.matrix)}r.instanceMatrix.needsUpdate=!0,this.group.add(r)}addPads(t,e,n,i){const r=new ge({color:1712176,emissive:61695,emissiveIntensity:.35,metalness:.5,roughness:.4}),a=new ke(6,7,1.2,8),o=new Ne(a,r,t),l=new Qt;for(let c=0;c<t;c++){const h=(At(c,40)-.5)*e*2,u=(At(c,41)-.5)*e*2,f=n+At(c,42)*(i-n);l.position.set(h,f,u),l.scale.set(1,1,1),l.updateMatrix(),o.setMatrixAt(c,l.matrix),this.colliders.push(this.makeCollider(h,f,u,6,.6,6))}o.instanceMatrix.needsUpdate=!0,this.group.add(o)}addStreetLightsInstanced(t){const e=[];for(let o=-t;o<=t;o+=36)for(const l of[-14,14])e.push([l,8,o],[o,8,l]);const n=new Te(.55,5,5),i=new Et({color:16770406,toneMapped:!1}),r=new Ne(n,i,e.length),a=new Qt;for(let o=0;o<e.length;o++)a.position.set(e[o][0],e[o][1],e[o][2]),a.scale.set(1,1,1),a.updateMatrix(),r.setMatrixAt(o,a.matrix);r.instanceMatrix.needsUpdate=!0,this.group.add(r)}makeCollider(t,e,n,i,r,a){const o=new C(t,e,n),l=new C(i,r,a);return{center:o,half:l,min:new C(t-i,e-r,n-a),max:new C(t+i,e+r,n+a)}}rebuildSpatial(){this.spatial.clear();const t=this.spatialCell;for(let e=0;e<this.colliders.length;e++){const n=this.colliders[e],i=Math.floor(n.min.x/t),r=Math.floor(n.max.x/t),a=Math.floor(n.min.z/t),o=Math.floor(n.max.z/t);for(let l=i;l<=r;l++)for(let c=a;c<=o;c++){const h=`${l},${c}`;let u=this.spatial.get(h);u||(u=[],this.spatial.set(h,u)),u.push(e)}}}collideSphere(t,e,n){const i=this.spatialCell,r=Math.floor((t.x-e)/i)-1,a=Math.floor((t.x+e)/i)+1,o=Math.floor((t.z-e)/i)-1,l=Math.floor((t.z+e)/i)+1,c=new Set;let h=!1;for(let u=r;u<=a;u++)for(let f=o;f<=l;f++){const p=this.spatial.get(`${u},${f}`);if(p)for(const g of p){if(c.has(g))continue;c.add(g);const _=this.colliders[g],m=qt.clamp(t.x,_.min.x,_.max.x),d=qt.clamp(t.y,_.min.y,_.max.y),S=qt.clamp(t.z,_.min.z,_.max.z),w=t.x-m,v=t.y-d,I=t.z-S,A=w*w+v*v+I*I;if(t.x>=_.min.x&&t.x<=_.max.x&&t.y>=_.min.y&&t.y<=_.max.y&&t.z>=_.min.z&&t.z<=_.max.z){const L=t.x-_.min.x,E=_.max.x-t.x,y=t.y-_.min.y,P=_.max.y-t.y,H=t.z-_.min.z,B=_.max.z-t.z;let V=0,q=1,G=L;E<G&&(G=E,q=-1),y<G&&(G=y,V=1,q=1),P<G&&(G=P,V=1,q=-1),H<G&&(G=H,V=2,q=1),B<G&&(G=B,V=2,q=-1),n.set(0,0,0),V===0?n.x=-q:V===1?n.y=-q:n.z=-q;const J=G+e+.08;t.addScaledVector(n,J),h=!0;continue}if(A<e*e&&A>1e-10){const L=Math.sqrt(A);n.set(w/L,v/L,I/L);const E=e-L+.06;t.addScaledVector(n,E),h=!0}}}return this.groundCollide&&t.y-e<0&&(n.set(0,1,0),t.y=e,h=!0),h}resolveSolid(t,e,n,i=6){let r=!1;for(let a=0;a<i&&this.collideSphere(t,e,n);a++)r=!0;return r}lineOfSight(t,e){const n=e.x-t.x,i=e.y-t.y,r=e.z-t.z,a=Math.hypot(n,i,r);if(a<2)return!0;const o=Math.min(28,Math.max(6,Math.ceil(a/10))),l=this.spatialCell,c=new Set;for(let h=2;h<=o-2;h++){const u=h/o,f=t.x+n*u,p=t.y+i*u,g=t.z+r*u,_=Math.floor(f/l),m=Math.floor(g/l);for(let d=-1;d<=1;d++)for(let S=-1;S<=1;S++){const w=this.spatial.get(`${_+d},${m+S}`);if(w)for(const v of w){if(c.has(v))continue;c.add(v);const I=this.colliders[v];if(!(I.half.y<4)&&f>=I.min.x&&f<=I.max.x&&p>=I.min.y&&p<=I.max.y&&g>=I.min.z&&g<=I.max.z)return!1}}}return!0}clear(){for(;this.group.children.length;)this.group.children.pop().traverse(e=>{const n=e;if(n.geometry&&n.geometry.dispose(),n.material){const i=n.material;Array.isArray(i)?i.forEach(r=>r.dispose()):i.dispose()}});this.colliders=[],this.spatial.clear(),this.buildingCount=0,this.ground=null}}function At(s,t){let e=s*374761393+t*668265263|0;return e=(e^e>>>13)*1274126177,e=e^e>>>16,(e>>>0)/4294967295}class Km{constructor(){T(this,"group",new Ae);T(this,"portals",[]);T(this,"rings",[]);T(this,"labels",[]);T(this,"spin",0)}buildForMap(t,e){this.clear();const n=this.pickTargets(t),i=n.length;if(i===0)return;const r=new Qn(10,.55,10,40),a=new Oe(9,32),o=new ke(.35,.5,18,6);for(let l=0;l<i;l++){const c=n[l],h=Ra[c],u=l/i*Math.PI*2+.4,f=e*.38+l%2*e*.08,p=28+l%3*12,g=new C(Math.cos(u)*f,p,Math.sin(u)*f),_=jm(c),m={id:`portal-${c}`,label:h?.name??c,target:c,position:g,color:_,radius:11};this.portals.push(m);const d=new Ae;d.position.copy(g),d.lookAt(0,p,0);const S=new Et({color:_,transparent:!0,opacity:.95,toneMapped:!1}),w=new et(r,S);w.rotation.x=Math.PI/2,d.add(w),this.rings.push(w);const v=new et(r,new Et({color:16777215,transparent:!0,opacity:.35,toneMapped:!1}));v.rotation.x=Math.PI/2,v.scale.setScalar(.88),d.add(v),this.rings.push(v);const I=new et(a,new Et({color:_,transparent:!0,opacity:.22,side:he,toneMapped:!1,depthWrite:!1}));I.rotation.x=Math.PI/2,d.add(I);const A=new ge({color:1708080,emissive:_,emissiveIntensity:.55,metalness:.4,roughness:.5});for(const E of[-11,11]){const y=new et(o,A);y.position.set(E,0,0),d.add(y)}const R=Zm(m.label,_);R.position.set(0,14,0),d.add(R),this.labels.push(R);const L=new Xa(_,1.4,60,2);L.position.set(0,0,0),d.add(L),this.group.add(d)}}pickTargets(t){return["sky-city","cloud-sea","upper-atmo","deep-space","the-pit"].filter(n=>n!==t)}update(t){this.spin+=t;for(let e=0;e<this.rings.length;e++){const n=this.rings[e];n.rotation.z=this.spin*(e%2===0?.7:-1.1)}}checkEnter(t){for(const e of this.portals)if(t.distanceTo(e.position)<e.radius)return e;return null}blips(){return this.portals.map(t=>({x:t.position.x,z:t.position.z}))}clear(){for(;this.group.children.length;)this.group.children.pop().traverse(e=>{const n=e;if(n.geometry&&n.geometry.dispose(),n.material){const i=n.material;Array.isArray(i)?i.forEach(r=>r.dispose()):i.dispose()}});this.portals=[],this.rings=[],this.labels=[]}}function jm(s){switch(s){case"sky-city":return 16722902;case"cloud-sea":return 6741503;case"upper-atmo":return 8956671;case"deep-space":return 11167487;case"the-pit":return 16739115;default:return 61695}}function Zm(s,t){const e=document.createElement("canvas");e.width=256,e.height=64;const n=e.getContext("2d");n.clearRect(0,0,256,64),n.fillStyle="rgba(0,0,0,0.45)",n.fillRect(8,12,240,40),n.font="bold 22px monospace",n.textAlign="center",n.textBaseline="middle",n.fillStyle="#"+t.toString(16).padStart(6,"0"),n.fillText(s,128,32);const i=new Ga(e);i.needsUpdate=!0;const r=new Va({map:i,transparent:!0,depthWrite:!1}),a=new ec(r);return a.scale.set(18,4.5,1),a}class Jm{constructor(t){T(this,"group",new Ae);T(this,"scene");T(this,"mapId","sky-city");T(this,"sky",null);T(this,"planet",null);T(this,"flashLight",null);T(this,"stormTimer",0);T(this,"nextStorm",18);T(this,"rain",null);T(this,"rainVel",null);T(this,"meteors",[]);T(this,"meteorSpawn",0);T(this,"satellites",null);T(this,"satAngle",0);T(this,"aurora",null);T(this,"time",0);T(this,"tmp",new C);T(this,"hazards",[]);this.scene=t}build(t){switch(this.clear(),this.mapId=t.id,this.time=0,this.stormTimer=0,this.nextStorm=12+Math.random()*20,this.meteorSpawn=0,this.sky=Qm(t.skyTop,t.skyBottom,t.bounds*2.8),this.group.add(this.sky),t.style){case"open":this.buildSkyCityWeather(t);break;case"clouds":this.buildCloudWeather(t);break;case"atmo":this.buildAtmoSky(t);break;case"space":this.buildSpaceHazards(t);break;case"pit":this.buildPitAmbience(t);break}this.scene.add(this.group)}buildSkyCityWeather(t){this.flashLight=new Xa(11193599,0,t.bounds*2,2),this.flashLight.position.set(0,180,0),this.group.add(this.flashLight);const e=900,n=new Float32Array(e*3);this.rainVel=new Float32Array(e);const i=t.bounds;for(let a=0;a<e;a++)n[a*3]=(Math.random()-.5)*i*2,n[a*3+1]=Math.random()*160+20,n[a*3+2]=(Math.random()-.5)*i*2,this.rainVel[a]=40+Math.random()*55;const r=new ve;r.setAttribute("position",new De(n,3)),this.rain=new Aa(r,new Ys({color:8956671,size:.55,transparent:!0,opacity:.35,depthWrite:!1,fog:!1})),this.rain.visible=!1,this.group.add(this.rain);for(let a=0;a<6;a++){const o=a/6*Math.PI*2,l=new et(new Te(1,8,6),new Et({color:2756672,transparent:!0,opacity:.35,fog:!1,depthWrite:!1}));l.scale.set(50+Math.random()*40,12+Math.random()*10,40+Math.random()*30),l.position.set(Math.cos(o)*t.bounds*.95,90+Math.random()*40,Math.sin(o)*t.bounds*.95),this.group.add(l)}}buildCloudWeather(t){const e=new et(new Oe(55,32),new Et({color:16771242,fog:!1,transparent:!0,opacity:.85,side:he}));e.position.set(-120,80,-t.bounds*.85),this.group.add(e);const n=new et(new ke(t.bounds*1.15,t.bounds*1.2,35,48,1,!0),new Et({color:12113136,transparent:!0,opacity:.22,side:he,fog:!1,depthWrite:!1}));n.position.y=15,this.group.add(n);for(let i=0;i<5;i++){const r=new et(new Nn(18,90,8,1,!0),new Et({color:16773320,transparent:!0,opacity:.06,side:he,depthWrite:!1,fog:!1})),a=i/5*Math.PI*2;r.position.set(Math.cos(a)*80,70,Math.sin(a)*80),r.rotation.x=Math.PI,this.group.add(r)}}buildAtmoSky(t){this.planet=new et(new Te(t.bounds*1.4,48,32),new ge({color:1716320,emissive:661568,emissiveIntensity:.4,metalness:.1,roughness:.9,fog:!1})),this.planet.position.set(0,-t.bounds*1.55,0),this.group.add(this.planet);const e=new et(new Te(t.bounds*1.42,48,24),new Et({color:4491519,transparent:!0,opacity:.12,side:Se,fog:!1,depthWrite:!1}));e.position.copy(this.planet.position),this.group.add(e);const n=new et(new Te(t.bounds*1.405,32,24),new Et({color:11193599,transparent:!0,opacity:.15,fog:!1,depthWrite:!1}));n.position.copy(this.planet.position),this.group.add(n),this.aurora=new et(new Qn(t.bounds*.55,8,8,64),new Et({color:4521898,transparent:!0,opacity:.22,fog:!1,depthWrite:!1,side:he})),this.aurora.rotation.x=Math.PI*.4,this.aurora.position.y=40,this.group.add(this.aurora);const i=new et(new Oe(40,28),new Et({color:16773341,fog:!1,side:he}));i.position.set(-200,120,-t.bounds),this.group.add(i)}buildSpaceHazards(t){const e=[11149960,2245802,6693546,2263142];for(let r=0;r<4;r++){const a=new et(new Oe(t.bounds*(.5+Math.random()*.4),28),new Et({color:e[r],transparent:!0,opacity:.12+Math.random()*.08,fog:!1,side:he,depthWrite:!1})),o=r/4*Math.PI*2;a.position.set(Math.cos(o)*t.bounds*1.2,(Math.random()-.5)*80,Math.sin(o)*t.bounds*1.2),a.lookAt(0,0,0),this.group.add(a)}this.satellites=new Ae;for(let r=0;r<8;r++){const a=new Ae,o=new et(new zt(3,1.2,1.2),new ge({color:8952234,metalness:.8,roughness:.3,emissive:1122867,emissiveIntensity:.4}));a.add(o);const l=new et(new zt(8,.08,2.2),new Et({color:2245802,toneMapped:!1}));l.position.y=.2,a.add(l);const c=r/8*Math.PI*2,h=90+r%3*40;a.position.set(Math.cos(c)*h,-20+r%4*25,Math.sin(c)*h),a.userData.orbitR=h,a.userData.orbitA=c,a.userData.orbitY=a.position.y,this.satellites.add(a)}this.group.add(this.satellites);const n=new Qs(1,0),i=new ge({color:8939093,emissive:16729088,emissiveIntensity:.35,roughness:.9,metalness:.15});for(let r=0;r<24;r++){const a=new et(n,i.clone());a.visible=!1,this.group.add(a),this.meteors.push({mesh:a,vel:new C,alive:!1,life:0,radius:2})}}buildPitAmbience(t){const e=new et(new Te(t.bounds*1.1,24,12,0,Math.PI*2,0,Math.PI*.45),new Et({color:1706016,transparent:!0,opacity:.55,side:Se,fog:!1,depthWrite:!1}));e.position.y=20,this.group.add(e);const n=200,i=new Float32Array(n*3);for(let a=0;a<n;a++){const o=Math.random()*Math.PI*2,l=Math.random()*t.bounds*.7;i[a*3]=Math.cos(o)*l,i[a*3+1]=5+Math.random()*80,i[a*3+2]=Math.sin(o)*l}const r=new ve;r.setAttribute("position",new De(i,3)),this.rain=new Aa(r,new Ys({color:16737826,size:.8,transparent:!0,opacity:.5,depthWrite:!1})),this.group.add(this.rain)}update(t,e){if(this.time+=t,this.hazards=[],this.sky&&(this.sky.rotation.y=this.time*.008),this.mapId==="sky-city"&&this.updateStorm(t,e),this.mapId==="cloud-sea"&&this.sky&&this.sky.material.map,this.mapId==="upper-atmo"&&(this.planet&&(this.planet.rotation.y=this.time*.02),this.aurora&&(this.aurora.rotation.z=this.time*.15,this.aurora.material.opacity=.15+Math.sin(this.time*1.2)*.08)),this.mapId==="deep-space"&&this.updateSpace(t,e),this.mapId==="the-pit"&&this.rain){const n=this.rain.geometry.attributes.position.array;for(let i=0;i<n.length;i+=3)n[i+1]+=t*(8+i%5),n[i+1]>90&&(n[i+1]=5);this.rain.geometry.attributes.position.needsUpdate=!0}return this.hazards}updateStorm(t,e){if(this.stormTimer+=t,this.stormTimer>=this.nextStorm&&(this.stormTimer=0,this.nextStorm=14+Math.random()*28,this.flashLightning(e)),this.rain&&this.flashLight){const n=this.flashLight.intensity>.5||this.stormTimer<4;if(this.rain.visible=n,n&&this.rainVel){const i=this.rain.geometry.attributes.position.array,r=this.rainVel.length;for(let a=0;a<r;a++)i[a*3+1]-=this.rainVel[a]*t,i[a*3+1]<0&&(i[a*3+1]=140+Math.random()*40,i[a*3]=(Math.random()-.5)*800,i[a*3+2]=(Math.random()-.5)*800);this.rain.geometry.attributes.position.needsUpdate=!0}}this.flashLight&&this.flashLight.intensity>0&&(this.flashLight.intensity=Math.max(0,this.flashLight.intensity-t*25))}flashLightning(t){this.flashLight&&(this.flashLight.intensity=40,this.flashLight.position.set((Math.random()-.5)*200,100+Math.random()*80,(Math.random()-.5)*200));const e=new et(new ke(.4,.15,80,4),new Et({color:14544639,toneMapped:!1,transparent:!0,opacity:.95})),n=(Math.random()-.5)*180,i=(Math.random()-.5)*180;if(e.position.set(n,70,i),this.group.add(e),window.setTimeout(()=>{this.group.remove(e),e.geometry.dispose(),e.material.dispose()},120),Math.random()<.12&&t.length){const r=t[Math.floor(Math.random()*t.length)];e.position.set(r.pos.x,r.pos.y+40,r.pos.z),this.flashLight&&(this.flashLight.position.copy(r.pos).y+=30),this.hazards.push({kind:"lightning",position:r.pos.clone(),damage:8+Math.random()*10,stun:.55+Math.random()*.35})}}updateSpace(t,e){if(this.satellites){this.satAngle+=t*.12;for(const n of this.satellites.children){const i=n.userData.orbitR,r=n.userData.orbitA,a=n.userData.orbitY,o=r+this.satAngle;n.position.set(Math.cos(o)*i,a+Math.sin(this.time+r)*4,Math.sin(o)*i),n.lookAt(0,a,0)}}this.meteorSpawn-=t,this.meteorSpawn<=0&&(this.meteorSpawn=.8+Math.random()*1.8,this.spawnMeteor());for(const n of this.meteors)if(n.alive){if(n.life-=t,n.mesh.position.addScaledVector(n.vel,t),n.mesh.rotation.x+=t*2,n.mesh.rotation.y+=t*1.5,n.life<=0){n.alive=!1,n.mesh.visible=!1;continue}for(const i of e)if(i.pos.distanceTo(n.mesh.position)<n.radius+2.2){this.hazards.push({kind:"meteor",position:n.mesh.position.clone(),damage:18+Math.random()*22,stun:.25}),n.alive=!1,n.mesh.visible=!1;break}}}spawnMeteor(){const t=this.meteors.find(r=>!r.alive);if(!t)return;const e=Math.random()*Math.PI*2,n=180+Math.random()*120;t.mesh.position.set(Math.cos(e)*n,80+Math.random()*100,Math.sin(e)*n),this.tmp.set((Math.random()-.5)*60,-40+(Math.random()-.5)*40,(Math.random()-.5)*60),t.vel.copy(this.tmp).sub(t.mesh.position).normalize().multiplyScalar(45+Math.random()*50);const i=1.5+Math.random()*4;t.mesh.scale.setScalar(i),t.radius=i*1.1,t.life=8,t.alive=!0,t.mesh.visible=!0}getSolidSpheres(){const t=[];if(this.satellites)for(const e of this.satellites.children)t.push({pos:e.position,radius:4});for(const e of this.meteors)e.alive&&t.push({pos:e.mesh.position,radius:e.radius});return t}clear(){for(this.group.parent&&this.scene.remove(this.group);this.group.children.length;)this.group.children.pop().traverse(e=>{const n=e;if(n.geometry&&n.geometry.dispose(),n.material){const i=n.material;if(Array.isArray(i))i.forEach(r=>r.dispose());else{const r=i.map;r&&r.dispose(),i.dispose()}}});this.sky=null,this.planet=null,this.flashLight=null,this.rain=null,this.rainVel=null,this.meteors=[],this.satellites=null,this.aurora=null}}function Qm(s,t,e){const n=document.createElement("canvas");n.width=4,n.height=64;const i=n.getContext("2d"),r=i.createLinearGradient(0,0,0,64),a="#"+s.toString(16).padStart(6,"0"),o="#"+t.toString(16).padStart(6,"0");r.addColorStop(0,a),r.addColorStop(.45,a),r.addColorStop(1,o),i.fillStyle=r,i.fillRect(0,0,4,64);const l=new Ga(n);l.colorSpace=Be;const c=new Et({map:l,side:Se,fog:!1,depthWrite:!1}),h=new et(new Te(e,40,24),c);return h.renderOrder=-10,h}class tg{constructor(t,e="sky-city"){T(this,"def");T(this,"city",new $m);T(this,"portals",new Km);T(this,"atmosphere");T(this,"scene");T(this,"hemi",null);T(this,"sun",null);T(this,"ambient",null);this.scene=t,this.def=Ra[e],this.atmosphere=new Jm(t)}load(t){this.def=Ra[t],this.clearLights(),this.city.clear(),this.portals.clear(),this.atmosphere.clear(),this.city.group.parent&&this.scene.remove(this.city.group),this.portals.group.parent&&this.scene.remove(this.portals.group),this.scene.background=new Ot(this.def.skyTop),this.scene.fog=new Ha(this.def.fogColor,this.def.fogDensity),this.hemi=new Im(this.def.skyTop,this.def.skyBottom,.65),this.ambient=new Fm(this.def.ambient,.7),this.sun=new Nm(this.def.sunColor,this.def.sunIntensity),this.sun.position.set(-80,60,-100),this.scene.add(this.hemi,this.ambient,this.sun),this.atmosphere.build(this.def),this.city.build(this.def),this.scene.add(this.city.group),this.portals.buildForMap(t,this.def.bounds),this.scene.add(this.portals.group)}update(t,e){return this.portals.update(t),this.atmosphere.update(t,e)}checkPortal(t){return this.portals.checkEnter(t)}getSpawn(t){const e=this.def.spawnPoints,n=e[t%e.length];return new C(n[0],n[1],n[2])}randomSpawn(){const t=Math.floor(Math.random()*this.def.spawnPoints.length),e=this.getSpawn(t);return e.x+=(Math.random()-.5)*8,e.z+=(Math.random()-.5)*8,e}clearLights(){for(const t of[this.hemi,this.sun,this.ambient])t&&this.scene.remove(t);this.hemi=this.sun=this.ambient=null}dispose(){this.clearLights(),this.city.clear(),this.portals.clear(),this.atmosphere.clear(),this.scene.remove(this.city.group),this.scene.remove(this.portals.group)}}const ml=[{kind:"weapon",weapon:"laser",amount:1,label:"LASER",color:3800968},{kind:"weapon",weapon:"torpedo",amount:4,label:"TORPEDO",color:16737826},{kind:"weapon",weapon:"rail",amount:6,label:"RAIL",color:16722902},{kind:"weapon",weapon:"rocket",amount:2,label:"ROCKET ×2",color:16755268},{kind:"weapon",weapon:"scatter",amount:12,label:"SCATTER",color:16770406}],eg=[{kind:"health",amount:40,label:"HULL+",color:16729190},{kind:"shield",amount:50,label:"SHIELD+",color:61695},{kind:"ammo",amount:1,label:"RELOAD",color:11193599}];class ng{constructor(){T(this,"group",new Ae);T(this,"pickups",[]);T(this,"nextId",1);T(this,"time",0)}spawnForMap(t,e=22){this.clear();const n=[...ml,...ml,...eg];for(let i=0;i<e;i++){const r=n[i%n.length],a=i/e*Math.PI*2+Ns(i)*.8,o=50+Ns(i+3)*t*.55,l=18+Ns(i+7)*90,c=new C(Math.cos(a)*o,l,Math.sin(a)*o);this.spawnOne(r,c)}}spawnOne(t,e){const n=new Ae;n.position.copy(e);const i=new ge({color:1709096,metalness:.45,roughness:.55,emissive:t.color,emissiveIntensity:.35}),r=new Et({color:t.color,toneMapped:!1,transparent:!0,opacity:.95}),a=new et(new zt(2.4,2,2.4),i);n.add(a);const o=new et(new zt(2.5,.2,2.5),r);o.position.y=1.05,n.add(o);for(const[u,f]of[[-1.1,-1.1],[1.1,-1.1],[-1.1,1.1],[1.1,1.1]]){const p=new et(new zt(.18,2.1,.18),r);p.position.set(u,0,f),n.add(p)}const l=new et(new ke(.12,.35,10,6),new Et({color:t.color,transparent:!0,opacity:.35,depthWrite:!1,toneMapped:!1}));l.position.y=6,n.add(l);const c=new et(new Te(.55,8,8),new Et({color:t.color,toneMapped:!1}));c.position.y=11.2,n.add(c);const h=ig(`▣ ${t.label}`,t.color);h.position.y=3.6,n.add(h),this.group.add(n),this.pickups.push({id:this.nextId++,def:t,mesh:n,position:e.clone(),alive:!0,respawnAt:0,bob:Ns(this.nextId)*Math.PI*2})}update(t){this.time+=t;for(const e of this.pickups){if(!e.alive){this.time>=e.respawnAt&&(e.alive=!0,e.mesh.visible=!0);continue}e.mesh.rotation.y+=t*.7,e.mesh.position.y=e.position.y+Math.sin(this.time*2.2+e.bob)*.55;const n=e.mesh.children[6];if(n){const i=.9+Math.sin(this.time*3+e.bob)*.12;n.scale.set(i,1,i)}}}tryCollect(t,e=In.collectRadius){for(const n of this.pickups)if(n.alive&&t.distanceTo(n.mesh.position)<e)return n.alive=!1,n.mesh.visible=!1,n.respawnAt=this.time+In.respawnSec,n.def;return null}respawnDelaySec(){return In.respawnSec}blips(){return this.pickups.filter(t=>t.alive).map(t=>({x:t.position.x,z:t.position.z}))}exportState(){return{time:this.time,items:this.pickups.map(t=>({alive:t.alive,respawnAt:t.respawnAt}))}}importState(t){if(!(!t||t.items.length!==this.pickups.length)){this.time=t.time;for(let e=0;e<this.pickups.length;e++){const n=this.pickups[e],i=t.items[e];n.alive=i.alive,n.respawnAt=i.respawnAt,n.mesh.visible=n.alive}}}clear(){for(;this.group.children.length;)this.group.children.pop().traverse(e=>{const n=e;if(n.geometry&&n.geometry.dispose(),n.material){const i=n.material;Array.isArray(i)?i.forEach(r=>r.dispose()):i.dispose()}});this.pickups=[]}}function Ns(s){let t=s*374761393|0;return t=(t^t>>>13)*1274126177,((t^t>>>16)>>>0)/4294967295}function ig(s,t){const e=document.createElement("canvas");e.width=128,e.height=40;const n=e.getContext("2d");n.fillStyle="rgba(0,0,0,0.5)",n.fillRect(4,6,120,28),n.font="bold 16px monospace",n.textAlign="center",n.textBaseline="middle",n.fillStyle="#"+t.toString(16).padStart(6,"0"),n.fillText(s,64,20);const i=new Ga(e),r=new Va({map:i,transparent:!0,depthWrite:!1}),a=new ec(r);return a.scale.set(8,2.5,1),a}const gl=[{type:"hunter",aggression:.85,accuracy:.74,courage:.55,preferredRange:70,speedMul:1.08},{type:"skirmisher",aggression:.55,accuracy:.68,courage:.45,preferredRange:95,speedMul:1.18},{type:"sniper",aggression:.4,accuracy:.86,courage:.35,preferredRange:140,speedMul:.95},{type:"guardian",aggression:.5,accuracy:.72,courage:.7,preferredRange:55,speedMul:1},{type:"berserker",aggression:1,accuracy:.62,courage:.9,preferredRange:35,speedMul:1.22}];class _l{constructor(t,e=16722902,n=0){T(this,"state");T(this,"pawn");T(this,"marker");T(this,"persona");T(this,"mood","hunt");T(this,"difficulty",1);T(this,"velocity",new C);T(this,"targetId",null);T(this,"fireCd",0);T(this,"thinkTimer",0);T(this,"moodTimer",0);T(this,"hidePoint",new C);T(this,"orbitAngle",0);T(this,"strafeSign",1);T(this,"jukeTimer",0);T(this,"tmp",new C);T(this,"tmp2",new C);T(this,"tmp3",new C);T(this,"quat",new ln);T(this,"euler",new ze(0,0,0,"YXZ"));T(this,"lastDamaged",0);this.state=t,this.pawn=new rc(e,!1),this.marker=this.makeMarker(e),this.pawn.group.add(this.marker),this.persona=gl[n%gl.length],this.orbitAngle=Math.random()*Math.PI*2,this.strafeSign=Math.random()<.5?-1:1,this.syncFromState()}makeMarker(t){const e=new Ae,n=16722506,i=new Et({color:n,transparent:!0,opacity:.95,depthTest:!0,depthWrite:!1,side:he,toneMapped:!1}),r=new Et({color:t,transparent:!0,opacity:.85,depthTest:!0,depthWrite:!1,toneMapped:!1}),a=new et(new Wa(1.1,0),i);a.position.y=-.9,a.scale.set(1.4,.25,1.4),e.add(a);const o=new et(new Nn(.55,1.2,3),i);o.position.y=2.8,o.rotation.x=Math.PI,e.add(o);const l=new et(new Qn(1.8,.06,6,20),r);l.rotation.x=Math.PI/2,l.position.y=.15,e.add(l);const c=new et(new zt(.12,.7,.12),i);c.position.y=2,e.add(c);const h=new et(new zt(.14,.14,.14),i);return h.position.y=1.45,e.add(h),e.position.y=.2,e}setTrackerVisible(t){this.marker.visible=t&&this.state.alive}deflect(t){const e=this.velocity.dot(t);e<0&&this.velocity.addScaledVector(t,-e*1.35),this.velocity.addScaledVector(t,6),this.pawn.group.position.addScaledVector(t,.4);const n=this.velocity.length();n>90&&this.velocity.multiplyScalar(90/n)}syncFromState(){this.pawn.group.position.fromArray(this.state.position),this.quat.fromArray(this.state.rotation),this.pawn.group.quaternion.copy(this.quat),this.velocity.fromArray(this.state.velocity)}writeState(){this.pawn.group.position.toArray(this.state.position),this.pawn.group.quaternion.toArray(this.state.rotation),this.velocity.toArray(this.state.velocity)}update(t,e,n,i,r,a,o){if(!this.state.alive){this.pawn.group.visible=!1;return}this.pawn.group.visible=!0,this.marker.rotation.y+=t*1.5,this.lastDamaged=Math.max(0,this.lastDamaged-t),this.jukeTimer=Math.max(0,this.jukeTimer-t),this.fireCd=Math.max(0,this.fireCd-t),this.moodTimer-=t,this.thinkTimer-=t,this.thinkTimer<=0&&(this.thinkTimer=.25+Math.random()*.35,this.pickTarget(e),this.reassessMood(n,i,r));const l=this.pawn.group.position,c=this.targetId?e.find(R=>R.id===this.targetId&&R.alive):null,h=c?this.tmp2.fromArray(c.position):null,u=h?l.distanceTo(h):1/0,f=this.tmp3;switch(this.mood){case"flee":this.computeFlee(f,h,l,n,i,r);break;case"hide":f.copy(this.hidePoint),l.distanceTo(this.hidePoint)<18&&(f.x+=Math.sin(performance.now()*.001+this.orbitAngle)*12,f.z+=Math.cos(performance.now()*.001+this.orbitAngle)*12,f.y+=Math.sin(performance.now()*.0015)*8);break;case"defend":this.computeDefend(f,h,l);break;case"engage":this.computeEngage(f,h,l,u);break;case"hunt":default:this.computeHunt(f,h,l,n,i,r);break}this.tmp.copy(f).sub(l),this.tmp.length()>.5&&this.tmp.normalize();const g=Math.atan2(-this.tmp.x,-this.tmp.z),_=Math.asin(qt.clamp(this.tmp.y,-.85,.85));this.euler.setFromQuaternion(this.pawn.group.quaternion,"YXZ");const m=qt.clamp(this.difficulty,.6,1.6),d=(this.mood==="flee"?3.4:this.mood==="engage"?2.85:2.2)*m;this.euler.y=qt.lerp(this.euler.y,g,1-Math.exp(-d*t)),this.euler.x=qt.lerp(this.euler.x,-_*.75,1-Math.exp(-2.4*t));const S=qt.euclideanModulo(g-this.euler.y+Math.PI,Math.PI*2)-Math.PI;this.euler.z=qt.lerp(this.euler.z,qt.clamp(-S*.85,-.6,.6),1-Math.exp(-3.5*t)),this.quat.setFromEuler(this.euler),this.pawn.group.quaternion.copy(this.quat);let w=44*this.persona.speedMul;this.mood==="flee"?w=100*this.persona.speedMul:this.mood==="engage"?w=78*this.persona.speedMul:this.mood==="hunt"?w=68*this.persona.speedMul:this.mood==="hide"?w=38:this.mood==="defend"&&(w=52);const v=this.tmp.set(0,0,-1).applyQuaternion(this.quat);if(this.mood==="engage"||this.mood==="defend"){const R=this.tmp2.set(1,0,0).applyQuaternion(this.quat);v.addScaledVector(R,this.strafeSign*.38*this.effAggression()),this.jukeTimer<=0&&(this.strafeSign*=-1,this.jukeTimer=.55+Math.random()*.95),v.normalize()}const I=this.mood==="flee"?2.6:1.75;this.velocity.lerp(v.multiplyScalar(w),1-Math.exp(-I*t)),(this.mood==="hunt"||this.mood==="engage")&&(this.velocity.y+=Math.sin(performance.now()*.0022+this.orbitAngle*3)*14*t),l.addScaledVector(this.velocity,t),l.y=qt.clamp(l.y,i+4,r-8);const A=n*.88;if(l.x=qt.clamp(l.x,-A,A),l.z=qt.clamp(l.z,-A,A),(this.mood==="defend"||this.mood==="hide")&&this.state.shield>20&&this.state.health<55?this.state.shieldDeployed=!0:this.state.health>70&&(this.state.shieldDeployed=!1),this.pawn.setBoost(this.mood==="flee"||this.mood==="engage"?.85:.35),this.pawn.setShield(this.state.shieldDeployed),h&&(this.mood==="engage"||this.mood==="defend"||this.mood==="hunt")){const R=this.persona.type==="sniper"?200:150;u<R&&this.fireCd<=0&&this.hasRoughLos(l,h,o)&&this.tryShot(l,h,u,a)}this.mood==="hide"&&h&&u<100&&this.fireCd<=0&&Math.random()<.15&&this.tryShot(l,h,u,a),this.writeState()}effAggression(){return qt.clamp(this.persona.aggression*this.difficulty,.05,1)}reassessMood(t,e,n){const i=this.state.health/100,r=this.effAggression(),o=.28+(1-qt.clamp(this.persona.courage*(.7+this.difficulty*.3),0,1))*.35;if(i<o||i<.4&&this.lastDamaged>0){this.persona.type==="guardian"||Math.random()<.55?(this.mood="hide",this.pickHidePoint(t,e,n)):this.mood="flee",this.moodTimer=2.5+Math.random()*2;return}if(!(this.moodTimer>0&&(this.mood==="flee"||this.mood==="hide")&&!(i>o+.15))){if(!this.targetId){this.mood="hunt",this.moodTimer=.6+Math.random()*.8;return}this.persona.type==="sniper"?this.mood=Math.random()<.3?"defend":"engage":this.persona.type==="guardian"?this.mood=Math.random()<.3?"defend":"engage":r>.6||i>.5?this.mood="engage":this.mood="hunt",this.moodTimer=1.2+Math.random()*1.5}}pickHidePoint(t,e,n){const r=Math.floor((Math.random()-.5)*(t/30)*.7),a=Math.floor((Math.random()-.5)*(t/30)*.7);this.hidePoint.set(r*30+8,e+12+Math.random()*(n-e)*.35,a*30+8)}computeFlee(t,e,n,i,r,a){e?t.copy(n).sub(e).normalize():t.set(Math.sin(this.orbitAngle),.3,Math.cos(this.orbitAngle));const o=this.persona.type==="skirmisher"||Math.random()<.5?1:-.6;t.y=o,t.normalize(),t.multiplyScalar(80).add(n),t.x+=Math.sign(n.x||1)*40,t.z+=Math.sign(n.z||1)*40,t.y=qt.clamp(t.y,r+10,a-15),t.x=qt.clamp(t.x,-i*.8,i*.8),t.z=qt.clamp(t.z,-i*.8,i*.8)}computeDefend(t,e,n){this.orbitAngle+=.02;const i=e||this.tmp.set(0,n.y,0),r=this.persona.preferredRange*.7;t.set(i.x+Math.cos(this.orbitAngle)*r,(e?e.y:n.y)+Math.sin(this.orbitAngle*2)*18,i.z+Math.sin(this.orbitAngle)*r)}computeEngage(t,e,n,i){if(!e){t.copy(n);return}const r=this.persona.preferredRange,a=this.tmp.copy(n).sub(e);if(a.lengthSq()<1&&a.set(1,0,0),a.normalize(),i>r+25)t.copy(e),t.y+=(Math.random()-.4)*30,t.addScaledVector(a,-12);else if(i<r-20)t.copy(n).addScaledVector(a,40),t.y+=this.strafeSign*25;else{const o=this.tmp.set(a.z,0,-a.x).normalize();t.copy(e).addScaledVector(o,this.strafeSign*r*.5),t.y=e.y+Math.sin(performance.now()*.0015+this.orbitAngle)*20}}computeHunt(t,e,n,i,r,a){if(e){const o=this.tmp.copy(e).sub(n),l=o.length();l>1&&o.multiplyScalar(1/l);const c=Math.max(0,l-this.persona.preferredRange*.6);t.copy(n).addScaledVector(o,c),t.y=e.y+8;const h=qt.clamp(l*.12,4,22);t.x+=Math.sin(performance.now()*8e-4+this.orbitAngle)*h,t.z+=Math.cos(performance.now()*8e-4+this.orbitAngle)*h;return}this.orbitAngle+=.01,t.set(Math.sin(this.orbitAngle*.7)*i*.45,r+30+Math.abs(Math.sin(this.orbitAngle))*(a-r)*.4,Math.cos(this.orbitAngle*.55)*i*.45)}hasRoughLos(t,e,n){return n?n(t,e):!0}tryShot(t,e,n,i){const r=this.tmp.copy(e).sub(t).normalize(),a=n/155,o=(1-this.persona.accuracy)*.2/qt.clamp(this.difficulty,.5,2.2);r.x+=(Math.random()-.5)*o,r.y+=(Math.random()-.5)*o*.7+a*.025,r.z+=(Math.random()-.5)*o,r.normalize();let l="plasma";this.persona.type==="sniper"&&n>80?l=Math.random()<.5?"rail":"laser":this.persona.type==="berserker"&&n<50?l=Math.random()<.4?"scatter":"plasma":n>100?l=Math.random()<.45?"rail":"laser":n>55?l=Math.random()<.35?"rocket":n>70?"torpedo":"plasma":l=Math.random()<.3?"scatter":"plasma";const c=t.clone().addScaledVector(r,2.5);i(c,r,l),this.fireCd=l==="plasma"?.24:l==="laser"?.11:l==="scatter"?.48:l==="rocket"?1.15:l==="torpedo"?1.85:1.55,this.fireCd*=qt.clamp(1.15-this.difficulty*.15,.7,1.25)}pickTarget(t){let e=null,n=-1/0;const i=this.pawn.group.position;for(const r of t){if(r.id===this.state.id||!r.alive||this.state.team!==0&&r.team===this.state.team)continue;let o=1400-Math.sqrt(i.distanceToSquared(this.tmp.fromArray(r.position)))*1.4;o+=(100-r.health)*.4,r.shieldDeployed&&(o-=40),r.id===this.targetId&&(o+=90),o+=(Math.random()-.5)*45,o>n&&(n=o,e=r)}this.targetId=e?.id??null}takeDamage(t){if(!this.state.alive)return!1;if(this.lastDamaged=1.5,this.state.shieldDeployed)t*=.2;else if(this.state.shield>0){const e=Math.min(this.state.shield,t);this.state.shield-=e,t-=e}return this.state.health-=t,this.state.health<40*(1.2-this.persona.courage)&&(this.mood=Math.random()<.5?"flee":"hide",this.moodTimer=2,this.thinkTimer=0),this.state.health<=0?(this.state.health=0,this.state.alive=!1,this.state.deaths++,!0):!1}respawn(t){this.state.alive=!0,this.state.health=100,this.state.shield=100,this.state.shieldDeployed=!1,t.toArray(this.state.position),this.velocity.set(0,0,0),this.mood="hunt",this.targetId=null,this.syncFromState(),this.pawn.group.visible=!0}dispose(){this.pawn.dispose()}}class sg{constructor(t){T(this,"scene");T(this,"pool",[]);T(this,"active",[]);T(this,"sparks",[]);T(this,"sparkPool",[]);this.scene=t;for(let e=0;e<28;e++){const n=new et(new Te(1,8,8),new Et({color:16737826,transparent:!0,opacity:.9,depthWrite:!1}));n.visible=!1,t.add(n),this.pool.push({mesh:n,life:0,maxLife:.4})}for(let e=0;e<64;e++){const n=new et(new zt(.25,.25,.25),new Et({color:16770406,transparent:!0,opacity:1,depthWrite:!1}));n.visible=!1,t.add(n),this.sparkPool.push({mesh:n,vel:new C,life:0})}}explode(t,e=1,n=16737826){const i=this.pool.pop()||this.active.shift();i&&(i.mesh.visible=!0,i.mesh.position.copy(t),i.mesh.scale.setScalar(.5*e),i.mesh.material.color.setHex(n),i.mesh.material.opacity=.95,i.life=.45,i.maxLife=.45,this.active.push(i),this.burstSparks(t,n,Math.min(14,6+Math.floor(e*4))))}hitSpark(t,e=61695){this.burstSparks(t,e,6);const n=this.pool.pop();n&&(n.mesh.visible=!0,n.mesh.position.copy(t),n.mesh.scale.setScalar(.35),n.mesh.material.color.setHex(e),n.mesh.material.opacity=.9,n.life=.18,n.maxLife=.18,this.active.push(n))}burstSparks(t,e,n){for(let i=0;i<n;i++){const r=this.sparkPool.pop();if(!r)break;r.mesh.visible=!0,r.mesh.position.copy(t),r.mesh.material.color.setHex(e),r.mesh.material.opacity=1,r.vel.set(Math.random()-.5,Math.random()-.2,Math.random()-.5).normalize().multiplyScalar(12+Math.random()*28),r.life=.25+Math.random()*.25,this.sparks.push(r)}}update(t){for(let e=this.active.length-1;e>=0;e--){const n=this.active[e];n.life-=t;const i=1-n.life/n.maxLife;n.mesh.scale.setScalar((.5+i*4)*(n.maxLife<.25?.6:1)),n.mesh.material.opacity=Math.max(0,1-i),n.life<=0&&(n.mesh.visible=!1,this.active.splice(e,1),this.pool.push(n))}for(let e=this.sparks.length-1;e>=0;e--){const n=this.sparks[e];n.life-=t,n.mesh.position.addScaledVector(n.vel,t),n.vel.y-=18*t,n.mesh.scale.setScalar(Math.max(.1,n.life*3)),n.mesh.material.opacity=Math.max(0,n.life*3),n.life<=0&&(n.mesh.visible=!1,this.sparks.splice(e,1),this.sparkPool.push(n))}}dispose(){for(const t of[...this.pool,...this.active])this.scene.remove(t.mesh),t.mesh.geometry.dispose(),t.mesh.material.dispose();for(const t of[...this.sparkPool,...this.sparks])this.scene.remove(t.mesh),t.mesh.geometry.dispose(),t.mesh.material.dispose()}}class rg{constructor(t="dmg-floats"){T(this,"layer");T(this,"pool",[]);T(this,"active",[]);T(this,"tmp",new C);let e=document.getElementById(t);if(!e){e=document.createElement("div"),e.id=t;const n=document.getElementById("hud");n?n.appendChild(e):document.body.appendChild(e)}this.layer=e;for(let n=0;n<40;n++){const i=document.createElement("div");i.className="dmg-float hidden",this.layer.appendChild(i),this.pool.push(i)}}spawn(t,e,n="deal"){const i=Math.max(1,Math.round(e));if(i<=0&&n!=="kill")return;const r=this.acquireEl();r&&(r.className=`dmg-float dmg-${n}`,n==="kill"?r.textContent="DOWNED":n==="heal"?r.textContent=`+${i}`:r.textContent=`−${i}`,r.classList.remove("hidden"),this.active.push({el:r,world:t.clone(),life:n==="kill"?1.1:.85,maxLife:n==="kill"?1.1:.85,vy:28+Math.random()*18,jitterX:(Math.random()-.5)*24}))}acquireEl(){const t=this.pool.pop();if(t)return t;const e=this.active.shift();return e?(e.el.className="dmg-float hidden",e.el.style.opacity="0",e.el):null}update(t,e,n,i){for(let r=this.active.length-1;r>=0;r--){const a=this.active[r];if(a.life-=t,a.world.y+=a.vy*t*.02,this.tmp.copy(a.world).project(e),!(this.tmp.z>-1&&this.tmp.z<1&&Math.abs(this.tmp.x)<1.2&&Math.abs(this.tmp.y)<1.2)||a.life<=0){this.active.splice(r,1),a.el.className="dmg-float hidden",a.el.style.opacity="0",this.pool.push(a.el);continue}const l=(this.tmp.x*.5+.5)*n+a.jitterX,c=(-this.tmp.y*.5+.5)*i,h=1-a.life/a.maxLife,u=h*36,f=a.el.classList.contains("dmg-crit")||a.el.classList.contains("dmg-kill"),p=(f?1.25:1)*(1+(f?.12*(1-h):0)),g=h<.15?h/.15:Math.max(0,1-(h-.15)/.85);a.el.style.transform=`translate(-50%, -50%) translate(${l}px, ${c-u}px) scale(${p})`,a.el.style.opacity=String(g)}}clear(){for(;this.active.length;){const t=this.active.pop();t.el.className="dmg-float hidden",t.el.style.opacity="0",this.pool.push(t.el)}}}class ag{constructor(){T(this,"els",{hud:document.getElementById("hud"),alt:document.getElementById("hud-alt"),speed:document.getElementById("hud-speed"),time:document.getElementById("hud-time"),weapon:document.getElementById("hud-weapon"),ammo:document.getElementById("hud-ammo"),leaders:document.getElementById("hud-leaders"),health:document.getElementById("bar-health"),healthN:document.getElementById("bar-health-n"),shield:document.getElementById("bar-shield"),shieldN:document.getElementById("bar-shield-n"),burn:document.getElementById("bar-burn"),burnN:document.getElementById("bar-burn-n"),shieldPrompt:document.getElementById("shield-prompt"),hitMarker:document.getElementById("hit-marker"),killFeed:document.getElementById("kill-feed"),modeBanner:document.getElementById("mode-banner"),help:document.getElementById("help-card"),scoreboard:document.getElementById("scoreboard"),sbBody:document.getElementById("sb-body"),death:document.getElementById("death"),deathSub:document.getElementById("death-sub"),damageVignette:document.getElementById("damage-vignette"),clickToPlay:document.getElementById("click-to-play"),ctpTitle:document.getElementById("ctp-title"),ctpSub:document.getElementById("ctp-sub"),ctpHint:document.getElementById("ctp-hint"),radar:document.getElementById("radar-canvas"),debug:document.getElementById("debug-panel"),debugText:document.getElementById("debug-text"),biomeToast:document.getElementById("biome-toast"),lockBox:document.getElementById("missile-lock"),lockLabel:document.getElementById("missile-lock-label"),lockFill:document.getElementById("missile-lock-fill")});T(this,"radarCtx");T(this,"helpVisible",!0);T(this,"debugVisible",!1);T(this,"extraStyleInjected",!1);T(this,"dmgDirLayer",null);T(this,"incomingEl",null);T(this,"incomingActive",!1);T(this,"incomingToneCb",null);T(this,"incomingToneTimer",null);this.radarCtx=this.els.radar.getContext("2d")}show(t){this.els.hud.classList.toggle("hidden",!t),t&&this.els.help.classList.toggle("hidden",!this.helpVisible)}setClickToPlay(t,e="pause"){this.els.clickToPlay.classList.toggle("hidden",!t),this.els.clickToPlay.classList.toggle("mode-engage",e==="engage"),this.els.clickToPlay.classList.toggle("mode-pause",e==="pause");const n=document.getElementById("btn-resume"),i=document.getElementById("ctp-keys");if(this.els.ctpTitle&&(this.els.ctpTitle.textContent=e==="engage"?"CLICK TO ENGAGE":"PAUSED"),this.els.ctpSub&&(this.els.ctpSub.textContent=e==="engage"?"Click or Enter to take the stick":"Esc resume · Settings · Main Menu"),n&&(n.textContent=e==="engage"?"CLICK TO FLY":"RESUME"),i&&(i.textContent=e==="engage"?"Enter / Click · WASD fly · LMB fire · Esc pause · M mute":"Enter / Click Resume · Esc resume · M mute · Settings / Menu below"),t)try{n?.focus({preventScroll:!0})}catch{try{this.els.clickToPlay.focus({preventScroll:!0})}catch{}}}isPauseOpen(){return!this.els.clickToPlay.classList.contains("hidden")}setEngageHint(t){this.els.ctpHint&&(this.els.ctpHint.textContent=t??"",this.els.ctpHint.classList.toggle("hidden",!t))}setModeBanner(t){this.els.modeBanner.textContent=t}toggleHelp(){this.helpVisible=!this.helpVisible,this.els.help.classList.toggle("hidden",!this.helpVisible)}toggleDebug(){return this.debugVisible=!this.debugVisible,this.els.debug?.classList.toggle("hidden",!this.debugVisible),this.debugVisible}setDebugVisible(t){this.debugVisible=t,this.els.debug?.classList.toggle("hidden",!t)}isDebugVisible(){return this.debugVisible}updateDebug(t){!this.els.debugText||!this.debugVisible||(this.els.debugText.textContent=t.join(`
`))}showBiomeToast(t){this.flashToast(`ENTERING  ${t}`,this.els.biomeToast)}showPickupToast(t){this.flashToast(t,this.els.biomeToast)}flashToast(t,e){e&&(e.textContent=t,e.classList.remove("hidden","fade"),e.offsetWidth,e.classList.add("show"),window.setTimeout(()=>{e.classList.add("fade"),window.setTimeout(()=>e.classList.add("hidden"),600)},1600))}showScoreboard(t,e,n){if(this.els.scoreboard.classList.toggle("hidden",!t),!t)return;const i=[...e].sort((r,a)=>a.score-r.score||a.kills-r.kills);this.els.sbBody.innerHTML=i.map((r,a)=>`<tr${r.id===n?' class="me"':""}><td>${a+1}</td><td>${xl(r.callsign)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.score}</td><td>${r.ping}</td></tr>`).join("")}showDeath(t,e="Respawning…"){this.els.death.classList.toggle("hidden",!t),this.els.deathSub.textContent=e}flashHit(){this.els.hitMarker.classList.remove("hidden","show"),this.els.hitMarker.offsetWidth,this.els.hitMarker.classList.add("show"),setTimeout(()=>this.els.hitMarker.classList.add("hidden"),180)}flashDamage(){this.els.damageVignette.classList.add("flash"),setTimeout(()=>this.els.damageVignette.classList.remove("flash"),160)}pushKill(t,e,n){const i=document.createElement("div");for(i.className="kill-line",i.textContent=`${t}  [${n}]  ${e}`,this.els.killFeed.prepend(i);this.els.killFeed.children.length>5;)this.els.killFeed.lastChild?.remove();setTimeout(()=>i.remove(),5e3)}updateFlight(t,e,n,i,r,a,o){this.els.alt.innerHTML=`${vl(Math.round(t))}<span class="unit">m</span>`;const l=Math.round(e*3.6);this.els.speed.innerHTML=`${vl(l)}<span class="unit">km/h</span>`,this.els.time.textContent=og(n),this.els.health.style.width=`${Nr(r/100)*100}%`,this.els.healthN.textContent=String(Math.round(r)),this.els.shield.style.width=`${Nr(a/100)*100}%`,this.els.shieldN.textContent=String(Math.round(a)),this.els.burn.style.width=`${Nr(i/100)*100}%`,this.els.burnN.textContent=String(Math.round(i)),this.els.shieldPrompt.classList.toggle("hidden",!o)}updateWeapon(t,e){const n=Fe[t];this.els.weapon.textContent=n.name,this.els.ammo.textContent=e<0?"∞":String(e)}updateMissileLock(t,e,n,i){const r=this.els.lockBox;if(r){if(!t||e==="off"){r.classList.add("hidden"),r.classList.remove("locking","locked","seeking");return}if(r.classList.remove("hidden"),r.classList.toggle("seeking",e==="seeking"),r.classList.toggle("locking",e==="locking"),r.classList.toggle("locked",e==="locked"),this.els.lockFill){const a=Math.round(Math.max(0,Math.min(1,n))*100);this.els.lockFill.style.width=`${a}%`}this.els.lockLabel&&(this.els.lockLabel.textContent=e==="locked"?"LOCK":e==="locking"?"LOCKING…":"SEEK"),i?(r.style.left=`${i.x}px`,r.style.top=`${i.y}px`,r.style.transform="translate(-50%, -50%)"):(r.style.left="50%",r.style.top="48%",r.style.transform="translate(-50%, -50%)")}}updateLeaders(t,e){const n=[...t].sort((i,r)=>r.score-i.score||r.kills-i.kills).slice(0,4);this.els.leaders.innerHTML=n.map((i,r)=>`<div class="${i.id===e?"me":""}">${r+1}. ${xl(i.callsign)}  ${i.score}</div>`).join("")}drawRadar(t,e,n,i){const r=this.radarCtx,a=this.els.radar.width,o=this.els.radar.height,l=a/2,c=o/2,h=a/2-4;r.clearRect(0,0,a,o),r.fillStyle="rgba(0, 20, 40, 0.75)",r.beginPath(),r.arc(l,c,h,0,Math.PI*2),r.fill(),r.strokeStyle="rgba(0, 240, 255, 0.45)",r.lineWidth=1.5,r.stroke(),r.strokeStyle="rgba(0, 240, 255, 0.15)";for(const p of[.33,.66])r.beginPath(),r.arc(l,c,h*p,0,Math.PI*2),r.stroke();r.strokeStyle="rgba(0, 240, 255, 0.35)",r.beginPath(),r.moveTo(l,c),r.lineTo(l,c-h),r.stroke();const u=Math.cos(-e),f=Math.sin(-e);for(const p of n){let g=p.x-t.x,_=p.z-t.z;const m=g*u-_*f,d=g*f+_*u;let S=m/i*h,w=-d/i*h;const v=Math.hypot(S,w);v>h-3&&(S=S/v*(h-3),w=w/v*(h-3)),r.fillStyle=p.isPlayer?"#00f0ff":p.friendly?"#39ff88":"#ff2bd6",r.beginPath(),r.arc(l+S,c+w,p.isPlayer?3.5:2.5,0,Math.PI*2),r.fill()}}showDamageFrom(t,e=1){if(!Number.isFinite(t))return;this.ensureExtraStyles();const n=this.ensureDmgDirLayer(),i=Math.max(.15,Math.min(1,e)),r=document.createElement("div");r.className="nv-dmg-arc";const a=t*180/Math.PI;r.style.transform=`translate(-50%, -50%) rotate(${a}deg)`;const o=document.createElement("i");o.style.borderTopWidth=`${(3+3*i).toFixed(1)}px`,o.style.boxShadow=`0 0 ${Math.round(10+14*i)}px ${Math.round(1+2*i)}px rgba(255,20,50,${(.4+.4*i).toFixed(2)})`,r.appendChild(o),n.appendChild(r),window.setTimeout(()=>r.remove(),820)}setIncomingLockToneHook(t){this.incomingToneCb=t}setIncomingLock(t){if(t===this.incomingActive){t&&this.incomingEl&&!this.incomingEl.classList.contains("on")&&this.incomingEl.classList.add("on");return}this.incomingActive=t,this.ensureExtraStyles(),this.ensureIncomingEl().classList.toggle("on",t),this.incomingToneTimer!==null&&(window.clearInterval(this.incomingToneTimer),this.incomingToneTimer=null),t&&(this.incomingToneCb?.(),this.incomingToneTimer=window.setInterval(()=>{this.incomingActive&&this.incomingToneCb?.()},600))}ensureDmgDirLayer(){if(this.dmgDirLayer&&this.dmgDirLayer.isConnected)return this.dmgDirLayer;const t=document.createElement("div");return t.className="nv-dmg-layer",this.els.hud.appendChild(t),this.dmgDirLayer=t,t}ensureIncomingEl(){if(this.incomingEl&&this.incomingEl.isConnected)return this.incomingEl;const t=document.createElement("div");t.className="nv-incoming";const e=document.createElement("div");e.className="nv-inc-warn",e.textContent="⚠ MISSILE LOCK";const n=document.createElement("div");return n.className="nv-inc-sub",n.textContent="INCOMING — EVADE",t.appendChild(e),t.appendChild(n),this.els.hud.appendChild(t),this.incomingEl=t,t}ensureExtraStyles(){if(this.extraStyleInjected)return;if(document.getElementById("nv-hud-extra-style")){this.extraStyleInjected=!0;return}const t=document.createElement("style");t.id="nv-hud-extra-style",t.textContent=[".nv-dmg-layer{position:absolute;inset:0;pointer-events:none;z-index:13;overflow:hidden}",".nv-dmg-arc{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;will-change:transform}",".nv-dmg-arc>i{position:absolute;left:50%;bottom:30vmin;transform:translateX(-50%);width:30vmin;height:9vmin;border:0 solid transparent;border-top:5px solid #ff2b3c;border-radius:50%;box-shadow:0 0 16px 2px rgba(255,20,50,.6);opacity:0;animation:nv-dmg-flash .72s ease-out forwards}","@keyframes nv-dmg-flash{0%{opacity:0;transform:translateX(-50%) scale(.82)}12%{opacity:1}100%{opacity:0;transform:translateX(-50%) scale(1.06)}}",'.nv-incoming{position:absolute;top:20%;left:50%;transform:translateX(-50%);z-index:16;display:none;flex-direction:column;align-items:center;gap:4px;pointer-events:none;font-family:"Orbitron",system-ui,sans-serif;text-align:center}',".nv-incoming.on{display:flex;animation:nv-inc-pulse .6s ease-in-out infinite}",".nv-inc-warn{font-size:1.15rem;font-weight:800;letter-spacing:.26em;color:#ff2f3f;text-shadow:0 0 12px rgba(255,20,40,.85),0 0 3px #000;border:2px solid #ff2f3f;padding:5px 14px 5px 18px;background:rgba(30,0,8,.55);box-shadow:0 0 18px rgba(255,20,40,.5),inset 0 0 12px rgba(255,0,30,.3);border-radius:3px}",".nv-inc-sub{font-size:.56rem;letter-spacing:.3em;color:#ff8080;text-shadow:0 0 8px rgba(255,40,60,.7)}","@keyframes nv-inc-pulse{0%,100%{opacity:.55}50%{opacity:1}}"].join(""),(document.head||document.documentElement).appendChild(t),this.extraStyleInjected=!0}}function vl(s){return String(Math.max(0,s)).padStart(3,"0")}function og(s){const t=Math.max(0,Math.floor(s)),e=Math.floor(t/60),n=t%60;return`${String(e).padStart(2,"0")}:${String(n).padStart(2,"0")}`}function Nr(s){return Math.max(0,Math.min(1,s))}function xl(s){return s.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}const Fr=["VEX-9","NULLSTAR","KITE","PHANTOM","RYU-0","GHOSTLINE","HEXA","ORBIT","SAKURA","DRIFT","NOVA","REDLINE","ASH-7","VECTOR","MIRAGE","ION","WRAITH","PULSE"];class yl{constructor(){T(this,"localId","local");T(this,"players",new Map);T(this,"pilotBase",12)}async connect(t){this.players.clear(),this.players.set(this.localId,this.makePlayer(this.localId,t||"PILOT",!1,0)),this.pilotBase=10+Math.floor(Math.random()*18)}disconnect(){this.players.clear()}spawnBots(t,e){for(const[n,i]of this.players)i.isBot&&this.players.delete(n);for(let n=0;n<t;n++){const i=`bot-${n}`,r=e?n%2+1:0,a=Fr[n%Fr.length]+(n>=Fr.length?`-${n}`:"");this.players.set(i,this.makePlayer(i,a,!0,r))}}getPlayers(){return[...this.players.values()]}getLocal(){return this.players.get(this.localId)}getPlayer(t){return this.players.get(t)}pushLocal(t){const e=this.players.get(this.localId);e&&Object.assign(e,t)}updatePlayer(t,e){const n=this.players.get(t);n&&Object.assign(n,e)}onKill(t){const e=this.players.get(t.killerId),n=this.players.get(t.victimId);e&&(e.kills++,e.score+=100),n&&(n.deaths++,n.alive=!1,n.health=0)}getPilotCount(){return this.pilotBase+this.players.size}tick(t){for(const e of this.players.values())e.isBot?e.ping=20+Math.floor(Math.random()*40):e.ping=12+Math.floor(Math.random()*8)}makePlayer(t,e,n,i){return{id:t,callsign:e,team:i,position:[0,40,0],rotation:[0,0,0,1],velocity:[0,0,0],health:100,shield:100,shieldDeployed:!1,weapon:"plasma",kills:0,deaths:0,score:0,alive:!0,isBot:n,ping:n?30:15}}}const lg="modulepreload",cg=function(s,t){return new URL(s,t).href},Ml={},hg=function(t,e,n){let i=Promise.resolve();if(e&&e.length>0){let a=function(h){return Promise.all(h.map(u=>Promise.resolve(u).then(f=>({status:"fulfilled",value:f}),f=>({status:"rejected",reason:f}))))};const o=document.getElementsByTagName("link"),l=document.querySelector("meta[property=csp-nonce]"),c=l?.nonce||l?.getAttribute("nonce");i=a(e.map(h=>{if(h=cg(h,n),h in Ml)return;Ml[h]=!0;const u=h.endsWith(".css"),f=u?'[rel="stylesheet"]':"";if(!!n)for(let _=o.length-1;_>=0;_--){const m=o[_];if(m.href===h&&(!u||m.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${h}"]${f}`))return;const g=document.createElement("link");if(g.rel=u?"stylesheet":lg,u||(g.as="script"),g.crossOrigin="",g.href=h,c&&g.setAttribute("nonce",c),document.head.appendChild(g),u)return new Promise((_,m)=>{g.addEventListener("load",_),g.addEventListener("error",()=>m(new Error(`Unable to preload CSS for ${h}`)))})}))}function r(a){const o=new Event("vite:preloadError",{cancelable:!0});if(o.payload=a,window.dispatchEvent(o),!o.defaultPrevented)throw a}return i.then(a=>{for(const o of a||[])o.status==="rejected"&&r(o.reason);return t().catch(r)})};class ug{constructor(t,e,n){this.url=t,this.anonKey=e,this.gameId=n||"ffg",this._rand=Math.floor(Math.random()*1e9).toString(36),this.id=Date.now().toString(36)+"_"+this._rand,this.handlers={},this.sb=null,this.channel=null,this.lobby=null,this.host=null,this.room=null,this.peerPresent=!1,this._paired=!1}on(t,e){return(this.handlers[t]=this.handlers[t]||[]).push(e),this}_emit(t,e){(this.handlers[t]||[]).forEach(n=>{try{n(e||{})}catch{}})}async connect(){if(this.sb)return this.sb;const t=await hg(()=>import("https://esm.sh/@supabase/supabase-js@2"),[],import.meta.url),e=t.createClient||t.default&&t.default.createClient;return this.sb=e(this.url,this.anonKey,{realtime:{params:{eventsPerSecond:12}}}),this.sb}async joinRoom(t,e){await this.connect(),this.room=String(t).toUpperCase(),e!=null&&(this.host=!!e);const n=this.sb.channel("ffg:"+this.gameId+":"+this.room,{config:{broadcast:{self:!1,ack:!1},presence:{key:this.id}}});return this.channel=n,n.on("broadcast",{event:"msg"},({payload:i})=>{!i||i.from===this.id||this._emit("msg",{from:i.from,t:i.t,d:i.d})}),n.on("presence",{event:"sync"},()=>{const i=n.presenceState(),r=Object.keys(i),a=r.length>=2;a&&this.host==null&&(this.host=this.id===r.slice().sort()[0]),a!==this.peerPresent&&(this.peerPresent=a,this._emit("peer",{present:a,count:r.length}))}),await new Promise(i=>{n.subscribe(async r=>{r==="SUBSCRIBED"?(await n.track({id:this.id,at:this.id}),this._emit("open",{room:this.room,host:this.host}),i()):(r==="CHANNEL_ERROR"||r==="TIMED_OUT")&&(this._emit("error",{status:r}),i())})}),this.room}async quickMatch(t){await this.connect();const e=this.sb.channel("ffg-lobby:"+this.gameId,{config:{presence:{key:this.id}}});return this.lobby=e,new Promise(n=>{let i=!1;const r=async()=>{if(i)return;const a=Object.keys(e.presenceState()).sort();if(a.length>=2){const o=a[0],l=a[1];if(this.id===o||this.id===l){i=!0;const c=(o.slice(-4)+l.slice(-4)).toUpperCase();this.host=this.id===o,await this.joinRoom(c,this.host),this._emit("matched",{room:c,host:this.host}),n({room:c,host:this.host}),setTimeout(()=>{try{e.untrack(),this.sb.removeChannel(e)}catch{}this.lobby===e&&(this.lobby=null)},4e3)}}};e.on("presence",{event:"sync"},r),e.on("presence",{event:"join"},r),e.subscribe(async a=>{a==="SUBSCRIBED"&&(await e.track({id:this.id}),r())}),t&&setTimeout(()=>{if(!i){i=!0;try{this.sb.removeChannel(e)}catch{}this._emit("timeout",{}),n(null)}},t)})}send(t,e){return this.channel?(this.channel.send({type:"broadcast",event:"msg",payload:{from:this.id,t,d:e||{}}}),!0):!1}isHost(){return!!this.host}leave(){try{this.channel&&this.sb.removeChannel(this.channel)}catch{}try{this.lobby&&this.sb.removeChannel(this.lobby)}catch{}this.channel=this.lobby=null,this.peerPresent=!1}}const dg="https://wugoxdewcdxzfppgzohy.supabase.co",fg="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves",Or=["VEX-9","NULLSTAR","KITE","PHANTOM","RYU-0","GHOSTLINE","HEXA","ORBIT","SAKURA","DRIFT","NOVA","REDLINE"],pg=66;class mg{constructor(t){T(this,"localId");T(this,"roomMapId",null);T(this,"players",new Map);T(this,"net");T(this,"roster",[]);T(this,"interp",new Map);T(this,"lastSeen",new Map);T(this,"tState",0);T(this,"base",8+Math.floor(Math.random()*10));T(this,"started",!1);T(this,"sessionMap");this.net=new ug(dg,fg,"neon-veil"),this.localId=this.net.id,this.sessionMap=t}async connect(t){this.players.clear(),await this._lobby(t);for(const n of this.roster){const i=n.peer===this.localId,r=this._make(n.peer,n.name,!1,0);r.netRemote=!i,this.players.set(n.peer,r)}this.players.has(this.localId)||this.players.set(this.localId,this._make(this.localId,t||"PILOT",!1,0)),this.net.on("msg",n=>this._recv(n.from,n.t,n.d));const e=()=>{try{this.net.leave()}catch{}};window.addEventListener("pagehide",e),window.addEventListener("beforeunload",e)}disconnect(){try{this.net.leave()}catch{}this.players.clear(),this.interp.clear()}spawnBots(t,e){for(const[n,i]of this.players)i.isBot&&this.players.delete(n);for(let n=0;n<t;n++){const i=`bot-${this.localId}-${n}`,r=e?n%2+1:0;this.players.set(i,this._make(i,Or[n%Or.length]+(n>=Or.length?`-${n}`:""),!0,r))}}getPlayers(){return[...this.players.values()]}getLocal(){return this.players.get(this.localId)}getPlayer(t){return this.players.get(t)}pushLocal(t){const e=this.players.get(this.localId);e&&Object.assign(e,t)}updatePlayer(t,e){const n=this.players.get(t);n&&Object.assign(n,e)}onKill(t){const e=this.players.get(t.killerId),n=this.players.get(t.victimId);e&&(e.kills++,e.score+=100),n&&(n.deaths++,n.alive=!1,n.health=0),this.net.send("kill",{k:t.killerId,v:t.victimId})}getPilotCount(){return this.base+this.players.size}tick(t){const e=typeof performance<"u"?performance.now():Date.now();for(const i of this.players.values()){if(!i.netRemote)continue;const r=this.interp.get(i.id);r&&r.b&&this._interp(i,r,e)}const n=this.players.get(this.localId);n&&e-this.tState>pg&&(this.tState=e,this.net.send("st",{x:+n.position[0].toFixed(2),y:+n.position[1].toFixed(2),z:+n.position[2].toFixed(2),qx:+n.rotation[0].toFixed(3),qy:+n.rotation[1].toFixed(3),qz:+n.rotation[2].toFixed(3),qw:+n.rotation[3].toFixed(3),vx:+n.velocity[0].toFixed(2),vy:+n.velocity[1].toFixed(2),vz:+n.velocity[2].toFixed(2),h:Math.round(n.health),s:Math.round(n.shield),w:n.weapon,a:n.alive?1:0,k:n.kills,d:n.deaths,sc:n.score}));for(const i of this.players.values())i.ping=i.netRemote?24+Math.floor(Math.random()*30):14+Math.floor(Math.random()*8)}_recv(t,e,n){if(!n)return;const i=typeof performance<"u"?performance.now():Date.now();if(e==="st"){const r=this.players.get(t);if(!r||!r.netRemote)return;r.health=n.h,r.shield=n.s,r.weapon=n.w,r.alive=n.a===1,r.kills=n.k,r.deaths=n.d,r.score=n.sc;let a=this.interp.get(t);a||this.interp.set(t,a={a:null,b:null}),a.a=a.b,a.b={pos:[n.x,n.y,n.z],rot:[n.qx,n.qy,n.qz,n.qw],vel:[n.vx,n.vy,n.vz],at:i},this.lastSeen.set(t,i)}else if(e==="kill"){const r=this.players.get(n.k),a=this.players.get(n.v);r&&(r.kills++,r.score+=100),a&&(a.deaths++,a.alive=!1,a.health=0)}else if(e==="bye"){const r=this.players.get(t);r&&(r.alive=!1)}}_interp(t,e,n){const i=e.b,r=e.a||e.b,a=Math.max(1,i.at-r.at),o=Math.min(1,Math.max(0,(n-i.at)/a)),l=Math.min(.1,Math.max(0,(n-i.at)/1e3));for(let c=0;c<3;c++)t.position[c]=r.pos[c]+(i.pos[c]-r.pos[c])*o+i.vel[c]*l;t.rotation=o<.5?r.rot.slice():i.rot.slice(),t.velocity=i.vel.slice()}_lobby(t){return new Promise(e=>{const n=this.net,i=new Map;i.set(n.id,{name:t||"PILOT",peer:n.id}),this._injectStyle();const r=document.createElement("div");r.className="nv-lobby",r.innerHTML=`<div class="nv-lobby-box">
        <div class="nv-lobby-title">PLAY ONLINE</div>
        <div id="nv-lstatus" class="nv-lstatus">Finding a match…</div>
        <div id="nv-lplayers" class="nv-lplayers"></div>
        <div class="nv-lrow"><input id="nv-lcode" class="nv-linput" maxlength="4" placeholder="CODE" autocomplete="off"/><button id="nv-ljoin" class="nv-lbtn">JOIN</button></div>
        <div class="nv-lrow"><button id="nv-lcreate" class="nv-lbtn">CREATE ROOM</button><button id="nv-lstart" class="nv-lbtn nv-lprimary" disabled>START</button></div>
      </div>`,(document.getElementById("app")||document.body).appendChild(r);const a=h=>r.querySelector("#"+h),o=h=>{a("nv-lstatus").textContent=h},l=()=>{a("nv-lplayers").innerHTML=[...i.values()].map((f,p)=>`<div>${p===0?"★ ":""}${(f.name||"PILOT").toUpperCase()}</div>`).join("");const h=n.isHost(),u=a("nv-lstart");u.disabled=!h||!n.room,u.textContent=h?`START · ${i.size}P`:"WAITING…"},c=(h,u)=>{this.started=!0,this.roster=h,this.roomMapId=u,r.remove(),e()};n.on("open",()=>{o(`Room ${n.room} · share the code`),n.send("hello",{name:i.get(n.id).name,peer:n.id}),l()}),n.on("peer",l),n.on("msg",h=>{this.started||(h.t==="hello"?(i.set(h.from,{name:h.d.name,peer:h.from}),n.send("hello",{name:i.get(n.id).name,peer:n.id}),l()):h.t==="start"&&c(h.d.roster,h.d.mapId))}),a("nv-lcreate").addEventListener("click",async()=>{o("Creating room…"),await n.joinRoom(this._code(),!0)}),a("nv-ljoin").addEventListener("click",async()=>{const h=(a("nv-lcode").value||"").trim().toUpperCase();h.length>=3&&(o(`Joining ${h}…`),await n.joinRoom(h,!1))}),a("nv-lstart").addEventListener("click",()=>{if(!n.isHost())return;const u=[...i.keys()].sort((f,p)=>f===n.id?-1:p===n.id?1:f<p?-1:1).slice(0,8).map(f=>({peer:f,name:i.get(f).name}));n.send("start",{roster:u,mapId:this.sessionMap}),c(u,this.sessionMap)}),n.quickMatch(8e3).then(h=>{this.started||(h?(o(`Matched · room ${h.room}`),n.send("hello",{name:i.get(n.id).name,peer:n.id}),l()):o("No quick match — CREATE or JOIN a code"))})})}_code(){const t="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let e="";for(let n=0;n<4;n++)e+=t[Math.floor(Math.random()*t.length)];return e}_make(t,e,n,i){return{id:t,callsign:e,team:i,position:[0,40,0],rotation:[0,0,0,1],velocity:[0,0,0],health:100,shield:100,shieldDeployed:!1,weapon:"plasma",kills:0,deaths:0,score:0,alive:!0,isBot:n,ping:n?30:15}}_injectStyle(){if(document.getElementById("nv-lobby-style"))return;const t=document.createElement("style");t.id="nv-lobby-style",t.textContent=`
    .nv-lobby{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:#04000ccc;backdrop-filter:blur(4px);font-family:"Share Tech Mono",monospace}
    .nv-lobby-box{width:min(400px,92vw);padding:1.4rem 1.5rem;background:rgba(8,4,22,.94);border:1px solid #00f0ff;border-radius:14px;box-shadow:0 0 46px #00f0ff22;color:#e8f7ff;text-align:center}
    .nv-lobby-title{font-family:"Orbitron",sans-serif;font-weight:800;letter-spacing:.16em;color:#00f0ff;margin-bottom:.5rem}
    .nv-lstatus{font-size:.72rem;color:#ffe566;min-height:1.2em;margin-bottom:.7rem}
    .nv-lplayers{display:flex;flex-direction:column;gap:.25rem;margin-bottom:.8rem;min-height:1.5em;font-size:.72rem;color:#c8dcff}
    .nv-lrow{display:flex;gap:.5rem;margin-top:.5rem}
    .nv-lbtn{flex:1;padding:.6rem;border-radius:7px;cursor:pointer;font-family:"Orbitron",sans-serif;font-weight:700;letter-spacing:.1em;font-size:.7rem;border:1px solid #00f0ff55;background:#00f0ff14;color:#e8ffff}
    .nv-lbtn:disabled{opacity:.5;cursor:default}
    .nv-lprimary{border-color:#ff2bd6;background:#ff2bd61f}
    .nv-linput{flex:1;padding:.6rem;background:#00000066;border:1px solid #00f0ff66;border-radius:6px;color:#fff;letter-spacing:.3em;text-align:center;text-transform:uppercase;font-family:inherit}`,document.head.appendChild(t)}}class gg{constructor(){T(this,"root",document.getElementById("menu"));T(this,"callsign",document.getElementById("callsign"));T(this,"pilotCount",document.getElementById("pilot-count"));T(this,"status",document.getElementById("menu-status"));T(this,"mapId","sky-city");T(this,"onStart",null);T(this,"onSettings",null);T(this,"starting",!1);const t=localStorage.getItem("neonveil_callsign");t&&(this.callsign.value=t),document.querySelectorAll(".mode-btn[data-mode]").forEach(i=>{i.addEventListener("click",()=>{const r=i.dataset.mode;this.start(r)})}),document.querySelectorAll(".map-pill").forEach(i=>{i.addEventListener("click",()=>{document.querySelectorAll(".map-pill").forEach(r=>r.classList.remove("active")),i.classList.add("active"),this.mapId=i.dataset.map})}),document.getElementById("btn-settings-menu")?.addEventListener("click",()=>{this.onSettings?.()});const e=1+$s.botCount,n=()=>{const i=e+Math.floor(Math.random()*3)-1;this.pilotCount.textContent=String(Math.max(e-1,i))};setInterval(n,4e3),n(),this.setStatus(`SELECT A MODE · FFA ${1+$s.botCount}/SECTOR · ROAM ${1+sc.rivalCount}/SECTOR · 2× ARENAS · RINGS = TRAVEL`)}onStartGame(t){this.onStart=t}onOpenSettings(t){this.onSettings=t}show(t){this.root.classList.toggle("hidden",!t),t&&(this.starting=!1)}setStatus(t){this.status&&(this.status.textContent=t)}start(t){if(this.starting)return;if(!this.onStart){this.setStatus("ENGINE NOT READY — REFRESH PAGE");return}this.starting=!0;const e=(this.callsign.value.trim()||"PILOT").slice(0,16).toUpperCase();localStorage.setItem("neonveil_callsign",e),this.setStatus(`LAUNCHING ${t.toUpperCase()}…`),this.onStart({callsign:e,mode:t,mapId:this.mapId})}}class _g{constructor(t){T(this,"root",document.getElementById("settings"));T(this,"sens",document.getElementById("set-sens"));T(this,"vol",document.getElementById("set-vol"));T(this,"invert",document.getElementById("set-invert"));T(this,"mute",document.getElementById("set-mute"));T(this,"onChange",null);this.sens.value=String(t.mouseSens),this.vol.value=String(t.volume),this.invert.checked=t.invertY,this.mute.checked=t.mute;const e=()=>{this.onChange?.(this.read())};this.sens.addEventListener("input",e),this.vol.addEventListener("input",e),this.invert.addEventListener("change",e),this.mute.addEventListener("change",e),document.getElementById("btn-settings-close")?.addEventListener("click",()=>this.show(!1))}onSettingsChange(t){this.onChange=t}read(){return{mouseSens:parseFloat(this.sens.value)||1,volume:parseFloat(this.vol.value)||0,invertY:this.invert.checked,mute:this.mute.checked}}setMute(t){this.mute.checked=t}show(t){this.root.classList.toggle("hidden",!t)}toggle(){this.show(this.root.classList.contains("hidden"))}}class vg{constructor(){T(this,"root",document.getElementById("results"));T(this,"title",document.getElementById("results-title"));T(this,"stats",document.getElementById("results-stats"));T(this,"onMenu",null);document.getElementById("btn-results-menu")?.addEventListener("click",()=>{this.show(!1),this.onMenu?.()})}onReturn(t){this.onMenu=t}showResults(t,e){this.title.textContent=t,this.stats.innerHTML=e.map(n=>`<div>${n}</div>`).join(""),this.show(!0)}show(t){this.root.classList.toggle("hidden",!t)}}class xg{constructor(){T(this,"root",document.getElementById("loading"));T(this,"fill",document.getElementById("loading-fill"));T(this,"text",document.getElementById("loading-text"))}show(t){this.root.classList.toggle("hidden",!t)}set(t,e){this.fill.style.width=`${Math.round(t*100)}%`,this.text.textContent=e}}class yg{constructor(){T(this,"canvas");T(this,"renderer");T(this,"scene",new Am);T(this,"camera");T(this,"clock",new Om);T(this,"input");T(this,"settings",{...dl});T(this,"menu",new gg);T(this,"settingsUI");T(this,"results",new vg);T(this,"loading",new xg);T(this,"hud",new ag);T(this,"audio");T(this,"net",new yl);T(this,"map");T(this,"flight",new Gm);T(this,"localPawn");T(this,"weapons");T(this,"missileLock",new qm);T(this,"shield",new Ym);T(this,"effects");T(this,"dmgFloats",new rg);T(this,"bots",[]);T(this,"pickups",new ng);T(this,"biomeInstances",new Map);T(this,"mode","freeroam");T(this,"mapId","sky-city");T(this,"playing",!1);T(this,"matchTime",0);T(this,"matchLimit",0);T(this,"lives",tn.lives);T(this,"outlawRound",0);T(this,"outlawKillsNeeded",0);T(this,"outlawKills",0);T(this,"respawnTimer",-1);T(this,"dead",!1);T(this,"scoreboardOpen",!1);T(this,"tmpV",new C);T(this,"tmpV2",new C);T(this,"tmpQ",new ln);T(this,"aimOrigin",new C);T(this,"aimDir",new C);T(this,"collNormal",new C);T(this,"prevWeaponKeys",new Set);T(this,"frame",0);T(this,"portalCooldown",0);T(this,"traveling",!1);T(this,"fpsAccum",0);T(this,"fpsFrames",0);T(this,"fps",0);T(this,"_f3Latch",!1);T(this,"_hLatch",!1);T(this,"_escLatch",!1);T(this,"_mLatch",!1);T(this,"pauseMode","engage");T(this,"mirrorLeftCam");T(this,"mirrorRightCam");T(this,"mirrorLeftRT");T(this,"mirrorRightRT");T(this,"mirrorLeftCanvas");T(this,"mirrorRightCanvas");T(this,"mirrorLeftCtx");T(this,"mirrorRightCtx");T(this,"mirrorBuf",new Uint8Array(12288*4));T(this,"animate",()=>{requestAnimationFrame(this.animate);const t=Math.min(this.clock.getDelta(),.05);this.fpsAccum+=t,this.fpsFrames++,this.fpsAccum>=.4&&(this.fps=this.fpsFrames/this.fpsAccum,this.fpsAccum=0,this.fpsFrames=0),this.playing&&this.update(t),this.render()});T(this,"onResize",()=>{const t=window.innerWidth,e=window.innerHeight;this.camera.aspect=t/e,this.camera.updateProjectionMatrix(),this.renderer.setSize(t,e)});if(this.canvas=document.getElementById("game-canvas"),!this.canvas)throw new Error("Missing #game-canvas");try{this.renderer=new Tm({canvas:this.canvas,antialias:!0,powerPreference:"high-performance"})}catch(n){throw new Error(`WebGL init failed: ${n instanceof Error?n.message:String(n)}`)}this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75)),this.renderer.setSize(window.innerWidth,window.innerHeight),this.renderer.outputColorSpace=Be,this.renderer.toneMapping=wl,this.renderer.toneMappingExposure=1.05,this.camera=new Ie(de.fovNormal,window.innerWidth/window.innerHeight,.1,2e3),this.input=new Bm(this.canvas),this.audio=new zm(this.settings),this.settingsUI=new _g(this.settings),this.map=new tg(this.scene,"sky-city"),this.localPawn=new rc(61695,!0),this.scene.add(this.localPawn.group),this.weapons=new Xm(this.scene),this.effects=new sg(this.scene),this.scene.add(this.pickups.group),this.mirrorLeftCam=new Ie(50,4/3,.5,400),this.mirrorRightCam=new Ie(50,4/3,.5,400),this.mirrorLeftRT=new Sn(128,96),this.mirrorRightRT=new Sn(128,96),this.mirrorLeftCanvas=document.createElement("canvas"),this.mirrorLeftCanvas.width=128,this.mirrorLeftCanvas.height=96,this.mirrorRightCanvas=document.createElement("canvas"),this.mirrorRightCanvas.width=128,this.mirrorRightCanvas.height=96;const t=document.getElementById("mirror-left"),e=document.getElementById("mirror-right");t&&t.appendChild(this.mirrorLeftCanvas),e&&e.appendChild(this.mirrorRightCanvas),this.mirrorLeftCtx=this.mirrorLeftCanvas.getContext("2d"),this.mirrorRightCtx=this.mirrorRightCanvas.getContext("2d"),this.bindUI(),window.addEventListener("resize",this.onResize),this.menu.show(!0),this.menu.setStatus("SELECT A MODE TO LAUNCH"),this.animate(),requestAnimationFrame(()=>{requestAnimationFrame(()=>{try{this.map.load("sky-city")}catch(n){console.warn("[NEON VEIL] warmup map load failed",n)}})})}bindUI(){this.menu.onStartGame(i=>void this.startSession(i)),this.menu.onOpenSettings(()=>this.settingsUI.show(!0)),this.settingsUI.onSettingsChange(i=>{this.settings=i,this.audio.applySettings(i),localStorage.setItem("neonveil_settings",JSON.stringify(i))}),this.results.onReturn(()=>this.returnToMenu());const t=localStorage.getItem("neonveil_settings");if(t)try{this.settings={...dl,...JSON.parse(t)},this.audio.applySettings(this.settings)}catch{}const e=()=>this.resumeFromPause();document.getElementById("btn-resume")?.addEventListener("click",i=>{i.preventDefault(),i.stopPropagation(),e()}),document.getElementById("btn-pause-settings")?.addEventListener("click",i=>{i.preventDefault(),i.stopPropagation(),this.settingsUI.show(!0)}),document.getElementById("btn-pause-menu")?.addEventListener("click",i=>{i.preventDefault(),i.stopPropagation(),this.hud.setClickToPlay(!1),this.returnToMenu()}),document.getElementById("click-to-play")?.addEventListener("keydown",i=>{(i.code==="Enter"||i.code==="Space")&&(i.preventDefault(),e())}),this.wireForgeFlowShell()}wireForgeFlowShell(){const t=window;t.__PAUSE__={toggle:()=>{this.playing&&(this.hud.isPauseOpen()?this.resumeFromPause():this.openPauseMenu("pause"))},pause:()=>{this.playing&&!this.hud.isPauseOpen()&&this.openPauseMenu("pause")},resume:()=>{this.playing&&this.hud.isPauseOpen()&&this.resumeFromPause()}},window.addEventListener("mutechange",(e=>{const n=!!(e.detail&&e.detail.muted);this.settings={...this.settings,mute:n},this.settingsUI.setMute(n),this.audio.applySettings(this.settings);try{localStorage.setItem("neonveil_settings",JSON.stringify(this.settings))}catch{}}));try{window.__CONTROLS__?.isMuted?.()&&(this.settings={...this.settings,mute:!0},this.settingsUI.setMute(!0),this.audio.applySettings(this.settings))}catch{}}resumeFromPause(){this.audio.unlock(),this.input.engage(),this.hud.setClickToPlay(!1),this.hud.setEngageHint(this.input.lockError),this.settingsUI.show(!1)}openPauseMenu(t="pause"){this.pauseMode=t,this.input.disengage(),this.settingsUI.show(!1),this.hud.setClickToPlay(!0,t)}async startSession(t){this.mode=t.mode,this.mapId=t.mapId,this.menu.show(!1),this.results.show(!1),this.loading.show(!0),this.loading.set(.08,"Linking thrusters…");try{if(await $i(),this.net=t.mode==="multiplayer"?new mg(t.mapId):new yl,window.__NV={game:this,net:this.net},await this.net.connect(t.callsign),t.mode==="multiplayer"){const n=this.net.roomMapId;n&&(t.mapId=n)}this.loading.set(.25,"Building neon skyline…"),await $i(),this.biomeInstances.clear(),this.clearBots(),this.map.load(t.mapId),this.audio.setBiomeMusic(t.mapId),this.pickups.spawnForMap(this.map.def.bounds,In.mapCount),this.loading.set(.65,"Calibrating weapons…"),await $i(),this.populateBiomeInstance(t.mapId,!0);const e=this.map.randomSpawn();this.flight.reset(e,Math.random()*Math.PI*2),this.shield.reset(),this.weapons.unlocked=new Set(["plasma"]),this.weapons.ammo.laser=0,this.weapons.ammo.torpedo=0,this.weapons.ammo.scatter=0,this.weapons.refill(),this.weapons.select("plasma"),this.dead=!1,this.respawnTimer=-1,this.matchTime=0,this.lives=tn.lives,this.outlawRound=0,this.outlawKills=0,t.mode==="multiplayer"?(this.matchLimit=$s.matchTime,this.hud.setModeBanner(`FFA · ${this.alivePilotCount()} IN THIS SECTOR · RINGS = OTHER SECTORS`)):t.mode==="outlaw"?(this.matchLimit=tn.roundTime,this.outlawKillsNeeded=tn.targetsPerRound[0],this.hud.setModeBanner(`OUTLAW HUNT · ROUND 1/${tn.rounds}`)):(this.matchLimit=0,this.hud.setModeBanner(`FREE ROAM · ${this.alivePilotCount()} HERE · RINGS TRAVEL TO OTHER SECTORS`)),this.net.pushLocal({callsign:t.callsign,alive:!0,health:fe.maxHealth,shield:fe.maxShield,kills:0,deaths:0,score:0}),this.loading.set(1,"Ready"),await Br(200),this.loading.show(!1),this.playing=!0,this.input.disengage(),this.hud.show(!0),this.openPauseMenu("engage"),this.hud.setEngageHint(null),this.clock.start()}catch(e){console.error("[NEON VEIL] startSession failed",e),this.loading.set(0,"Launch fault — returning to menu"),await Br(900),this.loading.show(!1),this.playing=!1,this.hud.show(!1),this.menu.show(!0);const n=e instanceof Error?e.message:String(e);this.menu.setStatus(`LAUNCH FAILED: ${n}`)}}returnToMenu(){this.playing=!1,this.hud.show(!1),this.hud.showDeath(!1),this.hud.setClickToPlay(!1),this.input.disengage(),this.stashCurrentBiome(),this.clearBots(),this.biomeInstances.clear(),this.menu.show(!0)}clearBots(){for(const t of this.bots)this.scene.remove(t.pawn.group),t.dispose();this.bots=[]}desiredRivalCount(){return this.mode==="multiplayer"?$s.botCount:this.mode==="outlaw"?this.outlawKillsNeeded||tn.targetsPerRound[0]:sc.rivalCount}alivePilotCount(){return 1+this.bots.filter(t=>t.state.alive).length}spawnBotPawns(){this.clearBots();const t=[16722902,16739115,3800968,16770406,11167487,43775,16746700,6750156];let e=0;for(const n of this.net.getPlayers()){if(!n.isBot&&!n.netRemote)continue;const i=new _l(n,t[e%t.length],e),r=this.map.randomSpawn();i.respawn(r),this.scene.add(i.pawn.group),this.bots.push(i),e++}}stashCurrentBiome(){if(!this.mapId)return;const t=[16722902,16739115,3800968,16770406,11167487,43775,16746700,6750156],e=this.bots.map((n,i)=>{let r=t[i%t.length];const a=n.marker.children[0]?.material;return a?.color&&(r=a.color.getHex()),{callsign:n.state.callsign,color:r,personaIndex:i,position:[n.state.position[0],n.state.position[1],n.state.position[2]],health:n.state.health,shield:n.state.shield,kills:n.state.kills,deaths:n.state.deaths,score:n.state.score,alive:n.state.alive}});this.biomeInstances.set(this.mapId,{rivals:e,pickups:this.pickups.exportState()})}populateBiomeInstance(t,e){const n=e?void 0:this.biomeInstances.get(t),i=this.desiredRivalCount(),r=[16722902,16739115,3800968,16770406,11167487,43775,16746700,6750156];if(!n||n.rivals.length===0){this.net.spawnBots(i,!1),this.spawnBotPawns(),this.stashCurrentBiome();return}this.net.spawnBots(n.rivals.length,!1);const a=this.net.getPlayers().filter(o=>o.isBot);this.clearBots();for(let o=0;o<a.length;o++){const l=n.rivals[o],c=a[o];if(!l||!c)continue;c.callsign=l.callsign,c.health=l.health,c.shield=l.shield,c.kills=l.kills,c.deaths=l.deaths,c.score=l.score,c.alive=l.alive,c.position=[...l.position];const h=new _l(c,l.color||r[o%r.length],l.personaIndex);l.alive?(h.respawn(new C(...l.position)),h.state.health=l.health,h.state.shield=l.shield,h.state.kills=l.kills,h.state.deaths=l.deaths,h.state.score=l.score):(h.state.alive=!1,h.pawn.group.visible=!1),this.scene.add(h.pawn.group),this.bots.push(h)}if(this.bots.length<i&&this.mode!=="outlaw")this.net.spawnBots(i,!1),this.spawnBotPawns();else if(this.mode!=="outlaw")for(const o of this.bots)o.state.alive||o.respawn(this.map.randomSpawn());this.pickups.importState(n.pickups)}ensureRivalPopulation(){const t=this.desiredRivalCount();if(this.mode!=="outlaw"){for(const e of this.bots)e.state.alive||e.respawn(this.map.randomSpawn());this.bots.length<t&&(this.net.spawnBots(t,!1),this.spawnBotPawns())}}update(t){if(this.handleUIKeys(),!this.dead&&!this.input.isControlActive()&&!this.hud.isPauseOpen()&&!this.traveling&&this.openPauseMenu(this.pauseMode==="engage"?"engage":"pause"),!this.dead&&this.input.isControlActive()&&this.input.lockError&&this.hud.setEngageHint(this.input.lockError),this.dead){this.respawnTimer-=t,this.hud.showDeath(!0,`Respawning in ${Math.ceil(Math.max(0,this.respawnTimer))}…`),this.respawnTimer<=0&&this.doRespawn(),this.weapons.update(t),this.effects.update(t),this.dmgFloats.update(t,this.camera,window.innerWidth,window.innerHeight),this.updateBots(t),this.syncLocalState(),this.updateHud(t),this.input.endFrame();return}const e=this.tmpV2.copy(this.flight.position);this.flight.update(t,this.input,this.settings,this.map.def.minAlt,this.map.def.maxAlt,this.map.def.bounds);const n=this.tmpV.copy(this.flight.position);this.flight.position.copy(e);const i=e.distanceTo(n),r=Math.max(1,Math.min(12,Math.ceil(i/1.25))),a=t/r;let o=0;for(let g=0;g<r;g++)this.flight.integrateSubstep(a),this.map.city.resolveSolid(this.flight.position,1.55,this.collNormal,5)&&(o=Math.max(o,this.flight.bounce(this.collNormal)));this.map.city.resolveSolid(this.flight.position,1.55,this.collNormal,4)&&(o=Math.max(o,this.flight.bounce(this.collNormal))),this.flight.clampWorld(this.map.def.minAlt,this.map.def.maxAlt,this.map.def.bounds),o>4&&(this.applyDamageToLocal(o,"world"),this.audio.playHit());const l=this.shield.update(t,this.input.isDown("KeyF"));l==="up"&&this.audio.playShieldUp(),l==="down"&&this.audio.playShieldDown(),this.localPawn.setShield(this.shield.deployed),this.input.wheel&&this.weapons.cycle(this.input.wheel>0?1:-1);for(const[g,_]of[["Digit1",1],["Digit2",2],["Digit3",3],["Digit4",4],["Digit5",5],["Digit6",6]])this.input.isDown(g)&&!this.prevWeaponKeys.has(g)&&this.weapons.trySelectSlot(_);this.prevWeaponKeys=new Set([...this.input.keys].filter(g=>g.startsWith("Digit")));const c=[...this.bots.map(g=>({id:g.state.id,position:g.pawn.group.position,alive:g.state.alive})),{id:this.net.localId,position:this.flight.position,alive:!this.dead&&this.net.getLocal().alive}];this.weapons.update(t,c),this.updateMissileLock(t),this.input.isMouseDown(0)&&this.input.isControlActive()&&this.tryPlayerFire(),this.pickups.update(t);const h=this.pickups.tryCollect(this.flight.position,In.collectRadius);h&&this.applyPickup(h),this.resolveProjectiles(),this.localPawn.setTransform(this.flight.position,this.flight.quaternion),this.localPawn.setBoost(this.flight.boosting?1:this.flight.speed/de.maxSpeed),this.localPawn.group.visible=!0;const u=this.flight.zooming?45:this.flight.boosting?de.fovBoost:de.fovNormal;this.camera.fov=qt.lerp(this.camera.fov,u,1-Math.exp(-8*t)),this.camera.updateProjectionMatrix(),this.camera.position.copy(this.flight.position),this.flight.getCameraQuaternion(this.tmpQ),this.camera.quaternion.copy(this.tmpQ),this.camera.position.addScaledVector(this.tmpV.set(0,.15,.1).applyQuaternion(this.camera.quaternion),1),this.audio.setEngineThrust(qt.clamp(this.flight.speed/de.maxSpeed,0,1),this.flight.boosting),this.syncLocalState(),this.updateBots(t),this.effects.update(t),this.dmgFloats.update(t,this.camera,window.innerWidth,window.innerHeight);const f=[{pos:this.flight.position,id:this.net.localId},...this.bots.filter(g=>g.state.alive).map(g=>({pos:g.pawn.group.position,id:g.state.id}))],p=this.map.update(t,f);for(const g of p)if(g.kind==="lightning"){let _=this.net.localId,m=this.flight.position.distanceToSquared(g.position);for(const d of this.bots){if(!d.state.alive)continue;const S=d.pawn.group.position.distanceToSquared(g.position);S<m&&(m=S,_=d.state.id)}if(_===this.net.localId&&m<400)this.applyDamageToLocal(g.damage,"world"),this.flight.applyStun(g.stun),this.hud.showPickupToast("LIGHTNING STRIKE!"),this.audio.playHit(),this.effects.hitSpark(this.flight.position,11193599);else{const d=this.bots.find(S=>S.state.id===_);d&&m<400&&(d.takeDamage(g.damage),this.effects.hitSpark(d.pawn.group.position,11193599))}}else if(g.kind==="meteor"){if(this.flight.position.distanceTo(g.position)<8)this.applyDamageToLocal(g.damage,"world"),this.flight.applyStun(g.stun),this.audio.playExplosion(),this.effects.explode(g.position,2,16737826);else for(const _ of this.bots)if(_.state.alive&&_.pawn.group.position.distanceTo(g.position)<8){const m=_.takeDamage(g.damage);this.effects.explode(g.position,2,16737826),m&&this.onKill("world",_.state.id,"rocket",_.pawn.group.position);break}}for(const g of this.map.atmosphere.getSolidSpheres())this.flight.position.distanceTo(g.pos)<g.radius+1.5&&(this.tmpV.copy(this.flight.position).sub(g.pos).normalize(),this.tmpV.lengthSq()<.01&&this.tmpV.set(0,1,0),this.collNormal.copy(this.tmpV),this.flight.position.addScaledVector(this.collNormal,g.radius+1.6-this.flight.position.distanceTo(g.pos)),this.flight.bounce(this.collNormal,.6));if(this.net.tick(t),this.portalCooldown=Math.max(0,this.portalCooldown-t),!this.traveling&&this.portalCooldown<=0&&!this.dead){const g=this.map.checkPortal(this.flight.position);g&&this.travelPortal(g.target,g.label)}this.matchTime+=t,this.updateModeLogic(),this.updateHud(t),this.input.endFrame()}async travelPortal(t,e){if(!(this.traveling||t===this.mapId)){this.traveling=!0,this.portalCooldown=3;try{this.hud.showBiomeToast(e),this.audio.playWarp(),this.loading.show(!0),this.loading.set(.15,"Leaving sector…"),await $i(),this.stashCurrentBiome(),this.clearBots(),this.mapId=t,this.map.load(t),this.audio.setBiomeMusic(t),this.pickups.spawnForMap(this.map.def.bounds,In.mapCount),this.loading.set(.55,`Entering ${e} instance…`),await $i(),this.populateBiomeInstance(t,!1);const n=this.map.randomSpawn();this.flight.reset(n,Math.random()*Math.PI*2),this.hud.setModeBanner(`${e} · ${this.alivePilotCount()} PILOTS IN THIS SECTOR`),this.loading.set(1,"Ready"),await Br(180),this.loading.show(!1)}catch(n){console.error("[NEON VEIL] portal travel failed",n),this.loading.show(!1)}finally{this.traveling=!1,this.portalCooldown=2.5}}}handleUIKeys(){const t=e=>this.input.isDown(e);if(t("KeyH")&&!this._hLatch?(this.hud.toggleHelp(),this._hLatch=!0):t("KeyH")||(this._hLatch=!1),t("F3")&&!this._f3Latch?(this.hud.toggleDebug(),this._f3Latch=!0):t("F3")||(this._f3Latch=!1),this.scoreboardOpen=t("Tab")&&this.input.isControlActive(),this.hud.showScoreboard(this.scoreboardOpen&&this.playing,this.net.getPlayers(),this.net.localId),t("Escape")&&this.playing?this._escLatch||(this._escLatch=!0,!document.getElementById("settings")?.classList.contains("hidden")?this.settingsUI.show(!1):this.input.isControlActive()?this.openPauseMenu("pause"):this.hud.isPauseOpen()?this.pauseMode==="pause"?this.resumeFromPause():this.resumeFromPause():this.openPauseMenu("pause")):t("Escape")||(this._escLatch=!1),t("KeyM")&&!this._mLatch){this._mLatch=!0;const e=document.activeElement?.tagName;!!!window.__CONTROLS__?.toggleMute&&e!=="INPUT"&&e!=="TEXTAREA"&&this.toggleMuteLocal()}else t("KeyM")||(this._mLatch=!1)}toggleMuteLocal(){const t=!this.settings.mute;this.settings={...this.settings,mute:t},this.settingsUI.setMute(t),this.audio.applySettings(this.settings);try{localStorage.setItem("neonveil_settings",JSON.stringify(this.settings))}catch{}}updateMissileLock(t){const e=this.weapons.current==="rocket";this.flight.getAimDirection(this.aimDir),this.aimOrigin.copy(this.flight.position);const n=this.missileLock.update(t,e&&this.input.isControlActive()&&!this.dead,this.aimOrigin,this.aimDir,this.bots.map(r=>({id:r.state.id,position:r.pawn.group.position,alive:r.state.alive})),(r,a)=>this.map.city.lineOfSight(r,a));n==="tick"?this.audio.playLockTick(this.missileLock.progress):n==="locked"?this.audio.playLockTone():n==="lost"&&this.audio.playLockLost();let i=null;e&&this.missileLock.targetId&&(this.missileLock.phase==="locking"||this.missileLock.phase==="locked")&&(this.tmpV.copy(this.missileLock.targetPos).project(this.camera),this.tmpV.z>-1&&this.tmpV.z<1&&(i={x:(this.tmpV.x*.5+.5)*window.innerWidth,y:(-this.tmpV.y*.5+.5)*window.innerHeight})),this.hud.updateMissileLock(e&&this.input.isControlActive(),e?this.missileLock.phase:"off",this.missileLock.progress,i)}tryPlayerFire(){this.flight.getAimDirection(this.aimDir),this.applyAimAssist(this.aimDir),this.aimOrigin.copy(this.flight.position).addScaledVector(this.aimDir,2.2),this.aimOrigin.y-=.1;const t=this.weapons.current;if(t==="rocket"&&!this.missileLock.locked)return;const e=this.weapons.fire(this.net.localId,this.aimOrigin,this.aimDir,{lockTargetId:t==="rocket"||t==="torpedo"?this.missileLock.targetId:null,requireLock:t==="rocket"});if(e&&(t==="plasma"?this.audio.playPlasma():t==="rocket"||t==="torpedo"?this.audio.playRocket():t==="laser"?this.audio.playLaser():t==="scatter"?this.audio.playScatter():this.audio.playRail(),t==="rocket"&&(this.missileLock.reset(),this.hud.updateMissileLock(!0,"seeking",0,null)),e.hitscan))for(const n of e.hitscan)this.resolveHitscan(n.ownerId,n.origin,n.direction,n.damage,n.weapon)}applyPickup(t){const e=this.net.getLocal(),n=this.flight.position.clone();n.y+=2;const i=In.respawnSec;if(t.kind==="weapon"&&t.weapon){const r=t.weapon==="rocket"?In.rocketPickupAmmo:t.amount>1?t.amount:Fe[t.weapon].ammo;this.weapons.grantWeapon(t.weapon,r),this.hud.showPickupToast(`${t.label} · crate back in ${i}s`),this.audio.playPickup()}else t.kind==="health"?(e.health=Math.min(fe.maxHealth,e.health+t.amount),this.hud.showPickupToast(`HULL +${t.amount} · crate ${i}s`),this.dmgFloats.spawn(n,t.amount,"heal"),this.audio.playPickup()):t.kind==="shield"?(this.shield.charge=Math.min(fe.maxShield,this.shield.charge+t.amount),e.shield=this.shield.charge,this.hud.showPickupToast(`SHIELD +${t.amount} · crate ${i}s`),this.dmgFloats.spawn(n,t.amount,"heal"),this.audio.playPickup()):t.kind==="ammo"&&(this.weapons.grantAmmoAll(.6),this.hud.showPickupToast(`AMMO RELOAD · crate ${i}s`),this.audio.playPickup())}applyAimAssist(t){const e=fe.aimAssistCone,n=fe.aimAssistRange,i=fe.aimAssist;let r=Math.cos(e),a=null;for(const o of this.bots){if(!o.state.alive)continue;this.tmpV.copy(o.pawn.group.position).sub(this.flight.position);const l=this.tmpV.length();if(l<4||l>n)continue;this.tmpV.multiplyScalar(1/l);const c=t.dot(this.tmpV);c>r&&(r=c,a=this.tmpV2.copy(this.tmpV))}a&&t.lerp(a,i).normalize()}resolveHitscan(t,e,n,i,r){let a=r==="laser"?280:400,o=null;for(const c of this.bots){if(!c.state.alive||c.state.id===t)continue;const h=this.rayHitSphere(e,n,c.pawn.group.position,fe.enemyHitscanRadius);h>=0&&h<a&&(a=h,o=c)}if(t!==this.net.localId&&this.net.getLocal().alive){const c=this.rayHitSphere(e,n,this.flight.position,fe.localHitRadius);c>=0&&c<a&&(a=c,o="local")}if(!o)return;const l=o==="local"?this.flight.position:o.pawn.group.position;if(this.map.city.lineOfSight(e,l))if(o==="local")this.applyDamageToLocal(i,t,r);else{const c=o.pawn.group.position.clone();c.y+=1.5;const h=o.takeDamage(i);this.reportEnemyHit(t,i,c,r,h,o.state.id)}}reportEnemyHit(t,e,n,i,r,a){const o=e>=70||i==="rail"||i==="torpedo";t===this.net.localId&&(this.hud.flashHit(),this.dmgFloats.spawn(n,e,o?"crit":"deal"),this.effects.hitSpark(n,o?16770406:61695),o?this.audio.playCrit():this.audio.playHitConfirm()),r&&this.onKill(t,a,i,n)}rayHitSphere(t,e,n,i){const r=this.tmpV.copy(t).sub(n),a=r.dot(e),o=r.dot(r)-i*i,l=a*a-o;if(l<0)return-1;const c=-a-Math.sqrt(l);return c>=0?c:-1}resolveProjectiles(){for(const t of this.weapons.pool){if(!t.active)continue;if(this.map.city.collideSphere(t.position,.4,this.collNormal)||t.position.y<.5){this.detonateProjectile(t);continue}const e=fe.enemyHitRadius+(t.weapon==="rocket"||t.weapon==="torpedo"?.35:0);for(const n of this.bots)if(!(!n.state.alive||n.state.id===t.ownerId)&&n.pawn.group.position.distanceTo(t.position)<e){this.detonateProjectile(t,n);break}t.active&&t.ownerId!==this.net.localId&&this.net.getLocal().alive&&this.flight.position.distanceTo(t.position)<fe.localHitRadius&&this.detonateProjectile(t,"local")}}detonateProjectile(t,e){const n=t.position.clone(),i=t.weapon,r=t.ownerId,a=t.splash,o=t.damage,l=t.selfDamageScale;this.weapons.deactivate(t);const c=i==="rocket"||i==="torpedo"?16737826:i==="scatter"?16770406:61695;this.effects.explode(n,a>0?2.2:1.1,c),this.audio.playExplosion();const h=(u,f)=>{let p=o;if(a>0){const g=1-qt.clamp(f/a,0,1);p=o*g}if(!(p<1))if(u==="local")r===this.net.localId&&(p*=l),p>0&&this.applyDamageToLocal(p,r,i);else{if(r===u.state.id&&(p*=l),p<=0)return;const g=u.pawn.group.position.clone();g.y+=1.5;const _=u.takeDamage(p);this.reportEnemyHit(r,p,g,i,_,u.state.id)}};if(e&&h(e,0),a>0){for(const u of this.bots){if(!u.state.alive||e&&e!=="local"&&u===e)continue;const f=u.pawn.group.position.distanceTo(n);f<a&&h(u,f)}if(this.net.getLocal().alive&&e!=="local"){const u=this.flight.position.distanceTo(n);u<a&&h("local",u)}}}applyDamageToLocal(t,e,n="plasma"){if(this.dead)return;const i=this.shield.charge,r=this.shield.deployed,a=this.shield.absorb(t),o=t-a,l=this.net.getLocal();l.health=Math.max(0,l.health-a),l.shield=this.shield.charge,l.shieldDeployed=this.shield.deployed,this.hud.flashDamage();const c=this.flight.position.clone();c.y+=1.2,c.x+=(Math.random()-.5)*2,a>.5?(this.dmgFloats.spawn(c,a,"take"),this.audio.playHit(),this.effects.hitSpark(c,16722902)):(o>.5||r||i>this.shield.charge)&&(this.dmgFloats.spawn(c,Math.max(o,t*.3),"shield"),this.audio.playShieldHit()),l.health<=0&&this.onLocalDeath(e,n)}onLocalDeath(t,e){const n=this.net.getLocal();n.alive=!1,n.deaths++,this.dead=!0,this.respawnTimer=fe.respawnDelay,this.effects.explode(this.flight.position.clone(),3,16722902),this.audio.playDeath(),this.localPawn.group.visible=!1;const i=this.net.getPlayers().find(a=>a.id===t),r=i?.callsign??(t==="world"?"CITY":"UNKNOWN");this.hud.pushKill(r,n.callsign,Fe[e]?.name??e),i&&t!==this.net.localId&&(i.kills++,i.score+=100),this.mode==="outlaw"&&(this.lives--,this.lives<=0&&this.endOutlaw(!1))}onKill(t,e,n,i){this.effects.explode(i.clone(),2.5,16722902),this.audio.playExplosion();const r=this.net.getPlayers().find(l=>l.id===t),a=this.net.getPlayers().find(l=>l.id===e);if(this.hud.pushKill(r?.callsign??"???",a?.callsign??"???",Fe[n]?.name??n),t===this.net.localId){this.dmgFloats.spawn(i.clone().add(new C(0,2,0)),0,"kill"),this.audio.playKill();const l=this.net.getLocal();l.kills++,l.score+=100,this.mode==="outlaw"&&this.outlawKills++}const o=this.bots.find(l=>l.state.id===e);o&&setTimeout(()=>{this.playing&&(this.mode==="outlaw"?this.bots.filter(c=>c.state.alive).length===0&&this.outlawKills>=this.outlawKillsNeeded&&this.nextOutlawRound():(o.respawn(this.map.randomSpawn()),this.ensureRivalPopulation()))},fe.respawnDelay*1e3)}doRespawn(){if(this.mode==="outlaw"&&this.lives<=0)return;const t=this.map.randomSpawn();this.flight.reset(t),this.shield.reset(),this.weapons.refill(),this.dead=!1,this.respawnTimer=-1,this.hud.showDeath(!1),this.localPawn.group.visible=!0,this.net.pushLocal({alive:!0,health:fe.maxHealth,shield:fe.maxShield,shieldDeployed:!1})}updateBots(t){const e=this.net.getPlayers();for(const n of this.bots){if(n.state.netRemote){n.syncFromState();continue}n.update(t,e,this.map.def.bounds,this.map.def.minAlt,this.map.def.maxAlt,(r,a,o)=>{const l=this.weapons.current,c=this.weapons.unlocked.has(o);this.weapons.unlocked.add(o),this.weapons.select(o);const h=this.weapons.ammo[o];this.weapons.ammo[o]=o==="plasma"?-1:99;const u=this.weapons.cooldown;this.weapons.cooldown=0;const f=this.weapons.fire(n.state.id,r,a,{lockTargetId:o==="rocket"||o==="torpedo"?n.targetId:null,requireLock:!1});if(this.weapons.cooldown=u,this.weapons.ammo[o]=h,this.weapons.select(l),c||this.weapons.unlocked.delete(o),f?.hitscan)for(const p of f.hitscan)this.resolveHitscan(n.state.id,r,a,p.damage,o)},(r,a)=>this.map.city.lineOfSight(r,a));const i=n.pawn.group.position;for(let r=0;r<5&&this.map.city.resolveSolid(i,1.7,this.collNormal,3);r++)n.deflect(this.collNormal);if(n.writeState(),n.state.alive){const r=this.map.city.lineOfSight(this.camera.position,n.pawn.group.position);n.setTrackerVisible(r),n.pawn.group.visible=!0,n.pawn.body.visible=r,n.pawn.shieldMesh.visible=r&&n.state.shieldDeployed}else n.setTrackerVisible(!1)}}syncLocalState(){const t=this.flight.quaternion;this.net.pushLocal({position:this.flight.position.toArray(),rotation:[t.x,t.y,t.z,t.w],velocity:this.flight.velocity.toArray(),health:this.net.getLocal().health,shield:this.shield.charge,shieldDeployed:this.shield.deployed,weapon:this.weapons.current,alive:!this.dead})}updateModeLogic(){this.mode==="multiplayer"&&this.matchLimit>0&&this.matchTime>=this.matchLimit&&this.endMultiplayer(),this.mode==="outlaw"&&this.matchLimit>0&&this.matchTime>=this.matchLimit&&(this.outlawKills>=this.outlawKillsNeeded?this.nextOutlawRound():this.endOutlaw(!1))}nextOutlawRound(){if(this.outlawRound++,this.outlawRound>=tn.rounds){this.endOutlaw(!0);return}this.outlawKills=0,this.outlawKillsNeeded=tn.targetsPerRound[this.outlawRound]??6,this.matchTime=0,this.matchLimit=tn.roundTime,this.net.spawnBots(this.outlawKillsNeeded,!1),this.spawnBotPawns(),this.hud.setModeBanner(`OUTLAW HUNT · ROUND ${this.outlawRound+1}/${tn.rounds}`),this.weapons.refill()}endOutlaw(t){this.playing=!1,this.input.disengage(),this.hud.show(!1);const e=this.net.getLocal(),n=Math.floor(Math.max(0,this.matchLimit-this.matchTime)*tn.timeBonusPerSec);this.results.showResults(t?"BOUNTY COMPLETE":"HUNT FAILED",[`CALLSIGN  ${e.callsign}`,`KILLS  ${e.kills}`,`DEATHS  ${e.deaths}`,`SCORE  ${e.score+(t?n:0)}`,`LIVES LEFT  ${Math.max(0,this.lives)}`,t?`TIME BONUS  +${n}`:"OUT OF TIME OR LIVES"])}endMultiplayer(){this.playing=!1,this.input.disengage(),this.hud.show(!1);const t=[...this.net.getPlayers()].sort((i,r)=>r.score-i.score),e=this.net.getLocal(),n=t.findIndex(i=>i.id===e.id)+1;this.results.showResults("MATCH OVER",[`RANK  #${n}`,`CALLSIGN  ${e.callsign}`,`KILLS  ${e.kills}`,`DEATHS  ${e.deaths}`,`SCORE  ${e.score}`])}updateHud(t){const e=this.net.getLocal(),n=this.matchLimit>0?Math.max(0,this.matchLimit-this.matchTime):this.matchTime;this.hud.updateFlight(this.flight.position.y,this.flight.speed,n,this.flight.energy,e.health,this.shield.charge,this.shield.fullyCharged),this.hud.updateWeapon(this.weapons.current,this.weapons.ammo[this.weapons.current]),this.hud.updateLeaders(this.net.getPlayers(),this.net.localId);const i=[];for(const r of this.net.getPlayers()){if(r.id===e.id){i.push({x:r.position[0],z:r.position[2],friendly:!0,isPlayer:!0});continue}r.alive&&(this.tmpV.set(r.position[0],r.position[1],r.position[2]),this.map.city.lineOfSight(this.camera.position,this.tmpV)&&i.push({x:r.position[0],z:r.position[2],friendly:r.team!==0&&r.team===e.team,isPlayer:!1}))}for(const r of this.map.portals.blips())i.push({x:r.x,z:r.z,friendly:!0,isPlayer:!1});for(const r of this.pickups.blips())i.push({x:r.x,z:r.z,friendly:!0,isPlayer:!1});if(this.hud.drawRadar({x:this.flight.position.x,z:this.flight.position.z},this.flight.euler.y,i,this.map.def.bounds*.6),this.hud.isDebugVisible()){const r=this.renderer.info,a=this.flight.position,o=this.bots.filter(l=>l.state.alive).map(l=>l.mood[0]).join("");this.hud.updateDebug(["Neon Veil  DEBUG  [F3]",`FPS        ${this.fps.toFixed(1)}`,`BIOME      ${this.map.def.name} (${this.mapId})`,`POS        ${a.x.toFixed(1)}  ${a.y.toFixed(1)}  ${a.z.toFixed(1)}`,`SPEED      ${this.flight.speed.toFixed(1)} m/s`,`WEAPON     ${this.weapons.current}  ammo=${this.weapons.ammo[this.weapons.current]}`,`M-LOCK     ${this.missileLock.phase}  ${(this.missileLock.progress*100).toFixed(0)}%  tgt=${this.missileLock.targetId??"-"}`,`BUILDINGS  ${this.map.city.buildingCount}`,`COLLIDERS  ${this.map.city.colliders.length}`,`PORTALS    ${this.map.portals.portals.length}`,`CRATES     ${this.pickups.pickups.filter(l=>l.alive).length}`,`DRAW CALLS ${r.render.calls}`,`TRIANGLES  ${r.render.triangles}`,`SECTOR     ${this.mapId}  instances=${this.biomeInstances.size+1}`,`RIVALS     ${this.bots.filter(l=>l.state.alive).length}  moods=${o||"-"}`,`ENGAGED    ${this.input.engaged?"yes":"no"}  lock=${this.input.pointerLocked?"yes":"no"}`,`PIXEL RATIO ${this.renderer.getPixelRatio().toFixed(2)}`])}}render(){this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera),this.playing&&(this.frame++,this.frame%2===0&&this.renderMirrors())}renderMirrors(){const t=this.flight.position,e=this.flight.euler;this.mirrorLeftCam.position.copy(t),this.mirrorLeftCam.position.y+=.3,this.mirrorLeftCam.quaternion.setFromEuler(new ze(0,e.y+Math.PI*.75,0,"YXZ")),this.mirrorRightCam.position.copy(t),this.mirrorRightCam.position.y+=.3,this.mirrorRightCam.quaternion.setFromEuler(new ze(0,e.y-Math.PI*.75,0,"YXZ")),this.renderer.setRenderTarget(this.mirrorLeftRT),this.renderer.render(this.scene,this.mirrorLeftCam),this.renderer.setRenderTarget(this.mirrorRightRT),this.renderer.render(this.scene,this.mirrorRightCam),this.renderer.setRenderTarget(null),this.blitRT(this.mirrorLeftRT,this.mirrorLeftCtx),this.blitRT(this.mirrorRightRT,this.mirrorRightCtx)}blitRT(t,e){try{this.renderer.readRenderTargetPixels(t,0,0,128,96,this.mirrorBuf);const n=e.createImageData(128,96);for(let i=0;i<96;i++)for(let r=0;r<128;r++){const a=((95-i)*128+r)*4,o=(i*128+r)*4;n.data[o]=this.mirrorBuf[a],n.data[o+1]=this.mirrorBuf[a+1],n.data[o+2]=this.mirrorBuf[a+2],n.data[o+3]=255}e.putImageData(n,0,0)}catch{}}}function Br(s){return new Promise(t=>setTimeout(t,s))}function $i(){return new Promise(s=>requestAnimationFrame(()=>s()))}function Mg(s){const t=s instanceof Error?`${s.message}
${s.stack??""}`:String(s);console.error("[Neon Veil] boot failed",s);const e=document.createElement("div");e.id="boot-error",e.style.cssText="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#0a0614;color:#ff8ad8;font:14px/1.5 ui-monospace,monospace;padding:2rem;text-align:left",e.innerHTML=`<div style="max-width:640px;border:1px solid #00f0ff;padding:1.5rem;border-radius:10px;background:rgba(8,4,20,0.92)"><div style="color:#00f0ff;letter-spacing:0.12em;margin-bottom:0.75rem">Neon Veil · BOOT FAULT</div><pre style="white-space:pre-wrap;word-break:break-word;color:#e8f7ff;font-size:12px">${t.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</pre><p style="margin-top:1rem;color:#aab;font-size:12px">Open DevTools (F12) → Console. Serve via Vite, not file://.</p></div>`,document.body.appendChild(e)}try{const s=new yg;console.info("%cNeon Veil","color:#00f0ff;font-size:16px;font-weight:bold","— Outlaw skies. Zero voice.")}catch(s){Mg(s)}
