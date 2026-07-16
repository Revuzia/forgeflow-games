(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))n(i);new MutationObserver(i=>{for(const r of i)if(r.type==="childList")for(const a of r.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&n(a)}).observe(document,{childList:!0,subtree:!0});function e(i){const r={};return i.integrity&&(r.integrity=i.integrity),i.referrerPolicy&&(r.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?r.credentials="include":i.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function n(i){if(i.ep)return;i.ep=!0;const r=e(i);fetch(i.href,r)}})();/**
 * @license
 * Copyright 2010-2024 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const Ta="170",ic=0,Za=1,sc=2,gl=1,rc=2,pn=3,Dn=0,ye=1,he=2,Ln=0,yi=1,Ja=2,Qa=3,to=4,ac=5,qn=100,oc=101,lc=102,cc=103,hc=104,uc=200,dc=201,fc=202,pc=203,Fr=204,Or=205,mc=206,gc=207,_c=208,vc=209,xc=210,Mc=211,yc=212,Sc=213,Ec=214,Br=0,kr=1,zr=2,wi=3,Hr=4,Vr=5,Gr=6,Wr=7,_l=0,wc=1,bc=2,In=0,Tc=1,Ac=2,Rc=3,vl=4,Cc=5,Pc=6,Lc=7,xl=300,bi=301,Ti=302,Xr=303,qr=304,$s=306,Yr=1e3,$n=1001,$r=1002,Ve=1003,Ic=1004,ss=1005,rn=1006,er=1007,Kn=1008,xn=1009,Ml=1010,yl=1011,Qi=1012,Aa=1013,jn=1014,an=1015,es=1016,Ra=1017,Ca=1018,Ai=1020,Sl=35902,El=1021,wl=1022,tn=1023,bl=1024,Tl=1025,Si=1026,Ri=1027,Pa=1028,La=1029,Al=1030,Ia=1031,Da=1033,Ns=33776,Fs=33777,Os=33778,Bs=33779,Kr=35840,jr=35841,Zr=35842,Jr=35843,Qr=36196,ta=37492,ea=37496,na=37808,ia=37809,sa=37810,ra=37811,aa=37812,oa=37813,la=37814,ca=37815,ha=37816,ua=37817,da=37818,fa=37819,pa=37820,ma=37821,ks=36492,ga=36494,_a=36495,Rl=36283,va=36284,xa=36285,Ma=36286,Dc=3200,Uc=3201,Cl=0,Nc=1,Cn="",Oe="srgb",Pi="srgb-linear",Ks="linear",Jt="srgb",ei=7680,eo=519,Fc=512,Oc=513,Bc=514,Pl=515,kc=516,zc=517,Hc=518,Vc=519,ya=35044,no="300 es",gn=2e3,Hs=2001;class Li{addEventListener(t,e){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[t]===void 0&&(n[t]=[]),n[t].indexOf(e)===-1&&n[t].push(e)}hasEventListener(t,e){if(this._listeners===void 0)return!1;const n=this._listeners;return n[t]!==void 0&&n[t].indexOf(e)!==-1}removeEventListener(t,e){if(this._listeners===void 0)return;const i=this._listeners[t];if(i!==void 0){const r=i.indexOf(e);r!==-1&&i.splice(r,1)}}dispatchEvent(t){if(this._listeners===void 0)return;const n=this._listeners[t.type];if(n!==void 0){t.target=this;const i=n.slice(0);for(let r=0,a=i.length;r<a;r++)i[r].call(this,t);t.target=null}}}const Ee=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];let io=1234567;const ji=Math.PI/180,ts=180/Math.PI;function _n(){const s=Math.random()*4294967295|0,t=Math.random()*4294967295|0,e=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Ee[s&255]+Ee[s>>8&255]+Ee[s>>16&255]+Ee[s>>24&255]+"-"+Ee[t&255]+Ee[t>>8&255]+"-"+Ee[t>>16&15|64]+Ee[t>>24&255]+"-"+Ee[e&63|128]+Ee[e>>8&255]+"-"+Ee[e>>16&255]+Ee[e>>24&255]+Ee[n&255]+Ee[n>>8&255]+Ee[n>>16&255]+Ee[n>>24&255]).toLowerCase()}function Pe(s,t,e){return Math.max(t,Math.min(e,s))}function Ua(s,t){return(s%t+t)%t}function Gc(s,t,e,n,i){return n+(s-t)*(i-n)/(e-t)}function Wc(s,t,e){return s!==t?(e-s)/(t-s):0}function Zi(s,t,e){return(1-e)*s+e*t}function Xc(s,t,e,n){return Zi(s,t,1-Math.exp(-e*n))}function qc(s,t=1){return t-Math.abs(Ua(s,t*2)-t)}function Yc(s,t,e){return s<=t?0:s>=e?1:(s=(s-t)/(e-t),s*s*(3-2*s))}function $c(s,t,e){return s<=t?0:s>=e?1:(s=(s-t)/(e-t),s*s*s*(s*(s*6-15)+10))}function Kc(s,t){return s+Math.floor(Math.random()*(t-s+1))}function jc(s,t){return s+Math.random()*(t-s)}function Zc(s){return s*(.5-Math.random())}function Jc(s){s!==void 0&&(io=s);let t=io+=1831565813;return t=Math.imul(t^t>>>15,t|1),t^=t+Math.imul(t^t>>>7,t|61),((t^t>>>14)>>>0)/4294967296}function Qc(s){return s*ji}function th(s){return s*ts}function eh(s){return(s&s-1)===0&&s!==0}function nh(s){return Math.pow(2,Math.ceil(Math.log(s)/Math.LN2))}function ih(s){return Math.pow(2,Math.floor(Math.log(s)/Math.LN2))}function sh(s,t,e,n,i){const r=Math.cos,a=Math.sin,o=r(e/2),l=a(e/2),c=r((t+n)/2),h=a((t+n)/2),d=r((t-n)/2),f=a((t-n)/2),p=r((n-t)/2),g=a((n-t)/2);switch(i){case"XYX":s.set(o*h,l*d,l*f,o*c);break;case"YZY":s.set(l*f,o*h,l*d,o*c);break;case"ZXZ":s.set(l*d,l*f,o*h,o*c);break;case"XZX":s.set(o*h,l*g,l*p,o*c);break;case"YXY":s.set(l*p,o*h,l*g,o*c);break;case"ZYZ":s.set(l*g,l*p,o*h,o*c);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+i)}}function Qe(s,t){switch(t.constructor){case Float32Array:return s;case Uint32Array:return s/4294967295;case Uint16Array:return s/65535;case Uint8Array:return s/255;case Int32Array:return Math.max(s/2147483647,-1);case Int16Array:return Math.max(s/32767,-1);case Int8Array:return Math.max(s/127,-1);default:throw new Error("Invalid component type.")}}function Kt(s,t){switch(t.constructor){case Float32Array:return s;case Uint32Array:return Math.round(s*4294967295);case Uint16Array:return Math.round(s*65535);case Uint8Array:return Math.round(s*255);case Int32Array:return Math.round(s*2147483647);case Int16Array:return Math.round(s*32767);case Int8Array:return Math.round(s*127);default:throw new Error("Invalid component type.")}}const ce={DEG2RAD:ji,RAD2DEG:ts,generateUUID:_n,clamp:Pe,euclideanModulo:Ua,mapLinear:Gc,inverseLerp:Wc,lerp:Zi,damp:Xc,pingpong:qc,smoothstep:Yc,smootherstep:$c,randInt:Kc,randFloat:jc,randFloatSpread:Zc,seededRandom:Jc,degToRad:Qc,radToDeg:th,isPowerOfTwo:eh,ceilPowerOfTwo:nh,floorPowerOfTwo:ih,setQuaternionFromProperEuler:sh,normalize:Kt,denormalize:Qe};class Ct{constructor(t=0,e=0){Ct.prototype.isVector2=!0,this.x=t,this.y=e}get width(){return this.x}set width(t){this.x=t}get height(){return this.y}set height(t){this.y=t}set(t,e){return this.x=t,this.y=e,this}setScalar(t){return this.x=t,this.y=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y)}copy(t){return this.x=t.x,this.y=t.y,this}add(t){return this.x+=t.x,this.y+=t.y,this}addScalar(t){return this.x+=t,this.y+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this}subScalar(t){return this.x-=t,this.y-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this}multiply(t){return this.x*=t.x,this.y*=t.y,this}multiplyScalar(t){return this.x*=t,this.y*=t,this}divide(t){return this.x/=t.x,this.y/=t.y,this}divideScalar(t){return this.multiplyScalar(1/t)}applyMatrix3(t){const e=this.x,n=this.y,i=t.elements;return this.x=i[0]*e+i[3]*n+i[6],this.y=i[1]*e+i[4]*n+i[7],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this}clamp(t,e){return this.x=Math.max(t.x,Math.min(e.x,this.x)),this.y=Math.max(t.y,Math.min(e.y,this.y)),this}clampScalar(t,e){return this.x=Math.max(t,Math.min(e,this.x)),this.y=Math.max(t,Math.min(e,this.y)),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(t,Math.min(e,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(t){return this.x*t.x+this.y*t.y}cross(t){return this.x*t.y-this.y*t.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const n=this.dot(t)/e;return Math.acos(Pe(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,n=this.y-t.y;return e*e+n*n}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this}equals(t){return t.x===this.x&&t.y===this.y}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this}rotateAround(t,e){const n=Math.cos(e),i=Math.sin(e),r=this.x-t.x,a=this.y-t.y;return this.x=r*n-a*i+t.x,this.y=r*i+a*n+t.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class Dt{constructor(t,e,n,i,r,a,o,l,c){Dt.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],t!==void 0&&this.set(t,e,n,i,r,a,o,l,c)}set(t,e,n,i,r,a,o,l,c){const h=this.elements;return h[0]=t,h[1]=i,h[2]=o,h[3]=e,h[4]=r,h[5]=l,h[6]=n,h[7]=a,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(t){const e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],this}extractBasis(t,e,n){return t.setFromMatrix3Column(this,0),e.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(t){const e=t.elements;return this.set(e[0],e[4],e[8],e[1],e[5],e[9],e[2],e[6],e[10]),this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const n=t.elements,i=e.elements,r=this.elements,a=n[0],o=n[3],l=n[6],c=n[1],h=n[4],d=n[7],f=n[2],p=n[5],g=n[8],_=i[0],m=i[3],u=i[6],S=i[1],w=i[4],v=i[7],P=i[2],T=i[5],A=i[8];return r[0]=a*_+o*S+l*P,r[3]=a*m+o*w+l*T,r[6]=a*u+o*v+l*A,r[1]=c*_+h*S+d*P,r[4]=c*m+h*w+d*T,r[7]=c*u+h*v+d*A,r[2]=f*_+p*S+g*P,r[5]=f*m+p*w+g*T,r[8]=f*u+p*v+g*A,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[3]*=t,e[6]*=t,e[1]*=t,e[4]*=t,e[7]*=t,e[2]*=t,e[5]*=t,e[8]*=t,this}determinant(){const t=this.elements,e=t[0],n=t[1],i=t[2],r=t[3],a=t[4],o=t[5],l=t[6],c=t[7],h=t[8];return e*a*h-e*o*c-n*r*h+n*o*l+i*r*c-i*a*l}invert(){const t=this.elements,e=t[0],n=t[1],i=t[2],r=t[3],a=t[4],o=t[5],l=t[6],c=t[7],h=t[8],d=h*a-o*c,f=o*l-h*r,p=c*r-a*l,g=e*d+n*f+i*p;if(g===0)return this.set(0,0,0,0,0,0,0,0,0);const _=1/g;return t[0]=d*_,t[1]=(i*c-h*n)*_,t[2]=(o*n-i*a)*_,t[3]=f*_,t[4]=(h*e-i*l)*_,t[5]=(i*r-o*e)*_,t[6]=p*_,t[7]=(n*l-c*e)*_,t[8]=(a*e-n*r)*_,this}transpose(){let t;const e=this.elements;return t=e[1],e[1]=e[3],e[3]=t,t=e[2],e[2]=e[6],e[6]=t,t=e[5],e[5]=e[7],e[7]=t,this}getNormalMatrix(t){return this.setFromMatrix4(t).invert().transpose()}transposeIntoArray(t){const e=this.elements;return t[0]=e[0],t[1]=e[3],t[2]=e[6],t[3]=e[1],t[4]=e[4],t[5]=e[7],t[6]=e[2],t[7]=e[5],t[8]=e[8],this}setUvTransform(t,e,n,i,r,a,o){const l=Math.cos(r),c=Math.sin(r);return this.set(n*l,n*c,-n*(l*a+c*o)+a+t,-i*c,i*l,-i*(-c*a+l*o)+o+e,0,0,1),this}scale(t,e){return this.premultiply(nr.makeScale(t,e)),this}rotate(t){return this.premultiply(nr.makeRotation(-t)),this}translate(t,e){return this.premultiply(nr.makeTranslation(t,e)),this}makeTranslation(t,e){return t.isVector2?this.set(1,0,t.x,0,1,t.y,0,0,1):this.set(1,0,t,0,1,e,0,0,1),this}makeRotation(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,n,e,0,0,0,1),this}makeScale(t,e){return this.set(t,0,0,0,e,0,0,0,1),this}equals(t){const e=this.elements,n=t.elements;for(let i=0;i<9;i++)if(e[i]!==n[i])return!1;return!0}fromArray(t,e=0){for(let n=0;n<9;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){const n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t}clone(){return new this.constructor().fromArray(this.elements)}}const nr=new Dt;function Ll(s){for(let t=s.length-1;t>=0;--t)if(s[t]>=65535)return!0;return!1}function Vs(s){return document.createElementNS("http://www.w3.org/1999/xhtml",s)}function rh(){const s=Vs("canvas");return s.style.display="block",s}const so={};function $i(s){s in so||(so[s]=!0,console.warn(s))}function ah(s,t,e){return new Promise(function(n,i){function r(){switch(s.clientWaitSync(t,s.SYNC_FLUSH_COMMANDS_BIT,0)){case s.WAIT_FAILED:i();break;case s.TIMEOUT_EXPIRED:setTimeout(r,e);break;default:n()}}setTimeout(r,e)})}function oh(s){const t=s.elements;t[2]=.5*t[2]+.5*t[3],t[6]=.5*t[6]+.5*t[7],t[10]=.5*t[10]+.5*t[11],t[14]=.5*t[14]+.5*t[15]}function lh(s){const t=s.elements;t[11]===-1?(t[10]=-t[10]-1,t[14]=-t[14]):(t[10]=-t[10],t[14]=-t[14]+1)}const Wt={enabled:!0,workingColorSpace:Pi,spaces:{},convert:function(s,t,e){return this.enabled===!1||t===e||!t||!e||(this.spaces[t].transfer===Jt&&(s.r=vn(s.r),s.g=vn(s.g),s.b=vn(s.b)),this.spaces[t].primaries!==this.spaces[e].primaries&&(s.applyMatrix3(this.spaces[t].toXYZ),s.applyMatrix3(this.spaces[e].fromXYZ)),this.spaces[e].transfer===Jt&&(s.r=Ei(s.r),s.g=Ei(s.g),s.b=Ei(s.b))),s},fromWorkingColorSpace:function(s,t){return this.convert(s,this.workingColorSpace,t)},toWorkingColorSpace:function(s,t){return this.convert(s,t,this.workingColorSpace)},getPrimaries:function(s){return this.spaces[s].primaries},getTransfer:function(s){return s===Cn?Ks:this.spaces[s].transfer},getLuminanceCoefficients:function(s,t=this.workingColorSpace){return s.fromArray(this.spaces[t].luminanceCoefficients)},define:function(s){Object.assign(this.spaces,s)},_getMatrix:function(s,t,e){return s.copy(this.spaces[t].toXYZ).multiply(this.spaces[e].fromXYZ)},_getDrawingBufferColorSpace:function(s){return this.spaces[s].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(s=this.workingColorSpace){return this.spaces[s].workingColorSpaceConfig.unpackColorSpace}};function vn(s){return s<.04045?s*.0773993808:Math.pow(s*.9478672986+.0521327014,2.4)}function Ei(s){return s<.0031308?s*12.92:1.055*Math.pow(s,.41666)-.055}const ro=[.64,.33,.3,.6,.15,.06],ao=[.2126,.7152,.0722],oo=[.3127,.329],lo=new Dt().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),co=new Dt().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);Wt.define({[Pi]:{primaries:ro,whitePoint:oo,transfer:Ks,toXYZ:lo,fromXYZ:co,luminanceCoefficients:ao,workingColorSpaceConfig:{unpackColorSpace:Oe},outputColorSpaceConfig:{drawingBufferColorSpace:Oe}},[Oe]:{primaries:ro,whitePoint:oo,transfer:Jt,toXYZ:lo,fromXYZ:co,luminanceCoefficients:ao,outputColorSpaceConfig:{drawingBufferColorSpace:Oe}}});let ni;class ch{static getDataURL(t){if(/^data:/i.test(t.src)||typeof HTMLCanvasElement>"u")return t.src;let e;if(t instanceof HTMLCanvasElement)e=t;else{ni===void 0&&(ni=Vs("canvas")),ni.width=t.width,ni.height=t.height;const n=ni.getContext("2d");t instanceof ImageData?n.putImageData(t,0,0):n.drawImage(t,0,0,t.width,t.height),e=ni}return e.width>2048||e.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",t),e.toDataURL("image/jpeg",.6)):e.toDataURL("image/png")}static sRGBToLinear(t){if(typeof HTMLImageElement<"u"&&t instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&t instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&t instanceof ImageBitmap){const e=Vs("canvas");e.width=t.width,e.height=t.height;const n=e.getContext("2d");n.drawImage(t,0,0,t.width,t.height);const i=n.getImageData(0,0,t.width,t.height),r=i.data;for(let a=0;a<r.length;a++)r[a]=vn(r[a]/255)*255;return n.putImageData(i,0,0),e}else if(t.data){const e=t.data.slice(0);for(let n=0;n<e.length;n++)e instanceof Uint8Array||e instanceof Uint8ClampedArray?e[n]=Math.floor(vn(e[n]/255)*255):e[n]=vn(e[n]);return{data:e,width:t.width,height:t.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),t}}let hh=0;class Il{constructor(t=null){this.isSource=!0,Object.defineProperty(this,"id",{value:hh++}),this.uuid=_n(),this.data=t,this.dataReady=!0,this.version=0}set needsUpdate(t){t===!0&&this.version++}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.images[this.uuid]!==void 0)return t.images[this.uuid];const n={uuid:this.uuid,url:""},i=this.data;if(i!==null){let r;if(Array.isArray(i)){r=[];for(let a=0,o=i.length;a<o;a++)i[a].isDataTexture?r.push(ir(i[a].image)):r.push(ir(i[a]))}else r=ir(i);n.url=r}return e||(t.images[this.uuid]=n),n}}function ir(s){return typeof HTMLImageElement<"u"&&s instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&s instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&s instanceof ImageBitmap?ch.getDataURL(s):s.data?{data:Array.from(s.data),width:s.width,height:s.height,type:s.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let uh=0;class Ae extends Li{constructor(t=Ae.DEFAULT_IMAGE,e=Ae.DEFAULT_MAPPING,n=$n,i=$n,r=rn,a=Kn,o=tn,l=xn,c=Ae.DEFAULT_ANISOTROPY,h=Cn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:uh++}),this.uuid=_n(),this.name="",this.source=new Il(t),this.mipmaps=[],this.mapping=e,this.channel=0,this.wrapS=n,this.wrapT=i,this.magFilter=r,this.minFilter=a,this.anisotropy=c,this.format=o,this.internalFormat=null,this.type=l,this.offset=new Ct(0,0),this.repeat=new Ct(1,1),this.center=new Ct(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Dt,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.version=0,this.onUpdate=null,this.isRenderTargetTexture=!1,this.pmremVersion=0}get image(){return this.source.data}set image(t=null){this.source.data=t}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(t){return this.name=t.name,this.source=t.source,this.mipmaps=t.mipmaps.slice(0),this.mapping=t.mapping,this.channel=t.channel,this.wrapS=t.wrapS,this.wrapT=t.wrapT,this.magFilter=t.magFilter,this.minFilter=t.minFilter,this.anisotropy=t.anisotropy,this.format=t.format,this.internalFormat=t.internalFormat,this.type=t.type,this.offset.copy(t.offset),this.repeat.copy(t.repeat),this.center.copy(t.center),this.rotation=t.rotation,this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrix.copy(t.matrix),this.generateMipmaps=t.generateMipmaps,this.premultiplyAlpha=t.premultiplyAlpha,this.flipY=t.flipY,this.unpackAlignment=t.unpackAlignment,this.colorSpace=t.colorSpace,this.userData=JSON.parse(JSON.stringify(t.userData)),this.needsUpdate=!0,this}toJSON(t){const e=t===void 0||typeof t=="string";if(!e&&t.textures[this.uuid]!==void 0)return t.textures[this.uuid];const n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(t).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),e||(t.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(t){if(this.mapping!==xl)return t;if(t.applyMatrix3(this.matrix),t.x<0||t.x>1)switch(this.wrapS){case Yr:t.x=t.x-Math.floor(t.x);break;case $n:t.x=t.x<0?0:1;break;case $r:Math.abs(Math.floor(t.x)%2)===1?t.x=Math.ceil(t.x)-t.x:t.x=t.x-Math.floor(t.x);break}if(t.y<0||t.y>1)switch(this.wrapT){case Yr:t.y=t.y-Math.floor(t.y);break;case $n:t.y=t.y<0?0:1;break;case $r:Math.abs(Math.floor(t.y)%2)===1?t.y=Math.ceil(t.y)-t.y:t.y=t.y-Math.floor(t.y);break}return this.flipY&&(t.y=1-t.y),t}set needsUpdate(t){t===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(t){t===!0&&this.pmremVersion++}}Ae.DEFAULT_IMAGE=null;Ae.DEFAULT_MAPPING=xl;Ae.DEFAULT_ANISOTROPY=1;class Qt{constructor(t=0,e=0,n=0,i=1){Qt.prototype.isVector4=!0,this.x=t,this.y=e,this.z=n,this.w=i}get width(){return this.z}set width(t){this.z=t}get height(){return this.w}set height(t){this.w=t}set(t,e,n,i){return this.x=t,this.y=e,this.z=n,this.w=i,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this.w=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setW(t){return this.w=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;case 3:this.w=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this.w=t.w!==void 0?t.w:1,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this.w+=t.w,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this.w+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this.w=t.w+e.w,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this.w+=t.w*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this.w-=t.w,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this.w-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this.w=t.w-e.w,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this.w*=t.w,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this.w*=t,this}applyMatrix4(t){const e=this.x,n=this.y,i=this.z,r=this.w,a=t.elements;return this.x=a[0]*e+a[4]*n+a[8]*i+a[12]*r,this.y=a[1]*e+a[5]*n+a[9]*i+a[13]*r,this.z=a[2]*e+a[6]*n+a[10]*i+a[14]*r,this.w=a[3]*e+a[7]*n+a[11]*i+a[15]*r,this}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this.w/=t.w,this}divideScalar(t){return this.multiplyScalar(1/t)}setAxisAngleFromQuaternion(t){this.w=2*Math.acos(t.w);const e=Math.sqrt(1-t.w*t.w);return e<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=t.x/e,this.y=t.y/e,this.z=t.z/e),this}setAxisAngleFromRotationMatrix(t){let e,n,i,r;const l=t.elements,c=l[0],h=l[4],d=l[8],f=l[1],p=l[5],g=l[9],_=l[2],m=l[6],u=l[10];if(Math.abs(h-f)<.01&&Math.abs(d-_)<.01&&Math.abs(g-m)<.01){if(Math.abs(h+f)<.1&&Math.abs(d+_)<.1&&Math.abs(g+m)<.1&&Math.abs(c+p+u-3)<.1)return this.set(1,0,0,0),this;e=Math.PI;const w=(c+1)/2,v=(p+1)/2,P=(u+1)/2,T=(h+f)/4,A=(d+_)/4,L=(g+m)/4;return w>v&&w>P?w<.01?(n=0,i=.707106781,r=.707106781):(n=Math.sqrt(w),i=T/n,r=A/n):v>P?v<.01?(n=.707106781,i=0,r=.707106781):(i=Math.sqrt(v),n=T/i,r=L/i):P<.01?(n=.707106781,i=.707106781,r=0):(r=Math.sqrt(P),n=A/r,i=L/r),this.set(n,i,r,e),this}let S=Math.sqrt((m-g)*(m-g)+(d-_)*(d-_)+(f-h)*(f-h));return Math.abs(S)<.001&&(S=1),this.x=(m-g)/S,this.y=(d-_)/S,this.z=(f-h)/S,this.w=Math.acos((c+p+u-1)/2),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this.w=e[15],this}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this.w=Math.min(this.w,t.w),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this.w=Math.max(this.w,t.w),this}clamp(t,e){return this.x=Math.max(t.x,Math.min(e.x,this.x)),this.y=Math.max(t.y,Math.min(e.y,this.y)),this.z=Math.max(t.z,Math.min(e.z,this.z)),this.w=Math.max(t.w,Math.min(e.w,this.w)),this}clampScalar(t,e){return this.x=Math.max(t,Math.min(e,this.x)),this.y=Math.max(t,Math.min(e,this.y)),this.z=Math.max(t,Math.min(e,this.z)),this.w=Math.max(t,Math.min(e,this.w)),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(t,Math.min(e,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z+this.w*t.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this.w+=(t.w-this.w)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this.w=t.w+(e.w-t.w)*n,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z&&t.w===this.w}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this.w=t[e+3],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t[e+3]=this.w,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this.w=t.getW(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class dh extends Li{constructor(t=1,e=1,n={}){super(),this.isRenderTarget=!0,this.width=t,this.height=e,this.depth=1,this.scissor=new Qt(0,0,t,e),this.scissorTest=!1,this.viewport=new Qt(0,0,t,e);const i={width:t,height:e,depth:1};n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:rn,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1},n);const r=new Ae(i,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace);r.flipY=!1,r.generateMipmaps=n.generateMipmaps,r.internalFormat=n.internalFormat,this.textures=[];const a=n.count;for(let o=0;o<a;o++)this.textures[o]=r.clone(),this.textures[o].isRenderTargetTexture=!0;this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.depthTexture=n.depthTexture,this.samples=n.samples}get texture(){return this.textures[0]}set texture(t){this.textures[0]=t}setSize(t,e,n=1){if(this.width!==t||this.height!==e||this.depth!==n){this.width=t,this.height=e,this.depth=n;for(let i=0,r=this.textures.length;i<r;i++)this.textures[i].image.width=t,this.textures[i].image.height=e,this.textures[i].image.depth=n;this.dispose()}this.viewport.set(0,0,t,e),this.scissor.set(0,0,t,e)}clone(){return new this.constructor().copy(this)}copy(t){this.width=t.width,this.height=t.height,this.depth=t.depth,this.scissor.copy(t.scissor),this.scissorTest=t.scissorTest,this.viewport.copy(t.viewport),this.textures.length=0;for(let n=0,i=t.textures.length;n<i;n++)this.textures[n]=t.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0;const e=Object.assign({},t.texture.image);return this.texture.source=new Il(e),this.depthBuffer=t.depthBuffer,this.stencilBuffer=t.stencilBuffer,this.resolveDepthBuffer=t.resolveDepthBuffer,this.resolveStencilBuffer=t.resolveStencilBuffer,t.depthTexture!==null&&(this.depthTexture=t.depthTexture.clone()),this.samples=t.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class Mn extends dh{constructor(t=1,e=1,n={}){super(t,e,n),this.isWebGLRenderTarget=!0}}class Dl extends Ae{constructor(t=null,e=1,n=1,i=1){super(null),this.isDataArrayTexture=!0,this.image={data:t,width:e,height:n,depth:i},this.magFilter=Ve,this.minFilter=Ve,this.wrapR=$n,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(t){this.layerUpdates.add(t)}clearLayerUpdates(){this.layerUpdates.clear()}}class fh extends Ae{constructor(t=null,e=1,n=1,i=1){super(null),this.isData3DTexture=!0,this.image={data:t,width:e,height:n,depth:i},this.magFilter=Ve,this.minFilter=Ve,this.wrapR=$n,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Nn{constructor(t=0,e=0,n=0,i=1){this.isQuaternion=!0,this._x=t,this._y=e,this._z=n,this._w=i}static slerpFlat(t,e,n,i,r,a,o){let l=n[i+0],c=n[i+1],h=n[i+2],d=n[i+3];const f=r[a+0],p=r[a+1],g=r[a+2],_=r[a+3];if(o===0){t[e+0]=l,t[e+1]=c,t[e+2]=h,t[e+3]=d;return}if(o===1){t[e+0]=f,t[e+1]=p,t[e+2]=g,t[e+3]=_;return}if(d!==_||l!==f||c!==p||h!==g){let m=1-o;const u=l*f+c*p+h*g+d*_,S=u>=0?1:-1,w=1-u*u;if(w>Number.EPSILON){const P=Math.sqrt(w),T=Math.atan2(P,u*S);m=Math.sin(m*T)/P,o=Math.sin(o*T)/P}const v=o*S;if(l=l*m+f*v,c=c*m+p*v,h=h*m+g*v,d=d*m+_*v,m===1-o){const P=1/Math.sqrt(l*l+c*c+h*h+d*d);l*=P,c*=P,h*=P,d*=P}}t[e]=l,t[e+1]=c,t[e+2]=h,t[e+3]=d}static multiplyQuaternionsFlat(t,e,n,i,r,a){const o=n[i],l=n[i+1],c=n[i+2],h=n[i+3],d=r[a],f=r[a+1],p=r[a+2],g=r[a+3];return t[e]=o*g+h*d+l*p-c*f,t[e+1]=l*g+h*f+c*d-o*p,t[e+2]=c*g+h*p+o*f-l*d,t[e+3]=h*g-o*d-l*f-c*p,t}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get w(){return this._w}set w(t){this._w=t,this._onChangeCallback()}set(t,e,n,i){return this._x=t,this._y=e,this._z=n,this._w=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(t){return this._x=t.x,this._y=t.y,this._z=t.z,this._w=t.w,this._onChangeCallback(),this}setFromEuler(t,e=!0){const n=t._x,i=t._y,r=t._z,a=t._order,o=Math.cos,l=Math.sin,c=o(n/2),h=o(i/2),d=o(r/2),f=l(n/2),p=l(i/2),g=l(r/2);switch(a){case"XYZ":this._x=f*h*d+c*p*g,this._y=c*p*d-f*h*g,this._z=c*h*g+f*p*d,this._w=c*h*d-f*p*g;break;case"YXZ":this._x=f*h*d+c*p*g,this._y=c*p*d-f*h*g,this._z=c*h*g-f*p*d,this._w=c*h*d+f*p*g;break;case"ZXY":this._x=f*h*d-c*p*g,this._y=c*p*d+f*h*g,this._z=c*h*g+f*p*d,this._w=c*h*d-f*p*g;break;case"ZYX":this._x=f*h*d-c*p*g,this._y=c*p*d+f*h*g,this._z=c*h*g-f*p*d,this._w=c*h*d+f*p*g;break;case"YZX":this._x=f*h*d+c*p*g,this._y=c*p*d+f*h*g,this._z=c*h*g-f*p*d,this._w=c*h*d-f*p*g;break;case"XZY":this._x=f*h*d-c*p*g,this._y=c*p*d-f*h*g,this._z=c*h*g+f*p*d,this._w=c*h*d+f*p*g;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+a)}return e===!0&&this._onChangeCallback(),this}setFromAxisAngle(t,e){const n=e/2,i=Math.sin(n);return this._x=t.x*i,this._y=t.y*i,this._z=t.z*i,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(t){const e=t.elements,n=e[0],i=e[4],r=e[8],a=e[1],o=e[5],l=e[9],c=e[2],h=e[6],d=e[10],f=n+o+d;if(f>0){const p=.5/Math.sqrt(f+1);this._w=.25/p,this._x=(h-l)*p,this._y=(r-c)*p,this._z=(a-i)*p}else if(n>o&&n>d){const p=2*Math.sqrt(1+n-o-d);this._w=(h-l)/p,this._x=.25*p,this._y=(i+a)/p,this._z=(r+c)/p}else if(o>d){const p=2*Math.sqrt(1+o-n-d);this._w=(r-c)/p,this._x=(i+a)/p,this._y=.25*p,this._z=(l+h)/p}else{const p=2*Math.sqrt(1+d-n-o);this._w=(a-i)/p,this._x=(r+c)/p,this._y=(l+h)/p,this._z=.25*p}return this._onChangeCallback(),this}setFromUnitVectors(t,e){let n=t.dot(e)+1;return n<Number.EPSILON?(n=0,Math.abs(t.x)>Math.abs(t.z)?(this._x=-t.y,this._y=t.x,this._z=0,this._w=n):(this._x=0,this._y=-t.z,this._z=t.y,this._w=n)):(this._x=t.y*e.z-t.z*e.y,this._y=t.z*e.x-t.x*e.z,this._z=t.x*e.y-t.y*e.x,this._w=n),this.normalize()}angleTo(t){return 2*Math.acos(Math.abs(Pe(this.dot(t),-1,1)))}rotateTowards(t,e){const n=this.angleTo(t);if(n===0)return this;const i=Math.min(1,e/n);return this.slerp(t,i),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(t){return this._x*t._x+this._y*t._y+this._z*t._z+this._w*t._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let t=this.length();return t===0?(this._x=0,this._y=0,this._z=0,this._w=1):(t=1/t,this._x=this._x*t,this._y=this._y*t,this._z=this._z*t,this._w=this._w*t),this._onChangeCallback(),this}multiply(t){return this.multiplyQuaternions(this,t)}premultiply(t){return this.multiplyQuaternions(t,this)}multiplyQuaternions(t,e){const n=t._x,i=t._y,r=t._z,a=t._w,o=e._x,l=e._y,c=e._z,h=e._w;return this._x=n*h+a*o+i*c-r*l,this._y=i*h+a*l+r*o-n*c,this._z=r*h+a*c+n*l-i*o,this._w=a*h-n*o-i*l-r*c,this._onChangeCallback(),this}slerp(t,e){if(e===0)return this;if(e===1)return this.copy(t);const n=this._x,i=this._y,r=this._z,a=this._w;let o=a*t._w+n*t._x+i*t._y+r*t._z;if(o<0?(this._w=-t._w,this._x=-t._x,this._y=-t._y,this._z=-t._z,o=-o):this.copy(t),o>=1)return this._w=a,this._x=n,this._y=i,this._z=r,this;const l=1-o*o;if(l<=Number.EPSILON){const p=1-e;return this._w=p*a+e*this._w,this._x=p*n+e*this._x,this._y=p*i+e*this._y,this._z=p*r+e*this._z,this.normalize(),this}const c=Math.sqrt(l),h=Math.atan2(c,o),d=Math.sin((1-e)*h)/c,f=Math.sin(e*h)/c;return this._w=a*d+this._w*f,this._x=n*d+this._x*f,this._y=i*d+this._y*f,this._z=r*d+this._z*f,this._onChangeCallback(),this}slerpQuaternions(t,e,n){return this.copy(t).slerp(e,n)}random(){const t=2*Math.PI*Math.random(),e=2*Math.PI*Math.random(),n=Math.random(),i=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(i*Math.sin(t),i*Math.cos(t),r*Math.sin(e),r*Math.cos(e))}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._w===this._w}fromArray(t,e=0){return this._x=t[e],this._y=t[e+1],this._z=t[e+2],this._w=t[e+3],this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._w,t}fromBufferAttribute(t,e){return this._x=t.getX(e),this._y=t.getY(e),this._z=t.getZ(e),this._w=t.getW(e),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class R{constructor(t=0,e=0,n=0){R.prototype.isVector3=!0,this.x=t,this.y=e,this.z=n}set(t,e,n){return n===void 0&&(n=this.z),this.x=t,this.y=e,this.z=n,this}setScalar(t){return this.x=t,this.y=t,this.z=t,this}setX(t){return this.x=t,this}setY(t){return this.y=t,this}setZ(t){return this.z=t,this}setComponent(t,e){switch(t){case 0:this.x=e;break;case 1:this.y=e;break;case 2:this.z=e;break;default:throw new Error("index is out of range: "+t)}return this}getComponent(t){switch(t){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+t)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(t){return this.x=t.x,this.y=t.y,this.z=t.z,this}add(t){return this.x+=t.x,this.y+=t.y,this.z+=t.z,this}addScalar(t){return this.x+=t,this.y+=t,this.z+=t,this}addVectors(t,e){return this.x=t.x+e.x,this.y=t.y+e.y,this.z=t.z+e.z,this}addScaledVector(t,e){return this.x+=t.x*e,this.y+=t.y*e,this.z+=t.z*e,this}sub(t){return this.x-=t.x,this.y-=t.y,this.z-=t.z,this}subScalar(t){return this.x-=t,this.y-=t,this.z-=t,this}subVectors(t,e){return this.x=t.x-e.x,this.y=t.y-e.y,this.z=t.z-e.z,this}multiply(t){return this.x*=t.x,this.y*=t.y,this.z*=t.z,this}multiplyScalar(t){return this.x*=t,this.y*=t,this.z*=t,this}multiplyVectors(t,e){return this.x=t.x*e.x,this.y=t.y*e.y,this.z=t.z*e.z,this}applyEuler(t){return this.applyQuaternion(ho.setFromEuler(t))}applyAxisAngle(t,e){return this.applyQuaternion(ho.setFromAxisAngle(t,e))}applyMatrix3(t){const e=this.x,n=this.y,i=this.z,r=t.elements;return this.x=r[0]*e+r[3]*n+r[6]*i,this.y=r[1]*e+r[4]*n+r[7]*i,this.z=r[2]*e+r[5]*n+r[8]*i,this}applyNormalMatrix(t){return this.applyMatrix3(t).normalize()}applyMatrix4(t){const e=this.x,n=this.y,i=this.z,r=t.elements,a=1/(r[3]*e+r[7]*n+r[11]*i+r[15]);return this.x=(r[0]*e+r[4]*n+r[8]*i+r[12])*a,this.y=(r[1]*e+r[5]*n+r[9]*i+r[13])*a,this.z=(r[2]*e+r[6]*n+r[10]*i+r[14])*a,this}applyQuaternion(t){const e=this.x,n=this.y,i=this.z,r=t.x,a=t.y,o=t.z,l=t.w,c=2*(a*i-o*n),h=2*(o*e-r*i),d=2*(r*n-a*e);return this.x=e+l*c+a*d-o*h,this.y=n+l*h+o*c-r*d,this.z=i+l*d+r*h-a*c,this}project(t){return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)}unproject(t){return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)}transformDirection(t){const e=this.x,n=this.y,i=this.z,r=t.elements;return this.x=r[0]*e+r[4]*n+r[8]*i,this.y=r[1]*e+r[5]*n+r[9]*i,this.z=r[2]*e+r[6]*n+r[10]*i,this.normalize()}divide(t){return this.x/=t.x,this.y/=t.y,this.z/=t.z,this}divideScalar(t){return this.multiplyScalar(1/t)}min(t){return this.x=Math.min(this.x,t.x),this.y=Math.min(this.y,t.y),this.z=Math.min(this.z,t.z),this}max(t){return this.x=Math.max(this.x,t.x),this.y=Math.max(this.y,t.y),this.z=Math.max(this.z,t.z),this}clamp(t,e){return this.x=Math.max(t.x,Math.min(e.x,this.x)),this.y=Math.max(t.y,Math.min(e.y,this.y)),this.z=Math.max(t.z,Math.min(e.z,this.z)),this}clampScalar(t,e){return this.x=Math.max(t,Math.min(e,this.x)),this.y=Math.max(t,Math.min(e,this.y)),this.z=Math.max(t,Math.min(e,this.z)),this}clampLength(t,e){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Math.max(t,Math.min(e,n)))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(t){return this.x*t.x+this.y*t.y+this.z*t.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(t){return this.normalize().multiplyScalar(t)}lerp(t,e){return this.x+=(t.x-this.x)*e,this.y+=(t.y-this.y)*e,this.z+=(t.z-this.z)*e,this}lerpVectors(t,e,n){return this.x=t.x+(e.x-t.x)*n,this.y=t.y+(e.y-t.y)*n,this.z=t.z+(e.z-t.z)*n,this}cross(t){return this.crossVectors(this,t)}crossVectors(t,e){const n=t.x,i=t.y,r=t.z,a=e.x,o=e.y,l=e.z;return this.x=i*l-r*o,this.y=r*a-n*l,this.z=n*o-i*a,this}projectOnVector(t){const e=t.lengthSq();if(e===0)return this.set(0,0,0);const n=t.dot(this)/e;return this.copy(t).multiplyScalar(n)}projectOnPlane(t){return sr.copy(this).projectOnVector(t),this.sub(sr)}reflect(t){return this.sub(sr.copy(t).multiplyScalar(2*this.dot(t)))}angleTo(t){const e=Math.sqrt(this.lengthSq()*t.lengthSq());if(e===0)return Math.PI/2;const n=this.dot(t)/e;return Math.acos(Pe(n,-1,1))}distanceTo(t){return Math.sqrt(this.distanceToSquared(t))}distanceToSquared(t){const e=this.x-t.x,n=this.y-t.y,i=this.z-t.z;return e*e+n*n+i*i}manhattanDistanceTo(t){return Math.abs(this.x-t.x)+Math.abs(this.y-t.y)+Math.abs(this.z-t.z)}setFromSpherical(t){return this.setFromSphericalCoords(t.radius,t.phi,t.theta)}setFromSphericalCoords(t,e,n){const i=Math.sin(e)*t;return this.x=i*Math.sin(n),this.y=Math.cos(e)*t,this.z=i*Math.cos(n),this}setFromCylindrical(t){return this.setFromCylindricalCoords(t.radius,t.theta,t.y)}setFromCylindricalCoords(t,e,n){return this.x=t*Math.sin(e),this.y=n,this.z=t*Math.cos(e),this}setFromMatrixPosition(t){const e=t.elements;return this.x=e[12],this.y=e[13],this.z=e[14],this}setFromMatrixScale(t){const e=this.setFromMatrixColumn(t,0).length(),n=this.setFromMatrixColumn(t,1).length(),i=this.setFromMatrixColumn(t,2).length();return this.x=e,this.y=n,this.z=i,this}setFromMatrixColumn(t,e){return this.fromArray(t.elements,e*4)}setFromMatrix3Column(t,e){return this.fromArray(t.elements,e*3)}setFromEuler(t){return this.x=t._x,this.y=t._y,this.z=t._z,this}setFromColor(t){return this.x=t.r,this.y=t.g,this.z=t.b,this}equals(t){return t.x===this.x&&t.y===this.y&&t.z===this.z}fromArray(t,e=0){return this.x=t[e],this.y=t[e+1],this.z=t[e+2],this}toArray(t=[],e=0){return t[e]=this.x,t[e+1]=this.y,t[e+2]=this.z,t}fromBufferAttribute(t,e){return this.x=t.getX(e),this.y=t.getY(e),this.z=t.getZ(e),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const t=Math.random()*Math.PI*2,e=Math.random()*2-1,n=Math.sqrt(1-e*e);return this.x=n*Math.cos(t),this.y=e,this.z=n*Math.sin(t),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const sr=new R,ho=new Nn;class Jn{constructor(t=new R(1/0,1/0,1/0),e=new R(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=t,this.max=e}set(t,e){return this.min.copy(t),this.max.copy(e),this}setFromArray(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e+=3)this.expandByPoint(Ke.fromArray(t,e));return this}setFromBufferAttribute(t){this.makeEmpty();for(let e=0,n=t.count;e<n;e++)this.expandByPoint(Ke.fromBufferAttribute(t,e));return this}setFromPoints(t){this.makeEmpty();for(let e=0,n=t.length;e<n;e++)this.expandByPoint(t[e]);return this}setFromCenterAndSize(t,e){const n=Ke.copy(e).multiplyScalar(.5);return this.min.copy(t).sub(n),this.max.copy(t).add(n),this}setFromObject(t,e=!1){return this.makeEmpty(),this.expandByObject(t,e)}clone(){return new this.constructor().copy(this)}copy(t){return this.min.copy(t.min),this.max.copy(t.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(t){return this.isEmpty()?t.set(0,0,0):t.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(t){return this.isEmpty()?t.set(0,0,0):t.subVectors(this.max,this.min)}expandByPoint(t){return this.min.min(t),this.max.max(t),this}expandByVector(t){return this.min.sub(t),this.max.add(t),this}expandByScalar(t){return this.min.addScalar(-t),this.max.addScalar(t),this}expandByObject(t,e=!1){t.updateWorldMatrix(!1,!1);const n=t.geometry;if(n!==void 0){const r=n.getAttribute("position");if(e===!0&&r!==void 0&&t.isInstancedMesh!==!0)for(let a=0,o=r.count;a<o;a++)t.isMesh===!0?t.getVertexPosition(a,Ke):Ke.fromBufferAttribute(r,a),Ke.applyMatrix4(t.matrixWorld),this.expandByPoint(Ke);else t.boundingBox!==void 0?(t.boundingBox===null&&t.computeBoundingBox(),rs.copy(t.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),rs.copy(n.boundingBox)),rs.applyMatrix4(t.matrixWorld),this.union(rs)}const i=t.children;for(let r=0,a=i.length;r<a;r++)this.expandByObject(i[r],e);return this}containsPoint(t){return t.x>=this.min.x&&t.x<=this.max.x&&t.y>=this.min.y&&t.y<=this.max.y&&t.z>=this.min.z&&t.z<=this.max.z}containsBox(t){return this.min.x<=t.min.x&&t.max.x<=this.max.x&&this.min.y<=t.min.y&&t.max.y<=this.max.y&&this.min.z<=t.min.z&&t.max.z<=this.max.z}getParameter(t,e){return e.set((t.x-this.min.x)/(this.max.x-this.min.x),(t.y-this.min.y)/(this.max.y-this.min.y),(t.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(t){return t.max.x>=this.min.x&&t.min.x<=this.max.x&&t.max.y>=this.min.y&&t.min.y<=this.max.y&&t.max.z>=this.min.z&&t.min.z<=this.max.z}intersectsSphere(t){return this.clampPoint(t.center,Ke),Ke.distanceToSquared(t.center)<=t.radius*t.radius}intersectsPlane(t){let e,n;return t.normal.x>0?(e=t.normal.x*this.min.x,n=t.normal.x*this.max.x):(e=t.normal.x*this.max.x,n=t.normal.x*this.min.x),t.normal.y>0?(e+=t.normal.y*this.min.y,n+=t.normal.y*this.max.y):(e+=t.normal.y*this.max.y,n+=t.normal.y*this.min.y),t.normal.z>0?(e+=t.normal.z*this.min.z,n+=t.normal.z*this.max.z):(e+=t.normal.z*this.max.z,n+=t.normal.z*this.min.z),e<=-t.constant&&n>=-t.constant}intersectsTriangle(t){if(this.isEmpty())return!1;this.getCenter(Fi),as.subVectors(this.max,Fi),ii.subVectors(t.a,Fi),si.subVectors(t.b,Fi),ri.subVectors(t.c,Fi),En.subVectors(si,ii),wn.subVectors(ri,si),Bn.subVectors(ii,ri);let e=[0,-En.z,En.y,0,-wn.z,wn.y,0,-Bn.z,Bn.y,En.z,0,-En.x,wn.z,0,-wn.x,Bn.z,0,-Bn.x,-En.y,En.x,0,-wn.y,wn.x,0,-Bn.y,Bn.x,0];return!rr(e,ii,si,ri,as)||(e=[1,0,0,0,1,0,0,0,1],!rr(e,ii,si,ri,as))?!1:(os.crossVectors(En,wn),e=[os.x,os.y,os.z],rr(e,ii,si,ri,as))}clampPoint(t,e){return e.copy(t).clamp(this.min,this.max)}distanceToPoint(t){return this.clampPoint(t,Ke).distanceTo(t)}getBoundingSphere(t){return this.isEmpty()?t.makeEmpty():(this.getCenter(t.center),t.radius=this.getSize(Ke).length()*.5),t}intersect(t){return this.min.max(t.min),this.max.min(t.max),this.isEmpty()&&this.makeEmpty(),this}union(t){return this.min.min(t.min),this.max.max(t.max),this}applyMatrix4(t){return this.isEmpty()?this:(cn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(t),cn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(t),cn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(t),cn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(t),cn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(t),cn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(t),cn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(t),cn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(t),this.setFromPoints(cn),this)}translate(t){return this.min.add(t),this.max.add(t),this}equals(t){return t.min.equals(this.min)&&t.max.equals(this.max)}}const cn=[new R,new R,new R,new R,new R,new R,new R,new R],Ke=new R,rs=new Jn,ii=new R,si=new R,ri=new R,En=new R,wn=new R,Bn=new R,Fi=new R,as=new R,os=new R,kn=new R;function rr(s,t,e,n,i){for(let r=0,a=s.length-3;r<=a;r+=3){kn.fromArray(s,r);const o=i.x*Math.abs(kn.x)+i.y*Math.abs(kn.y)+i.z*Math.abs(kn.z),l=t.dot(kn),c=e.dot(kn),h=n.dot(kn);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>o)return!1}return!0}const ph=new Jn,Oi=new R,ar=new R;class Qn{constructor(t=new R,e=-1){this.isSphere=!0,this.center=t,this.radius=e}set(t,e){return this.center.copy(t),this.radius=e,this}setFromPoints(t,e){const n=this.center;e!==void 0?n.copy(e):ph.setFromPoints(t).getCenter(n);let i=0;for(let r=0,a=t.length;r<a;r++)i=Math.max(i,n.distanceToSquared(t[r]));return this.radius=Math.sqrt(i),this}copy(t){return this.center.copy(t.center),this.radius=t.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(t){return t.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(t){return t.distanceTo(this.center)-this.radius}intersectsSphere(t){const e=this.radius+t.radius;return t.center.distanceToSquared(this.center)<=e*e}intersectsBox(t){return t.intersectsSphere(this)}intersectsPlane(t){return Math.abs(t.distanceToPoint(this.center))<=this.radius}clampPoint(t,e){const n=this.center.distanceToSquared(t);return e.copy(t),n>this.radius*this.radius&&(e.sub(this.center).normalize(),e.multiplyScalar(this.radius).add(this.center)),e}getBoundingBox(t){return this.isEmpty()?(t.makeEmpty(),t):(t.set(this.center,this.center),t.expandByScalar(this.radius),t)}applyMatrix4(t){return this.center.applyMatrix4(t),this.radius=this.radius*t.getMaxScaleOnAxis(),this}translate(t){return this.center.add(t),this}expandByPoint(t){if(this.isEmpty())return this.center.copy(t),this.radius=0,this;Oi.subVectors(t,this.center);const e=Oi.lengthSq();if(e>this.radius*this.radius){const n=Math.sqrt(e),i=(n-this.radius)*.5;this.center.addScaledVector(Oi,i/n),this.radius+=i}return this}union(t){return t.isEmpty()?this:this.isEmpty()?(this.copy(t),this):(this.center.equals(t.center)===!0?this.radius=Math.max(this.radius,t.radius):(ar.subVectors(t.center,this.center).setLength(t.radius),this.expandByPoint(Oi.copy(t.center).add(ar)),this.expandByPoint(Oi.copy(t.center).sub(ar))),this)}equals(t){return t.center.equals(this.center)&&t.radius===this.radius}clone(){return new this.constructor().copy(this)}}const hn=new R,or=new R,ls=new R,bn=new R,lr=new R,cs=new R,cr=new R;class Na{constructor(t=new R,e=new R(0,0,-1)){this.origin=t,this.direction=e}set(t,e){return this.origin.copy(t),this.direction.copy(e),this}copy(t){return this.origin.copy(t.origin),this.direction.copy(t.direction),this}at(t,e){return e.copy(this.origin).addScaledVector(this.direction,t)}lookAt(t){return this.direction.copy(t).sub(this.origin).normalize(),this}recast(t){return this.origin.copy(this.at(t,hn)),this}closestPointToPoint(t,e){e.subVectors(t,this.origin);const n=e.dot(this.direction);return n<0?e.copy(this.origin):e.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(t){return Math.sqrt(this.distanceSqToPoint(t))}distanceSqToPoint(t){const e=hn.subVectors(t,this.origin).dot(this.direction);return e<0?this.origin.distanceToSquared(t):(hn.copy(this.origin).addScaledVector(this.direction,e),hn.distanceToSquared(t))}distanceSqToSegment(t,e,n,i){or.copy(t).add(e).multiplyScalar(.5),ls.copy(e).sub(t).normalize(),bn.copy(this.origin).sub(or);const r=t.distanceTo(e)*.5,a=-this.direction.dot(ls),o=bn.dot(this.direction),l=-bn.dot(ls),c=bn.lengthSq(),h=Math.abs(1-a*a);let d,f,p,g;if(h>0)if(d=a*l-o,f=a*o-l,g=r*h,d>=0)if(f>=-g)if(f<=g){const _=1/h;d*=_,f*=_,p=d*(d+a*f+2*o)+f*(a*d+f+2*l)+c}else f=r,d=Math.max(0,-(a*f+o)),p=-d*d+f*(f+2*l)+c;else f=-r,d=Math.max(0,-(a*f+o)),p=-d*d+f*(f+2*l)+c;else f<=-g?(d=Math.max(0,-(-a*r+o)),f=d>0?-r:Math.min(Math.max(-r,-l),r),p=-d*d+f*(f+2*l)+c):f<=g?(d=0,f=Math.min(Math.max(-r,-l),r),p=f*(f+2*l)+c):(d=Math.max(0,-(a*r+o)),f=d>0?r:Math.min(Math.max(-r,-l),r),p=-d*d+f*(f+2*l)+c);else f=a>0?-r:r,d=Math.max(0,-(a*f+o)),p=-d*d+f*(f+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,d),i&&i.copy(or).addScaledVector(ls,f),p}intersectSphere(t,e){hn.subVectors(t.center,this.origin);const n=hn.dot(this.direction),i=hn.dot(hn)-n*n,r=t.radius*t.radius;if(i>r)return null;const a=Math.sqrt(r-i),o=n-a,l=n+a;return l<0?null:o<0?this.at(l,e):this.at(o,e)}intersectsSphere(t){return this.distanceSqToPoint(t.center)<=t.radius*t.radius}distanceToPlane(t){const e=t.normal.dot(this.direction);if(e===0)return t.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(t.normal)+t.constant)/e;return n>=0?n:null}intersectPlane(t,e){const n=this.distanceToPlane(t);return n===null?null:this.at(n,e)}intersectsPlane(t){const e=t.distanceToPoint(this.origin);return e===0||t.normal.dot(this.direction)*e<0}intersectBox(t,e){let n,i,r,a,o,l;const c=1/this.direction.x,h=1/this.direction.y,d=1/this.direction.z,f=this.origin;return c>=0?(n=(t.min.x-f.x)*c,i=(t.max.x-f.x)*c):(n=(t.max.x-f.x)*c,i=(t.min.x-f.x)*c),h>=0?(r=(t.min.y-f.y)*h,a=(t.max.y-f.y)*h):(r=(t.max.y-f.y)*h,a=(t.min.y-f.y)*h),n>a||r>i||((r>n||isNaN(n))&&(n=r),(a<i||isNaN(i))&&(i=a),d>=0?(o=(t.min.z-f.z)*d,l=(t.max.z-f.z)*d):(o=(t.max.z-f.z)*d,l=(t.min.z-f.z)*d),n>l||o>i)||((o>n||n!==n)&&(n=o),(l<i||i!==i)&&(i=l),i<0)?null:this.at(n>=0?n:i,e)}intersectsBox(t){return this.intersectBox(t,hn)!==null}intersectTriangle(t,e,n,i,r){lr.subVectors(e,t),cs.subVectors(n,t),cr.crossVectors(lr,cs);let a=this.direction.dot(cr),o;if(a>0){if(i)return null;o=1}else if(a<0)o=-1,a=-a;else return null;bn.subVectors(this.origin,t);const l=o*this.direction.dot(cs.crossVectors(bn,cs));if(l<0)return null;const c=o*this.direction.dot(lr.cross(bn));if(c<0||l+c>a)return null;const h=-o*bn.dot(cr);return h<0?null:this.at(h/a,r)}applyMatrix4(t){return this.origin.applyMatrix4(t),this.direction.transformDirection(t),this}equals(t){return t.origin.equals(this.origin)&&t.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class Zt{constructor(t,e,n,i,r,a,o,l,c,h,d,f,p,g,_,m){Zt.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],t!==void 0&&this.set(t,e,n,i,r,a,o,l,c,h,d,f,p,g,_,m)}set(t,e,n,i,r,a,o,l,c,h,d,f,p,g,_,m){const u=this.elements;return u[0]=t,u[4]=e,u[8]=n,u[12]=i,u[1]=r,u[5]=a,u[9]=o,u[13]=l,u[2]=c,u[6]=h,u[10]=d,u[14]=f,u[3]=p,u[7]=g,u[11]=_,u[15]=m,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Zt().fromArray(this.elements)}copy(t){const e=this.elements,n=t.elements;return e[0]=n[0],e[1]=n[1],e[2]=n[2],e[3]=n[3],e[4]=n[4],e[5]=n[5],e[6]=n[6],e[7]=n[7],e[8]=n[8],e[9]=n[9],e[10]=n[10],e[11]=n[11],e[12]=n[12],e[13]=n[13],e[14]=n[14],e[15]=n[15],this}copyPosition(t){const e=this.elements,n=t.elements;return e[12]=n[12],e[13]=n[13],e[14]=n[14],this}setFromMatrix3(t){const e=t.elements;return this.set(e[0],e[3],e[6],0,e[1],e[4],e[7],0,e[2],e[5],e[8],0,0,0,0,1),this}extractBasis(t,e,n){return t.setFromMatrixColumn(this,0),e.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(t,e,n){return this.set(t.x,e.x,n.x,0,t.y,e.y,n.y,0,t.z,e.z,n.z,0,0,0,0,1),this}extractRotation(t){const e=this.elements,n=t.elements,i=1/ai.setFromMatrixColumn(t,0).length(),r=1/ai.setFromMatrixColumn(t,1).length(),a=1/ai.setFromMatrixColumn(t,2).length();return e[0]=n[0]*i,e[1]=n[1]*i,e[2]=n[2]*i,e[3]=0,e[4]=n[4]*r,e[5]=n[5]*r,e[6]=n[6]*r,e[7]=0,e[8]=n[8]*a,e[9]=n[9]*a,e[10]=n[10]*a,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromEuler(t){const e=this.elements,n=t.x,i=t.y,r=t.z,a=Math.cos(n),o=Math.sin(n),l=Math.cos(i),c=Math.sin(i),h=Math.cos(r),d=Math.sin(r);if(t.order==="XYZ"){const f=a*h,p=a*d,g=o*h,_=o*d;e[0]=l*h,e[4]=-l*d,e[8]=c,e[1]=p+g*c,e[5]=f-_*c,e[9]=-o*l,e[2]=_-f*c,e[6]=g+p*c,e[10]=a*l}else if(t.order==="YXZ"){const f=l*h,p=l*d,g=c*h,_=c*d;e[0]=f+_*o,e[4]=g*o-p,e[8]=a*c,e[1]=a*d,e[5]=a*h,e[9]=-o,e[2]=p*o-g,e[6]=_+f*o,e[10]=a*l}else if(t.order==="ZXY"){const f=l*h,p=l*d,g=c*h,_=c*d;e[0]=f-_*o,e[4]=-a*d,e[8]=g+p*o,e[1]=p+g*o,e[5]=a*h,e[9]=_-f*o,e[2]=-a*c,e[6]=o,e[10]=a*l}else if(t.order==="ZYX"){const f=a*h,p=a*d,g=o*h,_=o*d;e[0]=l*h,e[4]=g*c-p,e[8]=f*c+_,e[1]=l*d,e[5]=_*c+f,e[9]=p*c-g,e[2]=-c,e[6]=o*l,e[10]=a*l}else if(t.order==="YZX"){const f=a*l,p=a*c,g=o*l,_=o*c;e[0]=l*h,e[4]=_-f*d,e[8]=g*d+p,e[1]=d,e[5]=a*h,e[9]=-o*h,e[2]=-c*h,e[6]=p*d+g,e[10]=f-_*d}else if(t.order==="XZY"){const f=a*l,p=a*c,g=o*l,_=o*c;e[0]=l*h,e[4]=-d,e[8]=c*h,e[1]=f*d+_,e[5]=a*h,e[9]=p*d-g,e[2]=g*d-p,e[6]=o*h,e[10]=_*d+f}return e[3]=0,e[7]=0,e[11]=0,e[12]=0,e[13]=0,e[14]=0,e[15]=1,this}makeRotationFromQuaternion(t){return this.compose(mh,t,gh)}lookAt(t,e,n){const i=this.elements;return ze.subVectors(t,e),ze.lengthSq()===0&&(ze.z=1),ze.normalize(),Tn.crossVectors(n,ze),Tn.lengthSq()===0&&(Math.abs(n.z)===1?ze.x+=1e-4:ze.z+=1e-4,ze.normalize(),Tn.crossVectors(n,ze)),Tn.normalize(),hs.crossVectors(ze,Tn),i[0]=Tn.x,i[4]=hs.x,i[8]=ze.x,i[1]=Tn.y,i[5]=hs.y,i[9]=ze.y,i[2]=Tn.z,i[6]=hs.z,i[10]=ze.z,this}multiply(t){return this.multiplyMatrices(this,t)}premultiply(t){return this.multiplyMatrices(t,this)}multiplyMatrices(t,e){const n=t.elements,i=e.elements,r=this.elements,a=n[0],o=n[4],l=n[8],c=n[12],h=n[1],d=n[5],f=n[9],p=n[13],g=n[2],_=n[6],m=n[10],u=n[14],S=n[3],w=n[7],v=n[11],P=n[15],T=i[0],A=i[4],L=i[8],E=i[12],M=i[1],C=i[5],k=i[9],O=i[13],W=i[2],X=i[6],H=i[10],j=i[14],V=i[3],st=i[7],ht=i[11],Mt=i[15];return r[0]=a*T+o*M+l*W+c*V,r[4]=a*A+o*C+l*X+c*st,r[8]=a*L+o*k+l*H+c*ht,r[12]=a*E+o*O+l*j+c*Mt,r[1]=h*T+d*M+f*W+p*V,r[5]=h*A+d*C+f*X+p*st,r[9]=h*L+d*k+f*H+p*ht,r[13]=h*E+d*O+f*j+p*Mt,r[2]=g*T+_*M+m*W+u*V,r[6]=g*A+_*C+m*X+u*st,r[10]=g*L+_*k+m*H+u*ht,r[14]=g*E+_*O+m*j+u*Mt,r[3]=S*T+w*M+v*W+P*V,r[7]=S*A+w*C+v*X+P*st,r[11]=S*L+w*k+v*H+P*ht,r[15]=S*E+w*O+v*j+P*Mt,this}multiplyScalar(t){const e=this.elements;return e[0]*=t,e[4]*=t,e[8]*=t,e[12]*=t,e[1]*=t,e[5]*=t,e[9]*=t,e[13]*=t,e[2]*=t,e[6]*=t,e[10]*=t,e[14]*=t,e[3]*=t,e[7]*=t,e[11]*=t,e[15]*=t,this}determinant(){const t=this.elements,e=t[0],n=t[4],i=t[8],r=t[12],a=t[1],o=t[5],l=t[9],c=t[13],h=t[2],d=t[6],f=t[10],p=t[14],g=t[3],_=t[7],m=t[11],u=t[15];return g*(+r*l*d-i*c*d-r*o*f+n*c*f+i*o*p-n*l*p)+_*(+e*l*p-e*c*f+r*a*f-i*a*p+i*c*h-r*l*h)+m*(+e*c*d-e*o*p-r*a*d+n*a*p+r*o*h-n*c*h)+u*(-i*o*h-e*l*d+e*o*f+i*a*d-n*a*f+n*l*h)}transpose(){const t=this.elements;let e;return e=t[1],t[1]=t[4],t[4]=e,e=t[2],t[2]=t[8],t[8]=e,e=t[6],t[6]=t[9],t[9]=e,e=t[3],t[3]=t[12],t[12]=e,e=t[7],t[7]=t[13],t[13]=e,e=t[11],t[11]=t[14],t[14]=e,this}setPosition(t,e,n){const i=this.elements;return t.isVector3?(i[12]=t.x,i[13]=t.y,i[14]=t.z):(i[12]=t,i[13]=e,i[14]=n),this}invert(){const t=this.elements,e=t[0],n=t[1],i=t[2],r=t[3],a=t[4],o=t[5],l=t[6],c=t[7],h=t[8],d=t[9],f=t[10],p=t[11],g=t[12],_=t[13],m=t[14],u=t[15],S=d*m*c-_*f*c+_*l*p-o*m*p-d*l*u+o*f*u,w=g*f*c-h*m*c-g*l*p+a*m*p+h*l*u-a*f*u,v=h*_*c-g*d*c+g*o*p-a*_*p-h*o*u+a*d*u,P=g*d*l-h*_*l-g*o*f+a*_*f+h*o*m-a*d*m,T=e*S+n*w+i*v+r*P;if(T===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const A=1/T;return t[0]=S*A,t[1]=(_*f*r-d*m*r-_*i*p+n*m*p+d*i*u-n*f*u)*A,t[2]=(o*m*r-_*l*r+_*i*c-n*m*c-o*i*u+n*l*u)*A,t[3]=(d*l*r-o*f*r-d*i*c+n*f*c+o*i*p-n*l*p)*A,t[4]=w*A,t[5]=(h*m*r-g*f*r+g*i*p-e*m*p-h*i*u+e*f*u)*A,t[6]=(g*l*r-a*m*r-g*i*c+e*m*c+a*i*u-e*l*u)*A,t[7]=(a*f*r-h*l*r+h*i*c-e*f*c-a*i*p+e*l*p)*A,t[8]=v*A,t[9]=(g*d*r-h*_*r-g*n*p+e*_*p+h*n*u-e*d*u)*A,t[10]=(a*_*r-g*o*r+g*n*c-e*_*c-a*n*u+e*o*u)*A,t[11]=(h*o*r-a*d*r-h*n*c+e*d*c+a*n*p-e*o*p)*A,t[12]=P*A,t[13]=(h*_*i-g*d*i+g*n*f-e*_*f-h*n*m+e*d*m)*A,t[14]=(g*o*i-a*_*i-g*n*l+e*_*l+a*n*m-e*o*m)*A,t[15]=(a*d*i-h*o*i+h*n*l-e*d*l-a*n*f+e*o*f)*A,this}scale(t){const e=this.elements,n=t.x,i=t.y,r=t.z;return e[0]*=n,e[4]*=i,e[8]*=r,e[1]*=n,e[5]*=i,e[9]*=r,e[2]*=n,e[6]*=i,e[10]*=r,e[3]*=n,e[7]*=i,e[11]*=r,this}getMaxScaleOnAxis(){const t=this.elements,e=t[0]*t[0]+t[1]*t[1]+t[2]*t[2],n=t[4]*t[4]+t[5]*t[5]+t[6]*t[6],i=t[8]*t[8]+t[9]*t[9]+t[10]*t[10];return Math.sqrt(Math.max(e,n,i))}makeTranslation(t,e,n){return t.isVector3?this.set(1,0,0,t.x,0,1,0,t.y,0,0,1,t.z,0,0,0,1):this.set(1,0,0,t,0,1,0,e,0,0,1,n,0,0,0,1),this}makeRotationX(t){const e=Math.cos(t),n=Math.sin(t);return this.set(1,0,0,0,0,e,-n,0,0,n,e,0,0,0,0,1),this}makeRotationY(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,0,n,0,0,1,0,0,-n,0,e,0,0,0,0,1),this}makeRotationZ(t){const e=Math.cos(t),n=Math.sin(t);return this.set(e,-n,0,0,n,e,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(t,e){const n=Math.cos(e),i=Math.sin(e),r=1-n,a=t.x,o=t.y,l=t.z,c=r*a,h=r*o;return this.set(c*a+n,c*o-i*l,c*l+i*o,0,c*o+i*l,h*o+n,h*l-i*a,0,c*l-i*o,h*l+i*a,r*l*l+n,0,0,0,0,1),this}makeScale(t,e,n){return this.set(t,0,0,0,0,e,0,0,0,0,n,0,0,0,0,1),this}makeShear(t,e,n,i,r,a){return this.set(1,n,r,0,t,1,a,0,e,i,1,0,0,0,0,1),this}compose(t,e,n){const i=this.elements,r=e._x,a=e._y,o=e._z,l=e._w,c=r+r,h=a+a,d=o+o,f=r*c,p=r*h,g=r*d,_=a*h,m=a*d,u=o*d,S=l*c,w=l*h,v=l*d,P=n.x,T=n.y,A=n.z;return i[0]=(1-(_+u))*P,i[1]=(p+v)*P,i[2]=(g-w)*P,i[3]=0,i[4]=(p-v)*T,i[5]=(1-(f+u))*T,i[6]=(m+S)*T,i[7]=0,i[8]=(g+w)*A,i[9]=(m-S)*A,i[10]=(1-(f+_))*A,i[11]=0,i[12]=t.x,i[13]=t.y,i[14]=t.z,i[15]=1,this}decompose(t,e,n){const i=this.elements;let r=ai.set(i[0],i[1],i[2]).length();const a=ai.set(i[4],i[5],i[6]).length(),o=ai.set(i[8],i[9],i[10]).length();this.determinant()<0&&(r=-r),t.x=i[12],t.y=i[13],t.z=i[14],je.copy(this);const c=1/r,h=1/a,d=1/o;return je.elements[0]*=c,je.elements[1]*=c,je.elements[2]*=c,je.elements[4]*=h,je.elements[5]*=h,je.elements[6]*=h,je.elements[8]*=d,je.elements[9]*=d,je.elements[10]*=d,e.setFromRotationMatrix(je),n.x=r,n.y=a,n.z=o,this}makePerspective(t,e,n,i,r,a,o=gn){const l=this.elements,c=2*r/(e-t),h=2*r/(n-i),d=(e+t)/(e-t),f=(n+i)/(n-i);let p,g;if(o===gn)p=-(a+r)/(a-r),g=-2*a*r/(a-r);else if(o===Hs)p=-a/(a-r),g=-a*r/(a-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return l[0]=c,l[4]=0,l[8]=d,l[12]=0,l[1]=0,l[5]=h,l[9]=f,l[13]=0,l[2]=0,l[6]=0,l[10]=p,l[14]=g,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(t,e,n,i,r,a,o=gn){const l=this.elements,c=1/(e-t),h=1/(n-i),d=1/(a-r),f=(e+t)*c,p=(n+i)*h;let g,_;if(o===gn)g=(a+r)*d,_=-2*d;else if(o===Hs)g=r*d,_=-1*d;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return l[0]=2*c,l[4]=0,l[8]=0,l[12]=-f,l[1]=0,l[5]=2*h,l[9]=0,l[13]=-p,l[2]=0,l[6]=0,l[10]=_,l[14]=-g,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(t){const e=this.elements,n=t.elements;for(let i=0;i<16;i++)if(e[i]!==n[i])return!1;return!0}fromArray(t,e=0){for(let n=0;n<16;n++)this.elements[n]=t[n+e];return this}toArray(t=[],e=0){const n=this.elements;return t[e]=n[0],t[e+1]=n[1],t[e+2]=n[2],t[e+3]=n[3],t[e+4]=n[4],t[e+5]=n[5],t[e+6]=n[6],t[e+7]=n[7],t[e+8]=n[8],t[e+9]=n[9],t[e+10]=n[10],t[e+11]=n[11],t[e+12]=n[12],t[e+13]=n[13],t[e+14]=n[14],t[e+15]=n[15],t}}const ai=new R,je=new Zt,mh=new R(0,0,0),gh=new R(1,1,1),Tn=new R,hs=new R,ze=new R,uo=new Zt,fo=new Nn;class Be{constructor(t=0,e=0,n=0,i=Be.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=e,this._z=n,this._order=i}get x(){return this._x}set x(t){this._x=t,this._onChangeCallback()}get y(){return this._y}set y(t){this._y=t,this._onChangeCallback()}get z(){return this._z}set z(t){this._z=t,this._onChangeCallback()}get order(){return this._order}set order(t){this._order=t,this._onChangeCallback()}set(t,e,n,i=this._order){return this._x=t,this._y=e,this._z=n,this._order=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(t){return this._x=t._x,this._y=t._y,this._z=t._z,this._order=t._order,this._onChangeCallback(),this}setFromRotationMatrix(t,e=this._order,n=!0){const i=t.elements,r=i[0],a=i[4],o=i[8],l=i[1],c=i[5],h=i[9],d=i[2],f=i[6],p=i[10];switch(e){case"XYZ":this._y=Math.asin(Pe(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-h,p),this._z=Math.atan2(-a,r)):(this._x=Math.atan2(f,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Pe(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(o,p),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-d,r),this._z=0);break;case"ZXY":this._x=Math.asin(Pe(f,-1,1)),Math.abs(f)<.9999999?(this._y=Math.atan2(-d,p),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(l,r));break;case"ZYX":this._y=Math.asin(-Pe(d,-1,1)),Math.abs(d)<.9999999?(this._x=Math.atan2(f,p),this._z=Math.atan2(l,r)):(this._x=0,this._z=Math.atan2(-a,c));break;case"YZX":this._z=Math.asin(Pe(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-d,r)):(this._x=0,this._y=Math.atan2(o,p));break;case"XZY":this._z=Math.asin(-Pe(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(f,c),this._y=Math.atan2(o,r)):(this._x=Math.atan2(-h,p),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+e)}return this._order=e,n===!0&&this._onChangeCallback(),this}setFromQuaternion(t,e,n){return uo.makeRotationFromQuaternion(t),this.setFromRotationMatrix(uo,e,n)}setFromVector3(t,e=this._order){return this.set(t.x,t.y,t.z,e)}reorder(t){return fo.setFromEuler(this),this.setFromQuaternion(fo,t)}equals(t){return t._x===this._x&&t._y===this._y&&t._z===this._z&&t._order===this._order}fromArray(t){return this._x=t[0],this._y=t[1],this._z=t[2],t[3]!==void 0&&(this._order=t[3]),this._onChangeCallback(),this}toArray(t=[],e=0){return t[e]=this._x,t[e+1]=this._y,t[e+2]=this._z,t[e+3]=this._order,t}_onChange(t){return this._onChangeCallback=t,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}Be.DEFAULT_ORDER="XYZ";class Ul{constructor(){this.mask=1}set(t){this.mask=(1<<t|0)>>>0}enable(t){this.mask|=1<<t|0}enableAll(){this.mask=-1}toggle(t){this.mask^=1<<t|0}disable(t){this.mask&=~(1<<t|0)}disableAll(){this.mask=0}test(t){return(this.mask&t.mask)!==0}isEnabled(t){return(this.mask&(1<<t|0))!==0}}let _h=0;const po=new R,oi=new Nn,un=new Zt,us=new R,Bi=new R,vh=new R,xh=new Nn,mo=new R(1,0,0),go=new R(0,1,0),_o=new R(0,0,1),vo={type:"added"},Mh={type:"removed"},li={type:"childadded",child:null},hr={type:"childremoved",child:null};class jt extends Li{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:_h++}),this.uuid=_n(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=jt.DEFAULT_UP.clone();const t=new R,e=new Be,n=new Nn,i=new R(1,1,1);function r(){n.setFromEuler(e,!1)}function a(){e.setFromQuaternion(n,void 0,!1)}e._onChange(r),n._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:e},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new Zt},normalMatrix:{value:new Dt}}),this.matrix=new Zt,this.matrixWorld=new Zt,this.matrixAutoUpdate=jt.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=jt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Ul,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(t){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(t),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(t){return this.quaternion.premultiply(t),this}setRotationFromAxisAngle(t,e){this.quaternion.setFromAxisAngle(t,e)}setRotationFromEuler(t){this.quaternion.setFromEuler(t,!0)}setRotationFromMatrix(t){this.quaternion.setFromRotationMatrix(t)}setRotationFromQuaternion(t){this.quaternion.copy(t)}rotateOnAxis(t,e){return oi.setFromAxisAngle(t,e),this.quaternion.multiply(oi),this}rotateOnWorldAxis(t,e){return oi.setFromAxisAngle(t,e),this.quaternion.premultiply(oi),this}rotateX(t){return this.rotateOnAxis(mo,t)}rotateY(t){return this.rotateOnAxis(go,t)}rotateZ(t){return this.rotateOnAxis(_o,t)}translateOnAxis(t,e){return po.copy(t).applyQuaternion(this.quaternion),this.position.add(po.multiplyScalar(e)),this}translateX(t){return this.translateOnAxis(mo,t)}translateY(t){return this.translateOnAxis(go,t)}translateZ(t){return this.translateOnAxis(_o,t)}localToWorld(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(this.matrixWorld)}worldToLocal(t){return this.updateWorldMatrix(!0,!1),t.applyMatrix4(un.copy(this.matrixWorld).invert())}lookAt(t,e,n){t.isVector3?us.copy(t):us.set(t,e,n);const i=this.parent;this.updateWorldMatrix(!0,!1),Bi.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?un.lookAt(Bi,us,this.up):un.lookAt(us,Bi,this.up),this.quaternion.setFromRotationMatrix(un),i&&(un.extractRotation(i.matrixWorld),oi.setFromRotationMatrix(un),this.quaternion.premultiply(oi.invert()))}add(t){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return t===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",t),this):(t&&t.isObject3D?(t.removeFromParent(),t.parent=this,this.children.push(t),t.dispatchEvent(vo),li.child=t,this.dispatchEvent(li),li.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",t),this)}remove(t){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const e=this.children.indexOf(t);return e!==-1&&(t.parent=null,this.children.splice(e,1),t.dispatchEvent(Mh),hr.child=t,this.dispatchEvent(hr),hr.child=null),this}removeFromParent(){const t=this.parent;return t!==null&&t.remove(this),this}clear(){return this.remove(...this.children)}attach(t){return this.updateWorldMatrix(!0,!1),un.copy(this.matrixWorld).invert(),t.parent!==null&&(t.parent.updateWorldMatrix(!0,!1),un.multiply(t.parent.matrixWorld)),t.applyMatrix4(un),t.removeFromParent(),t.parent=this,this.children.push(t),t.updateWorldMatrix(!1,!0),t.dispatchEvent(vo),li.child=t,this.dispatchEvent(li),li.child=null,this}getObjectById(t){return this.getObjectByProperty("id",t)}getObjectByName(t){return this.getObjectByProperty("name",t)}getObjectByProperty(t,e){if(this[t]===e)return this;for(let n=0,i=this.children.length;n<i;n++){const a=this.children[n].getObjectByProperty(t,e);if(a!==void 0)return a}}getObjectsByProperty(t,e,n=[]){this[t]===e&&n.push(this);const i=this.children;for(let r=0,a=i.length;r<a;r++)i[r].getObjectsByProperty(t,e,n);return n}getWorldPosition(t){return this.updateWorldMatrix(!0,!1),t.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Bi,t,vh),t}getWorldScale(t){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(Bi,xh,t),t}getWorldDirection(t){this.updateWorldMatrix(!0,!1);const e=this.matrixWorld.elements;return t.set(e[8],e[9],e[10]).normalize()}raycast(){}traverse(t){t(this);const e=this.children;for(let n=0,i=e.length;n<i;n++)e[n].traverse(t)}traverseVisible(t){if(this.visible===!1)return;t(this);const e=this.children;for(let n=0,i=e.length;n<i;n++)e[n].traverseVisible(t)}traverseAncestors(t){const e=this.parent;e!==null&&(t(e),e.traverseAncestors(t))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(t){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||t)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,t=!0);const e=this.children;for(let n=0,i=e.length;n<i;n++)e[n].updateMatrixWorld(t)}updateWorldMatrix(t,e){const n=this.parent;if(t===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),e===!0){const i=this.children;for(let r=0,a=i.length;r<a;r++)i[r].updateWorldMatrix(!1,!0)}}toJSON(t){const e=t===void 0||typeof t=="string",n={};e&&(t={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});const i={};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.castShadow===!0&&(i.castShadow=!0),this.receiveShadow===!0&&(i.receiveShadow=!0),this.visible===!1&&(i.visible=!1),this.frustumCulled===!1&&(i.frustumCulled=!1),this.renderOrder!==0&&(i.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(i.userData=this.userData),i.layers=this.layers.mask,i.matrix=this.matrix.toArray(),i.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(i.matrixAutoUpdate=!1),this.isInstancedMesh&&(i.type="InstancedMesh",i.count=this.count,i.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(i.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(i.type="BatchedMesh",i.perObjectFrustumCulled=this.perObjectFrustumCulled,i.sortObjects=this.sortObjects,i.drawRanges=this._drawRanges,i.reservedRanges=this._reservedRanges,i.visibility=this._visibility,i.active=this._active,i.bounds=this._bounds.map(o=>({boxInitialized:o.boxInitialized,boxMin:o.box.min.toArray(),boxMax:o.box.max.toArray(),sphereInitialized:o.sphereInitialized,sphereRadius:o.sphere.radius,sphereCenter:o.sphere.center.toArray()})),i.maxInstanceCount=this._maxInstanceCount,i.maxVertexCount=this._maxVertexCount,i.maxIndexCount=this._maxIndexCount,i.geometryInitialized=this._geometryInitialized,i.geometryCount=this._geometryCount,i.matricesTexture=this._matricesTexture.toJSON(t),this._colorsTexture!==null&&(i.colorsTexture=this._colorsTexture.toJSON(t)),this.boundingSphere!==null&&(i.boundingSphere={center:i.boundingSphere.center.toArray(),radius:i.boundingSphere.radius}),this.boundingBox!==null&&(i.boundingBox={min:i.boundingBox.min.toArray(),max:i.boundingBox.max.toArray()}));function r(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(t)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?i.background=this.background.toJSON():this.background.isTexture&&(i.background=this.background.toJSON(t).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(i.environment=this.environment.toJSON(t).uuid);else if(this.isMesh||this.isLine||this.isPoints){i.geometry=r(t.geometries,this.geometry);const o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){const l=o.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){const d=l[c];r(t.shapes,d)}else r(t.shapes,l)}}if(this.isSkinnedMesh&&(i.bindMode=this.bindMode,i.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(t.skeletons,this.skeleton),i.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const o=[];for(let l=0,c=this.material.length;l<c;l++)o.push(r(t.materials,this.material[l]));i.material=o}else i.material=r(t.materials,this.material);if(this.children.length>0){i.children=[];for(let o=0;o<this.children.length;o++)i.children.push(this.children[o].toJSON(t).object)}if(this.animations.length>0){i.animations=[];for(let o=0;o<this.animations.length;o++){const l=this.animations[o];i.animations.push(r(t.animations,l))}}if(e){const o=a(t.geometries),l=a(t.materials),c=a(t.textures),h=a(t.images),d=a(t.shapes),f=a(t.skeletons),p=a(t.animations),g=a(t.nodes);o.length>0&&(n.geometries=o),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),d.length>0&&(n.shapes=d),f.length>0&&(n.skeletons=f),p.length>0&&(n.animations=p),g.length>0&&(n.nodes=g)}return n.object=i,n;function a(o){const l=[];for(const c in o){const h=o[c];delete h.metadata,l.push(h)}return l}}clone(t){return new this.constructor().copy(this,t)}copy(t,e=!0){if(this.name=t.name,this.up.copy(t.up),this.position.copy(t.position),this.rotation.order=t.rotation.order,this.quaternion.copy(t.quaternion),this.scale.copy(t.scale),this.matrix.copy(t.matrix),this.matrixWorld.copy(t.matrixWorld),this.matrixAutoUpdate=t.matrixAutoUpdate,this.matrixWorldAutoUpdate=t.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=t.matrixWorldNeedsUpdate,this.layers.mask=t.layers.mask,this.visible=t.visible,this.castShadow=t.castShadow,this.receiveShadow=t.receiveShadow,this.frustumCulled=t.frustumCulled,this.renderOrder=t.renderOrder,this.animations=t.animations.slice(),this.userData=JSON.parse(JSON.stringify(t.userData)),e===!0)for(let n=0;n<t.children.length;n++){const i=t.children[n];this.add(i.clone())}return this}}jt.DEFAULT_UP=new R(0,1,0);jt.DEFAULT_MATRIX_AUTO_UPDATE=!0;jt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const Ze=new R,dn=new R,ur=new R,fn=new R,ci=new R,hi=new R,xo=new R,dr=new R,fr=new R,pr=new R,mr=new Qt,gr=new Qt,_r=new Qt;class qe{constructor(t=new R,e=new R,n=new R){this.a=t,this.b=e,this.c=n}static getNormal(t,e,n,i){i.subVectors(n,e),Ze.subVectors(t,e),i.cross(Ze);const r=i.lengthSq();return r>0?i.multiplyScalar(1/Math.sqrt(r)):i.set(0,0,0)}static getBarycoord(t,e,n,i,r){Ze.subVectors(i,e),dn.subVectors(n,e),ur.subVectors(t,e);const a=Ze.dot(Ze),o=Ze.dot(dn),l=Ze.dot(ur),c=dn.dot(dn),h=dn.dot(ur),d=a*c-o*o;if(d===0)return r.set(0,0,0),null;const f=1/d,p=(c*l-o*h)*f,g=(a*h-o*l)*f;return r.set(1-p-g,g,p)}static containsPoint(t,e,n,i){return this.getBarycoord(t,e,n,i,fn)===null?!1:fn.x>=0&&fn.y>=0&&fn.x+fn.y<=1}static getInterpolation(t,e,n,i,r,a,o,l){return this.getBarycoord(t,e,n,i,fn)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(r,fn.x),l.addScaledVector(a,fn.y),l.addScaledVector(o,fn.z),l)}static getInterpolatedAttribute(t,e,n,i,r,a){return mr.setScalar(0),gr.setScalar(0),_r.setScalar(0),mr.fromBufferAttribute(t,e),gr.fromBufferAttribute(t,n),_r.fromBufferAttribute(t,i),a.setScalar(0),a.addScaledVector(mr,r.x),a.addScaledVector(gr,r.y),a.addScaledVector(_r,r.z),a}static isFrontFacing(t,e,n,i){return Ze.subVectors(n,e),dn.subVectors(t,e),Ze.cross(dn).dot(i)<0}set(t,e,n){return this.a.copy(t),this.b.copy(e),this.c.copy(n),this}setFromPointsAndIndices(t,e,n,i){return this.a.copy(t[e]),this.b.copy(t[n]),this.c.copy(t[i]),this}setFromAttributeAndIndices(t,e,n,i){return this.a.fromBufferAttribute(t,e),this.b.fromBufferAttribute(t,n),this.c.fromBufferAttribute(t,i),this}clone(){return new this.constructor().copy(this)}copy(t){return this.a.copy(t.a),this.b.copy(t.b),this.c.copy(t.c),this}getArea(){return Ze.subVectors(this.c,this.b),dn.subVectors(this.a,this.b),Ze.cross(dn).length()*.5}getMidpoint(t){return t.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return qe.getNormal(this.a,this.b,this.c,t)}getPlane(t){return t.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,e){return qe.getBarycoord(t,this.a,this.b,this.c,e)}getInterpolation(t,e,n,i,r){return qe.getInterpolation(t,this.a,this.b,this.c,e,n,i,r)}containsPoint(t){return qe.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return qe.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(t){return t.intersectsTriangle(this)}closestPointToPoint(t,e){const n=this.a,i=this.b,r=this.c;let a,o;ci.subVectors(i,n),hi.subVectors(r,n),dr.subVectors(t,n);const l=ci.dot(dr),c=hi.dot(dr);if(l<=0&&c<=0)return e.copy(n);fr.subVectors(t,i);const h=ci.dot(fr),d=hi.dot(fr);if(h>=0&&d<=h)return e.copy(i);const f=l*d-h*c;if(f<=0&&l>=0&&h<=0)return a=l/(l-h),e.copy(n).addScaledVector(ci,a);pr.subVectors(t,r);const p=ci.dot(pr),g=hi.dot(pr);if(g>=0&&p<=g)return e.copy(r);const _=p*c-l*g;if(_<=0&&c>=0&&g<=0)return o=c/(c-g),e.copy(n).addScaledVector(hi,o);const m=h*g-p*d;if(m<=0&&d-h>=0&&p-g>=0)return xo.subVectors(r,i),o=(d-h)/(d-h+(p-g)),e.copy(i).addScaledVector(xo,o);const u=1/(m+_+f);return a=_*u,o=f*u,e.copy(n).addScaledVector(ci,a).addScaledVector(hi,o)}equals(t){return t.a.equals(this.a)&&t.b.equals(this.b)&&t.c.equals(this.c)}}const Nl={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},An={h:0,s:0,l:0},ds={h:0,s:0,l:0};function vr(s,t,e){return e<0&&(e+=1),e>1&&(e-=1),e<1/6?s+(t-s)*6*e:e<1/2?t:e<2/3?s+(t-s)*6*(2/3-e):s}class Ft{constructor(t,e,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(t,e,n)}set(t,e,n){if(e===void 0&&n===void 0){const i=t;i&&i.isColor?this.copy(i):typeof i=="number"?this.setHex(i):typeof i=="string"&&this.setStyle(i)}else this.setRGB(t,e,n);return this}setScalar(t){return this.r=t,this.g=t,this.b=t,this}setHex(t,e=Oe){return t=Math.floor(t),this.r=(t>>16&255)/255,this.g=(t>>8&255)/255,this.b=(t&255)/255,Wt.toWorkingColorSpace(this,e),this}setRGB(t,e,n,i=Wt.workingColorSpace){return this.r=t,this.g=e,this.b=n,Wt.toWorkingColorSpace(this,i),this}setHSL(t,e,n,i=Wt.workingColorSpace){if(t=Ua(t,1),e=Pe(e,0,1),n=Pe(n,0,1),e===0)this.r=this.g=this.b=n;else{const r=n<=.5?n*(1+e):n+e-n*e,a=2*n-r;this.r=vr(a,r,t+1/3),this.g=vr(a,r,t),this.b=vr(a,r,t-1/3)}return Wt.toWorkingColorSpace(this,i),this}setStyle(t,e=Oe){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+t+" will be ignored.")}let i;if(i=/^(\w+)\(([^\)]*)\)/.exec(t)){let r;const a=i[1],o=i[2];switch(a){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,e);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,e);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,e);break;default:console.warn("THREE.Color: Unknown color model "+t)}}else if(i=/^\#([A-Fa-f\d]+)$/.exec(t)){const r=i[1],a=r.length;if(a===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,e);if(a===6)return this.setHex(parseInt(r,16),e);console.warn("THREE.Color: Invalid hex color "+t)}else if(t&&t.length>0)return this.setColorName(t,e);return this}setColorName(t,e=Oe){const n=Nl[t.toLowerCase()];return n!==void 0?this.setHex(n,e):console.warn("THREE.Color: Unknown color "+t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(t){return this.r=t.r,this.g=t.g,this.b=t.b,this}copySRGBToLinear(t){return this.r=vn(t.r),this.g=vn(t.g),this.b=vn(t.b),this}copyLinearToSRGB(t){return this.r=Ei(t.r),this.g=Ei(t.g),this.b=Ei(t.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(t=Oe){return Wt.fromWorkingColorSpace(we.copy(this),t),Math.round(Pe(we.r*255,0,255))*65536+Math.round(Pe(we.g*255,0,255))*256+Math.round(Pe(we.b*255,0,255))}getHexString(t=Oe){return("000000"+this.getHex(t).toString(16)).slice(-6)}getHSL(t,e=Wt.workingColorSpace){Wt.fromWorkingColorSpace(we.copy(this),e);const n=we.r,i=we.g,r=we.b,a=Math.max(n,i,r),o=Math.min(n,i,r);let l,c;const h=(o+a)/2;if(o===a)l=0,c=0;else{const d=a-o;switch(c=h<=.5?d/(a+o):d/(2-a-o),a){case n:l=(i-r)/d+(i<r?6:0);break;case i:l=(r-n)/d+2;break;case r:l=(n-i)/d+4;break}l/=6}return t.h=l,t.s=c,t.l=h,t}getRGB(t,e=Wt.workingColorSpace){return Wt.fromWorkingColorSpace(we.copy(this),e),t.r=we.r,t.g=we.g,t.b=we.b,t}getStyle(t=Oe){Wt.fromWorkingColorSpace(we.copy(this),t);const e=we.r,n=we.g,i=we.b;return t!==Oe?`color(${t} ${e.toFixed(3)} ${n.toFixed(3)} ${i.toFixed(3)})`:`rgb(${Math.round(e*255)},${Math.round(n*255)},${Math.round(i*255)})`}offsetHSL(t,e,n){return this.getHSL(An),this.setHSL(An.h+t,An.s+e,An.l+n)}add(t){return this.r+=t.r,this.g+=t.g,this.b+=t.b,this}addColors(t,e){return this.r=t.r+e.r,this.g=t.g+e.g,this.b=t.b+e.b,this}addScalar(t){return this.r+=t,this.g+=t,this.b+=t,this}sub(t){return this.r=Math.max(0,this.r-t.r),this.g=Math.max(0,this.g-t.g),this.b=Math.max(0,this.b-t.b),this}multiply(t){return this.r*=t.r,this.g*=t.g,this.b*=t.b,this}multiplyScalar(t){return this.r*=t,this.g*=t,this.b*=t,this}lerp(t,e){return this.r+=(t.r-this.r)*e,this.g+=(t.g-this.g)*e,this.b+=(t.b-this.b)*e,this}lerpColors(t,e,n){return this.r=t.r+(e.r-t.r)*n,this.g=t.g+(e.g-t.g)*n,this.b=t.b+(e.b-t.b)*n,this}lerpHSL(t,e){this.getHSL(An),t.getHSL(ds);const n=Zi(An.h,ds.h,e),i=Zi(An.s,ds.s,e),r=Zi(An.l,ds.l,e);return this.setHSL(n,i,r),this}setFromVector3(t){return this.r=t.x,this.g=t.y,this.b=t.z,this}applyMatrix3(t){const e=this.r,n=this.g,i=this.b,r=t.elements;return this.r=r[0]*e+r[3]*n+r[6]*i,this.g=r[1]*e+r[4]*n+r[7]*i,this.b=r[2]*e+r[5]*n+r[8]*i,this}equals(t){return t.r===this.r&&t.g===this.g&&t.b===this.b}fromArray(t,e=0){return this.r=t[e],this.g=t[e+1],this.b=t[e+2],this}toArray(t=[],e=0){return t[e]=this.r,t[e+1]=this.g,t[e+2]=this.b,t}fromBufferAttribute(t,e){return this.r=t.getX(e),this.g=t.getY(e),this.b=t.getZ(e),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const we=new Ft;Ft.NAMES=Nl;let yh=0;class Fn extends Li{static get type(){return"Material"}get type(){return this.constructor.type}set type(t){}constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:yh++}),this.uuid=_n(),this.name="",this.blending=yi,this.side=Dn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Fr,this.blendDst=Or,this.blendEquation=qn,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Ft(0,0,0),this.blendAlpha=0,this.depthFunc=wi,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=eo,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=ei,this.stencilZFail=ei,this.stencilZPass=ei,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(t){this._alphaTest>0!=t>0&&this.version++,this._alphaTest=t}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(t){if(t!==void 0)for(const e in t){const n=t[e];if(n===void 0){console.warn(`THREE.Material: parameter '${e}' has value of undefined.`);continue}const i=this[e];if(i===void 0){console.warn(`THREE.Material: '${e}' is not a property of THREE.${this.type}.`);continue}i&&i.isColor?i.set(n):i&&i.isVector3&&n&&n.isVector3?i.copy(n):this[e]=n}}toJSON(t){const e=t===void 0||typeof t=="string";e&&(t={textures:{},images:{}});const n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(t).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(t).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(t).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(t).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(t).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(t).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(t).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(t).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(t).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(t).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(t).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(t).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(t).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(t).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(t).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(t).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(t).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(t).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(t).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(t).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(t).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(t).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(t).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(t).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==yi&&(n.blending=this.blending),this.side!==Dn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Fr&&(n.blendSrc=this.blendSrc),this.blendDst!==Or&&(n.blendDst=this.blendDst),this.blendEquation!==qn&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==wi&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==eo&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==ei&&(n.stencilFail=this.stencilFail),this.stencilZFail!==ei&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==ei&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function i(r){const a=[];for(const o in r){const l=r[o];delete l.metadata,a.push(l)}return a}if(e){const r=i(t.textures),a=i(t.images);r.length>0&&(n.textures=r),a.length>0&&(n.images=a)}return n}clone(){return new this.constructor().copy(this)}copy(t){this.name=t.name,this.blending=t.blending,this.side=t.side,this.vertexColors=t.vertexColors,this.opacity=t.opacity,this.transparent=t.transparent,this.blendSrc=t.blendSrc,this.blendDst=t.blendDst,this.blendEquation=t.blendEquation,this.blendSrcAlpha=t.blendSrcAlpha,this.blendDstAlpha=t.blendDstAlpha,this.blendEquationAlpha=t.blendEquationAlpha,this.blendColor.copy(t.blendColor),this.blendAlpha=t.blendAlpha,this.depthFunc=t.depthFunc,this.depthTest=t.depthTest,this.depthWrite=t.depthWrite,this.stencilWriteMask=t.stencilWriteMask,this.stencilFunc=t.stencilFunc,this.stencilRef=t.stencilRef,this.stencilFuncMask=t.stencilFuncMask,this.stencilFail=t.stencilFail,this.stencilZFail=t.stencilZFail,this.stencilZPass=t.stencilZPass,this.stencilWrite=t.stencilWrite;const e=t.clippingPlanes;let n=null;if(e!==null){const i=e.length;n=new Array(i);for(let r=0;r!==i;++r)n[r]=e[r].clone()}return this.clippingPlanes=n,this.clipIntersection=t.clipIntersection,this.clipShadows=t.clipShadows,this.shadowSide=t.shadowSide,this.colorWrite=t.colorWrite,this.precision=t.precision,this.polygonOffset=t.polygonOffset,this.polygonOffsetFactor=t.polygonOffsetFactor,this.polygonOffsetUnits=t.polygonOffsetUnits,this.dithering=t.dithering,this.alphaTest=t.alphaTest,this.alphaHash=t.alphaHash,this.alphaToCoverage=t.alphaToCoverage,this.premultipliedAlpha=t.premultipliedAlpha,this.forceSinglePass=t.forceSinglePass,this.visible=t.visible,this.toneMapped=t.toneMapped,this.userData=JSON.parse(JSON.stringify(t.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(t){t===!0&&this.version++}onBuild(){console.warn("Material: onBuild() has been removed.")}}class St extends Fn{static get type(){return"MeshBasicMaterial"}constructor(t){super(),this.isMeshBasicMaterial=!0,this.color=new Ft(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Be,this.combine=_l,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.specularMap=t.specularMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.combine=t.combine,this.reflectivity=t.reflectivity,this.refractionRatio=t.refractionRatio,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.fog=t.fog,this}}const ge=new R,fs=new Ct;class Ie{constructor(t,e,n=!1){if(Array.isArray(t))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=t,this.itemSize=e,this.count=t!==void 0?t.length/e:0,this.normalized=n,this.usage=ya,this.updateRanges=[],this.gpuType=an,this.version=0}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.name=t.name,this.array=new t.array.constructor(t.array),this.itemSize=t.itemSize,this.count=t.count,this.normalized=t.normalized,this.usage=t.usage,this.gpuType=t.gpuType,this}copyAt(t,e,n){t*=this.itemSize,n*=e.itemSize;for(let i=0,r=this.itemSize;i<r;i++)this.array[t+i]=e.array[n+i];return this}copyArray(t){return this.array.set(t),this}applyMatrix3(t){if(this.itemSize===2)for(let e=0,n=this.count;e<n;e++)fs.fromBufferAttribute(this,e),fs.applyMatrix3(t),this.setXY(e,fs.x,fs.y);else if(this.itemSize===3)for(let e=0,n=this.count;e<n;e++)ge.fromBufferAttribute(this,e),ge.applyMatrix3(t),this.setXYZ(e,ge.x,ge.y,ge.z);return this}applyMatrix4(t){for(let e=0,n=this.count;e<n;e++)ge.fromBufferAttribute(this,e),ge.applyMatrix4(t),this.setXYZ(e,ge.x,ge.y,ge.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)ge.fromBufferAttribute(this,e),ge.applyNormalMatrix(t),this.setXYZ(e,ge.x,ge.y,ge.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)ge.fromBufferAttribute(this,e),ge.transformDirection(t),this.setXYZ(e,ge.x,ge.y,ge.z);return this}set(t,e=0){return this.array.set(t,e),this}getComponent(t,e){let n=this.array[t*this.itemSize+e];return this.normalized&&(n=Qe(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=Kt(n,this.array)),this.array[t*this.itemSize+e]=n,this}getX(t){let e=this.array[t*this.itemSize];return this.normalized&&(e=Qe(e,this.array)),e}setX(t,e){return this.normalized&&(e=Kt(e,this.array)),this.array[t*this.itemSize]=e,this}getY(t){let e=this.array[t*this.itemSize+1];return this.normalized&&(e=Qe(e,this.array)),e}setY(t,e){return this.normalized&&(e=Kt(e,this.array)),this.array[t*this.itemSize+1]=e,this}getZ(t){let e=this.array[t*this.itemSize+2];return this.normalized&&(e=Qe(e,this.array)),e}setZ(t,e){return this.normalized&&(e=Kt(e,this.array)),this.array[t*this.itemSize+2]=e,this}getW(t){let e=this.array[t*this.itemSize+3];return this.normalized&&(e=Qe(e,this.array)),e}setW(t,e){return this.normalized&&(e=Kt(e,this.array)),this.array[t*this.itemSize+3]=e,this}setXY(t,e,n){return t*=this.itemSize,this.normalized&&(e=Kt(e,this.array),n=Kt(n,this.array)),this.array[t+0]=e,this.array[t+1]=n,this}setXYZ(t,e,n,i){return t*=this.itemSize,this.normalized&&(e=Kt(e,this.array),n=Kt(n,this.array),i=Kt(i,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=i,this}setXYZW(t,e,n,i,r){return t*=this.itemSize,this.normalized&&(e=Kt(e,this.array),n=Kt(n,this.array),i=Kt(i,this.array),r=Kt(r,this.array)),this.array[t+0]=e,this.array[t+1]=n,this.array[t+2]=i,this.array[t+3]=r,this}onUpload(t){return this.onUploadCallback=t,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const t={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(t.name=this.name),this.usage!==ya&&(t.usage=this.usage),t}}class Fl extends Ie{constructor(t,e,n){super(new Uint16Array(t),e,n)}}class Ol extends Ie{constructor(t,e,n){super(new Uint32Array(t),e,n)}}class ie extends Ie{constructor(t,e,n){super(new Float32Array(t),e,n)}}let Sh=0;const Xe=new Zt,xr=new jt,ui=new R,He=new Jn,ki=new Jn,Me=new R;class _e extends Li{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Sh++}),this.uuid=_n(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(t){return Array.isArray(t)?this.index=new(Ll(t)?Ol:Fl)(t,1):this.index=t,this}setIndirect(t){return this.indirect=t,this}getIndirect(){return this.indirect}getAttribute(t){return this.attributes[t]}setAttribute(t,e){return this.attributes[t]=e,this}deleteAttribute(t){return delete this.attributes[t],this}hasAttribute(t){return this.attributes[t]!==void 0}addGroup(t,e,n=0){this.groups.push({start:t,count:e,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(t,e){this.drawRange.start=t,this.drawRange.count=e}applyMatrix4(t){const e=this.attributes.position;e!==void 0&&(e.applyMatrix4(t),e.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const r=new Dt().getNormalMatrix(t);n.applyNormalMatrix(r),n.needsUpdate=!0}const i=this.attributes.tangent;return i!==void 0&&(i.transformDirection(t),i.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(t){return Xe.makeRotationFromQuaternion(t),this.applyMatrix4(Xe),this}rotateX(t){return Xe.makeRotationX(t),this.applyMatrix4(Xe),this}rotateY(t){return Xe.makeRotationY(t),this.applyMatrix4(Xe),this}rotateZ(t){return Xe.makeRotationZ(t),this.applyMatrix4(Xe),this}translate(t,e,n){return Xe.makeTranslation(t,e,n),this.applyMatrix4(Xe),this}scale(t,e,n){return Xe.makeScale(t,e,n),this.applyMatrix4(Xe),this}lookAt(t){return xr.lookAt(t),xr.updateMatrix(),this.applyMatrix4(xr.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(ui).negate(),this.translate(ui.x,ui.y,ui.z),this}setFromPoints(t){const e=this.getAttribute("position");if(e===void 0){const n=[];for(let i=0,r=t.length;i<r;i++){const a=t[i];n.push(a.x,a.y,a.z||0)}this.setAttribute("position",new ie(n,3))}else{for(let n=0,i=e.count;n<i;n++){const r=t[n];e.setXYZ(n,r.x,r.y,r.z||0)}t.length>e.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),e.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Jn);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new R(-1/0,-1/0,-1/0),new R(1/0,1/0,1/0));return}if(t!==void 0){if(this.boundingBox.setFromBufferAttribute(t),e)for(let n=0,i=e.length;n<i;n++){const r=e[n];He.setFromBufferAttribute(r),this.morphTargetsRelative?(Me.addVectors(this.boundingBox.min,He.min),this.boundingBox.expandByPoint(Me),Me.addVectors(this.boundingBox.max,He.max),this.boundingBox.expandByPoint(Me)):(this.boundingBox.expandByPoint(He.min),this.boundingBox.expandByPoint(He.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Qn);const t=this.attributes.position,e=this.morphAttributes.position;if(t&&t.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new R,1/0);return}if(t){const n=this.boundingSphere.center;if(He.setFromBufferAttribute(t),e)for(let r=0,a=e.length;r<a;r++){const o=e[r];ki.setFromBufferAttribute(o),this.morphTargetsRelative?(Me.addVectors(He.min,ki.min),He.expandByPoint(Me),Me.addVectors(He.max,ki.max),He.expandByPoint(Me)):(He.expandByPoint(ki.min),He.expandByPoint(ki.max))}He.getCenter(n);let i=0;for(let r=0,a=t.count;r<a;r++)Me.fromBufferAttribute(t,r),i=Math.max(i,n.distanceToSquared(Me));if(e)for(let r=0,a=e.length;r<a;r++){const o=e[r],l=this.morphTargetsRelative;for(let c=0,h=o.count;c<h;c++)Me.fromBufferAttribute(o,c),l&&(ui.fromBufferAttribute(t,c),Me.add(ui)),i=Math.max(i,n.distanceToSquared(Me))}this.boundingSphere.radius=Math.sqrt(i),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const t=this.index,e=this.attributes;if(t===null||e.position===void 0||e.normal===void 0||e.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=e.position,i=e.normal,r=e.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Ie(new Float32Array(4*n.count),4));const a=this.getAttribute("tangent"),o=[],l=[];for(let L=0;L<n.count;L++)o[L]=new R,l[L]=new R;const c=new R,h=new R,d=new R,f=new Ct,p=new Ct,g=new Ct,_=new R,m=new R;function u(L,E,M){c.fromBufferAttribute(n,L),h.fromBufferAttribute(n,E),d.fromBufferAttribute(n,M),f.fromBufferAttribute(r,L),p.fromBufferAttribute(r,E),g.fromBufferAttribute(r,M),h.sub(c),d.sub(c),p.sub(f),g.sub(f);const C=1/(p.x*g.y-g.x*p.y);isFinite(C)&&(_.copy(h).multiplyScalar(g.y).addScaledVector(d,-p.y).multiplyScalar(C),m.copy(d).multiplyScalar(p.x).addScaledVector(h,-g.x).multiplyScalar(C),o[L].add(_),o[E].add(_),o[M].add(_),l[L].add(m),l[E].add(m),l[M].add(m))}let S=this.groups;S.length===0&&(S=[{start:0,count:t.count}]);for(let L=0,E=S.length;L<E;++L){const M=S[L],C=M.start,k=M.count;for(let O=C,W=C+k;O<W;O+=3)u(t.getX(O+0),t.getX(O+1),t.getX(O+2))}const w=new R,v=new R,P=new R,T=new R;function A(L){P.fromBufferAttribute(i,L),T.copy(P);const E=o[L];w.copy(E),w.sub(P.multiplyScalar(P.dot(E))).normalize(),v.crossVectors(T,E);const C=v.dot(l[L])<0?-1:1;a.setXYZW(L,w.x,w.y,w.z,C)}for(let L=0,E=S.length;L<E;++L){const M=S[L],C=M.start,k=M.count;for(let O=C,W=C+k;O<W;O+=3)A(t.getX(O+0)),A(t.getX(O+1)),A(t.getX(O+2))}}computeVertexNormals(){const t=this.index,e=this.getAttribute("position");if(e!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new Ie(new Float32Array(e.count*3),3),this.setAttribute("normal",n);else for(let f=0,p=n.count;f<p;f++)n.setXYZ(f,0,0,0);const i=new R,r=new R,a=new R,o=new R,l=new R,c=new R,h=new R,d=new R;if(t)for(let f=0,p=t.count;f<p;f+=3){const g=t.getX(f+0),_=t.getX(f+1),m=t.getX(f+2);i.fromBufferAttribute(e,g),r.fromBufferAttribute(e,_),a.fromBufferAttribute(e,m),h.subVectors(a,r),d.subVectors(i,r),h.cross(d),o.fromBufferAttribute(n,g),l.fromBufferAttribute(n,_),c.fromBufferAttribute(n,m),o.add(h),l.add(h),c.add(h),n.setXYZ(g,o.x,o.y,o.z),n.setXYZ(_,l.x,l.y,l.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let f=0,p=e.count;f<p;f+=3)i.fromBufferAttribute(e,f+0),r.fromBufferAttribute(e,f+1),a.fromBufferAttribute(e,f+2),h.subVectors(a,r),d.subVectors(i,r),h.cross(d),n.setXYZ(f+0,h.x,h.y,h.z),n.setXYZ(f+1,h.x,h.y,h.z),n.setXYZ(f+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const t=this.attributes.normal;for(let e=0,n=t.count;e<n;e++)Me.fromBufferAttribute(t,e),Me.normalize(),t.setXYZ(e,Me.x,Me.y,Me.z)}toNonIndexed(){function t(o,l){const c=o.array,h=o.itemSize,d=o.normalized,f=new c.constructor(l.length*h);let p=0,g=0;for(let _=0,m=l.length;_<m;_++){o.isInterleavedBufferAttribute?p=l[_]*o.data.stride+o.offset:p=l[_]*h;for(let u=0;u<h;u++)f[g++]=c[p++]}return new Ie(f,h,d)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const e=new _e,n=this.index.array,i=this.attributes;for(const o in i){const l=i[o],c=t(l,n);e.setAttribute(o,c)}const r=this.morphAttributes;for(const o in r){const l=[],c=r[o];for(let h=0,d=c.length;h<d;h++){const f=c[h],p=t(f,n);l.push(p)}e.morphAttributes[o]=l}e.morphTargetsRelative=this.morphTargetsRelative;const a=this.groups;for(let o=0,l=a.length;o<l;o++){const c=a[o];e.addGroup(c.start,c.count,c.materialIndex)}return e}toJSON(){const t={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(t.uuid=this.uuid,t.type=this.type,this.name!==""&&(t.name=this.name),Object.keys(this.userData).length>0&&(t.userData=this.userData),this.parameters!==void 0){const l=this.parameters;for(const c in l)l[c]!==void 0&&(t[c]=l[c]);return t}t.data={attributes:{}};const e=this.index;e!==null&&(t.data.index={type:e.array.constructor.name,array:Array.prototype.slice.call(e.array)});const n=this.attributes;for(const l in n){const c=n[l];t.data.attributes[l]=c.toJSON(t.data)}const i={};let r=!1;for(const l in this.morphAttributes){const c=this.morphAttributes[l],h=[];for(let d=0,f=c.length;d<f;d++){const p=c[d];h.push(p.toJSON(t.data))}h.length>0&&(i[l]=h,r=!0)}r&&(t.data.morphAttributes=i,t.data.morphTargetsRelative=this.morphTargetsRelative);const a=this.groups;a.length>0&&(t.data.groups=JSON.parse(JSON.stringify(a)));const o=this.boundingSphere;return o!==null&&(t.data.boundingSphere={center:o.center.toArray(),radius:o.radius}),t}clone(){return new this.constructor().copy(this)}copy(t){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const e={};this.name=t.name;const n=t.index;n!==null&&this.setIndex(n.clone(e));const i=t.attributes;for(const c in i){const h=i[c];this.setAttribute(c,h.clone(e))}const r=t.morphAttributes;for(const c in r){const h=[],d=r[c];for(let f=0,p=d.length;f<p;f++)h.push(d[f].clone(e));this.morphAttributes[c]=h}this.morphTargetsRelative=t.morphTargetsRelative;const a=t.groups;for(let c=0,h=a.length;c<h;c++){const d=a[c];this.addGroup(d.start,d.count,d.materialIndex)}const o=t.boundingBox;o!==null&&(this.boundingBox=o.clone());const l=t.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=t.drawRange.start,this.drawRange.count=t.drawRange.count,this.userData=t.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const Mo=new Zt,zn=new Na,ps=new Qn,yo=new R,ms=new R,gs=new R,_s=new R,Mr=new R,vs=new R,So=new R,xs=new R;class it extends jt{constructor(t=new _e,e=new St){super(),this.isMesh=!0,this.type="Mesh",this.geometry=t,this.material=e,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),t.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=t.morphTargetInfluences.slice()),t.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},t.morphTargetDictionary)),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}updateMorphTargets(){const e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){const i=e[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=i.length;r<a;r++){const o=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}getVertexPosition(t,e){const n=this.geometry,i=n.attributes.position,r=n.morphAttributes.position,a=n.morphTargetsRelative;e.fromBufferAttribute(i,t);const o=this.morphTargetInfluences;if(r&&o){vs.set(0,0,0);for(let l=0,c=r.length;l<c;l++){const h=o[l],d=r[l];h!==0&&(Mr.fromBufferAttribute(d,t),a?vs.addScaledVector(Mr,h):vs.addScaledVector(Mr.sub(e),h))}e.add(vs)}return e}raycast(t,e){const n=this.geometry,i=this.material,r=this.matrixWorld;i!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),ps.copy(n.boundingSphere),ps.applyMatrix4(r),zn.copy(t.ray).recast(t.near),!(ps.containsPoint(zn.origin)===!1&&(zn.intersectSphere(ps,yo)===null||zn.origin.distanceToSquared(yo)>(t.far-t.near)**2))&&(Mo.copy(r).invert(),zn.copy(t.ray).applyMatrix4(Mo),!(n.boundingBox!==null&&zn.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(t,e,zn)))}_computeIntersections(t,e,n){let i;const r=this.geometry,a=this.material,o=r.index,l=r.attributes.position,c=r.attributes.uv,h=r.attributes.uv1,d=r.attributes.normal,f=r.groups,p=r.drawRange;if(o!==null)if(Array.isArray(a))for(let g=0,_=f.length;g<_;g++){const m=f[g],u=a[m.materialIndex],S=Math.max(m.start,p.start),w=Math.min(o.count,Math.min(m.start+m.count,p.start+p.count));for(let v=S,P=w;v<P;v+=3){const T=o.getX(v),A=o.getX(v+1),L=o.getX(v+2);i=Ms(this,u,t,n,c,h,d,T,A,L),i&&(i.faceIndex=Math.floor(v/3),i.face.materialIndex=m.materialIndex,e.push(i))}}else{const g=Math.max(0,p.start),_=Math.min(o.count,p.start+p.count);for(let m=g,u=_;m<u;m+=3){const S=o.getX(m),w=o.getX(m+1),v=o.getX(m+2);i=Ms(this,a,t,n,c,h,d,S,w,v),i&&(i.faceIndex=Math.floor(m/3),e.push(i))}}else if(l!==void 0)if(Array.isArray(a))for(let g=0,_=f.length;g<_;g++){const m=f[g],u=a[m.materialIndex],S=Math.max(m.start,p.start),w=Math.min(l.count,Math.min(m.start+m.count,p.start+p.count));for(let v=S,P=w;v<P;v+=3){const T=v,A=v+1,L=v+2;i=Ms(this,u,t,n,c,h,d,T,A,L),i&&(i.faceIndex=Math.floor(v/3),i.face.materialIndex=m.materialIndex,e.push(i))}}else{const g=Math.max(0,p.start),_=Math.min(l.count,p.start+p.count);for(let m=g,u=_;m<u;m+=3){const S=m,w=m+1,v=m+2;i=Ms(this,a,t,n,c,h,d,S,w,v),i&&(i.faceIndex=Math.floor(m/3),e.push(i))}}}}function Eh(s,t,e,n,i,r,a,o){let l;if(t.side===ye?l=n.intersectTriangle(a,r,i,!0,o):l=n.intersectTriangle(i,r,a,t.side===Dn,o),l===null)return null;xs.copy(o),xs.applyMatrix4(s.matrixWorld);const c=e.ray.origin.distanceTo(xs);return c<e.near||c>e.far?null:{distance:c,point:xs.clone(),object:s}}function Ms(s,t,e,n,i,r,a,o,l,c){s.getVertexPosition(o,ms),s.getVertexPosition(l,gs),s.getVertexPosition(c,_s);const h=Eh(s,t,e,n,ms,gs,_s,So);if(h){const d=new R;qe.getBarycoord(So,ms,gs,_s,d),i&&(h.uv=qe.getInterpolatedAttribute(i,o,l,c,d,new Ct)),r&&(h.uv1=qe.getInterpolatedAttribute(r,o,l,c,d,new Ct)),a&&(h.normal=qe.getInterpolatedAttribute(a,o,l,c,d,new R),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));const f={a:o,b:l,c,normal:new R,materialIndex:0};qe.getNormal(ms,gs,_s,f.normal),h.face=f,h.barycoord=d}return h}class oe extends _e{constructor(t=1,e=1,n=1,i=1,r=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:t,height:e,depth:n,widthSegments:i,heightSegments:r,depthSegments:a};const o=this;i=Math.floor(i),r=Math.floor(r),a=Math.floor(a);const l=[],c=[],h=[],d=[];let f=0,p=0;g("z","y","x",-1,-1,n,e,t,a,r,0),g("z","y","x",1,-1,n,e,-t,a,r,1),g("x","z","y",1,1,t,n,e,i,a,2),g("x","z","y",1,-1,t,n,-e,i,a,3),g("x","y","z",1,-1,t,e,n,i,r,4),g("x","y","z",-1,-1,t,e,-n,i,r,5),this.setIndex(l),this.setAttribute("position",new ie(c,3)),this.setAttribute("normal",new ie(h,3)),this.setAttribute("uv",new ie(d,2));function g(_,m,u,S,w,v,P,T,A,L,E){const M=v/A,C=P/L,k=v/2,O=P/2,W=T/2,X=A+1,H=L+1;let j=0,V=0;const st=new R;for(let ht=0;ht<H;ht++){const Mt=ht*C-O;for(let Ot=0;Ot<X;Ot++){const te=Ot*M-k;st[_]=te*S,st[m]=Mt*w,st[u]=W,c.push(st.x,st.y,st.z),st[_]=0,st[m]=0,st[u]=T>0?1:-1,h.push(st.x,st.y,st.z),d.push(Ot/A),d.push(1-ht/L),j+=1}}for(let ht=0;ht<L;ht++)for(let Mt=0;Mt<A;Mt++){const Ot=f+Mt+X*ht,te=f+Mt+X*(ht+1),Y=f+(Mt+1)+X*(ht+1),tt=f+(Mt+1)+X*ht;l.push(Ot,te,tt),l.push(te,Y,tt),V+=6}o.addGroup(p,V,E),p+=V,f+=j}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new oe(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}}function Ci(s){const t={};for(const e in s){t[e]={};for(const n in s[e]){const i=s[e][n];i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)?i.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),t[e][n]=null):t[e][n]=i.clone():Array.isArray(i)?t[e][n]=i.slice():t[e][n]=i}}return t}function Ce(s){const t={};for(let e=0;e<s.length;e++){const n=Ci(s[e]);for(const i in n)t[i]=n[i]}return t}function wh(s){const t=[];for(let e=0;e<s.length;e++)t.push(s[e].clone());return t}function Bl(s){const t=s.getRenderTarget();return t===null?s.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:Wt.workingColorSpace}const bh={clone:Ci,merge:Ce};var Th=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Ah=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class Un extends Fn{static get type(){return"ShaderMaterial"}constructor(t){super(),this.isShaderMaterial=!0,this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Th,this.fragmentShader=Ah,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,t!==void 0&&this.setValues(t)}copy(t){return super.copy(t),this.fragmentShader=t.fragmentShader,this.vertexShader=t.vertexShader,this.uniforms=Ci(t.uniforms),this.uniformsGroups=wh(t.uniformsGroups),this.defines=Object.assign({},t.defines),this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.fog=t.fog,this.lights=t.lights,this.clipping=t.clipping,this.extensions=Object.assign({},t.extensions),this.glslVersion=t.glslVersion,this}toJSON(t){const e=super.toJSON(t);e.glslVersion=this.glslVersion,e.uniforms={};for(const i in this.uniforms){const a=this.uniforms[i].value;a&&a.isTexture?e.uniforms[i]={type:"t",value:a.toJSON(t).uuid}:a&&a.isColor?e.uniforms[i]={type:"c",value:a.getHex()}:a&&a.isVector2?e.uniforms[i]={type:"v2",value:a.toArray()}:a&&a.isVector3?e.uniforms[i]={type:"v3",value:a.toArray()}:a&&a.isVector4?e.uniforms[i]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?e.uniforms[i]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?e.uniforms[i]={type:"m4",value:a.toArray()}:e.uniforms[i]={value:a}}Object.keys(this.defines).length>0&&(e.defines=this.defines),e.vertexShader=this.vertexShader,e.fragmentShader=this.fragmentShader,e.lights=this.lights,e.clipping=this.clipping;const n={};for(const i in this.extensions)this.extensions[i]===!0&&(n[i]=!0);return Object.keys(n).length>0&&(e.extensions=n),e}}class kl extends jt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Zt,this.projectionMatrix=new Zt,this.projectionMatrixInverse=new Zt,this.coordinateSystem=gn}copy(t,e){return super.copy(t,e),this.matrixWorldInverse.copy(t.matrixWorldInverse),this.projectionMatrix.copy(t.projectionMatrix),this.projectionMatrixInverse.copy(t.projectionMatrixInverse),this.coordinateSystem=t.coordinateSystem,this}getWorldDirection(t){return super.getWorldDirection(t).negate()}updateMatrixWorld(t){super.updateMatrixWorld(t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(t,e){super.updateWorldMatrix(t,e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const Rn=new R,Eo=new Ct,wo=new Ct;class Le extends kl{constructor(t=50,e=1,n=.1,i=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=t,this.zoom=1,this.near=n,this.far=i,this.focus=10,this.aspect=e,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.fov=t.fov,this.zoom=t.zoom,this.near=t.near,this.far=t.far,this.focus=t.focus,this.aspect=t.aspect,this.view=t.view===null?null:Object.assign({},t.view),this.filmGauge=t.filmGauge,this.filmOffset=t.filmOffset,this}setFocalLength(t){const e=.5*this.getFilmHeight()/t;this.fov=ts*2*Math.atan(e),this.updateProjectionMatrix()}getFocalLength(){const t=Math.tan(ji*.5*this.fov);return .5*this.getFilmHeight()/t}getEffectiveFOV(){return ts*2*Math.atan(Math.tan(ji*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(t,e,n){Rn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),e.set(Rn.x,Rn.y).multiplyScalar(-t/Rn.z),Rn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Rn.x,Rn.y).multiplyScalar(-t/Rn.z)}getViewSize(t,e){return this.getViewBounds(t,Eo,wo),e.subVectors(wo,Eo)}setViewOffset(t,e,n,i,r,a){this.aspect=t/e,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=i,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=this.near;let e=t*Math.tan(ji*.5*this.fov)/this.zoom,n=2*e,i=this.aspect*n,r=-.5*i;const a=this.view;if(this.view!==null&&this.view.enabled){const l=a.fullWidth,c=a.fullHeight;r+=a.offsetX*i/l,e-=a.offsetY*n/c,i*=a.width/l,n*=a.height/c}const o=this.filmOffset;o!==0&&(r+=t*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+i,e,e-n,t,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.fov=this.fov,e.object.zoom=this.zoom,e.object.near=this.near,e.object.far=this.far,e.object.focus=this.focus,e.object.aspect=this.aspect,this.view!==null&&(e.object.view=Object.assign({},this.view)),e.object.filmGauge=this.filmGauge,e.object.filmOffset=this.filmOffset,e}}const di=-90,fi=1;class Rh extends jt{constructor(t,e,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const i=new Le(di,fi,t,e);i.layers=this.layers,this.add(i);const r=new Le(di,fi,t,e);r.layers=this.layers,this.add(r);const a=new Le(di,fi,t,e);a.layers=this.layers,this.add(a);const o=new Le(di,fi,t,e);o.layers=this.layers,this.add(o);const l=new Le(di,fi,t,e);l.layers=this.layers,this.add(l);const c=new Le(di,fi,t,e);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){const t=this.coordinateSystem,e=this.children.concat(),[n,i,r,a,o,l]=e;for(const c of e)this.remove(c);if(t===gn)n.up.set(0,1,0),n.lookAt(1,0,0),i.up.set(0,1,0),i.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(t===Hs)n.up.set(0,-1,0),n.lookAt(-1,0,0),i.up.set(0,-1,0),i.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+t);for(const c of e)this.add(c),c.updateMatrixWorld()}update(t,e){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:i}=this;this.coordinateSystem!==t.coordinateSystem&&(this.coordinateSystem=t.coordinateSystem,this.updateCoordinateSystem());const[r,a,o,l,c,h]=this.children,d=t.getRenderTarget(),f=t.getActiveCubeFace(),p=t.getActiveMipmapLevel(),g=t.xr.enabled;t.xr.enabled=!1;const _=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,t.setRenderTarget(n,0,i),t.render(e,r),t.setRenderTarget(n,1,i),t.render(e,a),t.setRenderTarget(n,2,i),t.render(e,o),t.setRenderTarget(n,3,i),t.render(e,l),t.setRenderTarget(n,4,i),t.render(e,c),n.texture.generateMipmaps=_,t.setRenderTarget(n,5,i),t.render(e,h),t.setRenderTarget(d,f,p),t.xr.enabled=g,n.texture.needsPMREMUpdate=!0}}class zl extends Ae{constructor(t,e,n,i,r,a,o,l,c,h){t=t!==void 0?t:[],e=e!==void 0?e:bi,super(t,e,n,i,r,a,o,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(t){this.image=t}}class Ch extends Mn{constructor(t=1,e={}){super(t,t,e),this.isWebGLCubeRenderTarget=!0;const n={width:t,height:t,depth:1},i=[n,n,n,n,n,n];this.texture=new zl(i,e.mapping,e.wrapS,e.wrapT,e.magFilter,e.minFilter,e.format,e.type,e.anisotropy,e.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=e.generateMipmaps!==void 0?e.generateMipmaps:!1,this.texture.minFilter=e.minFilter!==void 0?e.minFilter:rn}fromEquirectangularTexture(t,e){this.texture.type=e.type,this.texture.colorSpace=e.colorSpace,this.texture.generateMipmaps=e.generateMipmaps,this.texture.minFilter=e.minFilter,this.texture.magFilter=e.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},i=new oe(5,5,5),r=new Un({name:"CubemapFromEquirect",uniforms:Ci(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:ye,blending:Ln});r.uniforms.tEquirect.value=e;const a=new it(i,r),o=e.minFilter;return e.minFilter===Kn&&(e.minFilter=rn),new Rh(1,10,this).update(t,a),e.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(t,e,n,i){const r=t.getRenderTarget();for(let a=0;a<6;a++)t.setRenderTarget(this,a),t.clear(e,n,i);t.setRenderTarget(r)}}const yr=new R,Ph=new R,Lh=new Dt;class Wn{constructor(t=new R(1,0,0),e=0){this.isPlane=!0,this.normal=t,this.constant=e}set(t,e){return this.normal.copy(t),this.constant=e,this}setComponents(t,e,n,i){return this.normal.set(t,e,n),this.constant=i,this}setFromNormalAndCoplanarPoint(t,e){return this.normal.copy(t),this.constant=-e.dot(this.normal),this}setFromCoplanarPoints(t,e,n){const i=yr.subVectors(n,e).cross(Ph.subVectors(t,e)).normalize();return this.setFromNormalAndCoplanarPoint(i,t),this}copy(t){return this.normal.copy(t.normal),this.constant=t.constant,this}normalize(){const t=1/this.normal.length();return this.normal.multiplyScalar(t),this.constant*=t,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(t){return this.normal.dot(t)+this.constant}distanceToSphere(t){return this.distanceToPoint(t.center)-t.radius}projectPoint(t,e){return e.copy(t).addScaledVector(this.normal,-this.distanceToPoint(t))}intersectLine(t,e){const n=t.delta(yr),i=this.normal.dot(n);if(i===0)return this.distanceToPoint(t.start)===0?e.copy(t.start):null;const r=-(t.start.dot(this.normal)+this.constant)/i;return r<0||r>1?null:e.copy(t.start).addScaledVector(n,r)}intersectsLine(t){const e=this.distanceToPoint(t.start),n=this.distanceToPoint(t.end);return e<0&&n>0||n<0&&e>0}intersectsBox(t){return t.intersectsPlane(this)}intersectsSphere(t){return t.intersectsPlane(this)}coplanarPoint(t){return t.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(t,e){const n=e||Lh.getNormalMatrix(t),i=this.coplanarPoint(yr).applyMatrix4(t),r=this.normal.applyMatrix3(n).normalize();return this.constant=-i.dot(r),this}translate(t){return this.constant-=t.dot(this.normal),this}equals(t){return t.normal.equals(this.normal)&&t.constant===this.constant}clone(){return new this.constructor().copy(this)}}const Hn=new Qn,ys=new R;class Fa{constructor(t=new Wn,e=new Wn,n=new Wn,i=new Wn,r=new Wn,a=new Wn){this.planes=[t,e,n,i,r,a]}set(t,e,n,i,r,a){const o=this.planes;return o[0].copy(t),o[1].copy(e),o[2].copy(n),o[3].copy(i),o[4].copy(r),o[5].copy(a),this}copy(t){const e=this.planes;for(let n=0;n<6;n++)e[n].copy(t.planes[n]);return this}setFromProjectionMatrix(t,e=gn){const n=this.planes,i=t.elements,r=i[0],a=i[1],o=i[2],l=i[3],c=i[4],h=i[5],d=i[6],f=i[7],p=i[8],g=i[9],_=i[10],m=i[11],u=i[12],S=i[13],w=i[14],v=i[15];if(n[0].setComponents(l-r,f-c,m-p,v-u).normalize(),n[1].setComponents(l+r,f+c,m+p,v+u).normalize(),n[2].setComponents(l+a,f+h,m+g,v+S).normalize(),n[3].setComponents(l-a,f-h,m-g,v-S).normalize(),n[4].setComponents(l-o,f-d,m-_,v-w).normalize(),e===gn)n[5].setComponents(l+o,f+d,m+_,v+w).normalize();else if(e===Hs)n[5].setComponents(o,d,_,w).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+e);return this}intersectsObject(t){if(t.boundingSphere!==void 0)t.boundingSphere===null&&t.computeBoundingSphere(),Hn.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);else{const e=t.geometry;e.boundingSphere===null&&e.computeBoundingSphere(),Hn.copy(e.boundingSphere).applyMatrix4(t.matrixWorld)}return this.intersectsSphere(Hn)}intersectsSprite(t){return Hn.center.set(0,0,0),Hn.radius=.7071067811865476,Hn.applyMatrix4(t.matrixWorld),this.intersectsSphere(Hn)}intersectsSphere(t){const e=this.planes,n=t.center,i=-t.radius;for(let r=0;r<6;r++)if(e[r].distanceToPoint(n)<i)return!1;return!0}intersectsBox(t){const e=this.planes;for(let n=0;n<6;n++){const i=e[n];if(ys.x=i.normal.x>0?t.max.x:t.min.x,ys.y=i.normal.y>0?t.max.y:t.min.y,ys.z=i.normal.z>0?t.max.z:t.min.z,i.distanceToPoint(ys)<0)return!1}return!0}containsPoint(t){const e=this.planes;for(let n=0;n<6;n++)if(e[n].distanceToPoint(t)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}function Hl(){let s=null,t=!1,e=null,n=null;function i(r,a){e(r,a),n=s.requestAnimationFrame(i)}return{start:function(){t!==!0&&e!==null&&(n=s.requestAnimationFrame(i),t=!0)},stop:function(){s.cancelAnimationFrame(n),t=!1},setAnimationLoop:function(r){e=r},setContext:function(r){s=r}}}function Ih(s){const t=new WeakMap;function e(o,l){const c=o.array,h=o.usage,d=c.byteLength,f=s.createBuffer();s.bindBuffer(l,f),s.bufferData(l,c,h),o.onUploadCallback();let p;if(c instanceof Float32Array)p=s.FLOAT;else if(c instanceof Uint16Array)o.isFloat16BufferAttribute?p=s.HALF_FLOAT:p=s.UNSIGNED_SHORT;else if(c instanceof Int16Array)p=s.SHORT;else if(c instanceof Uint32Array)p=s.UNSIGNED_INT;else if(c instanceof Int32Array)p=s.INT;else if(c instanceof Int8Array)p=s.BYTE;else if(c instanceof Uint8Array)p=s.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)p=s.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:f,type:p,bytesPerElement:c.BYTES_PER_ELEMENT,version:o.version,size:d}}function n(o,l,c){const h=l.array,d=l.updateRanges;if(s.bindBuffer(c,o),d.length===0)s.bufferSubData(c,0,h);else{d.sort((p,g)=>p.start-g.start);let f=0;for(let p=1;p<d.length;p++){const g=d[f],_=d[p];_.start<=g.start+g.count+1?g.count=Math.max(g.count,_.start+_.count-g.start):(++f,d[f]=_)}d.length=f+1;for(let p=0,g=d.length;p<g;p++){const _=d[p];s.bufferSubData(c,_.start*h.BYTES_PER_ELEMENT,h,_.start,_.count)}l.clearUpdateRanges()}l.onUploadCallback()}function i(o){return o.isInterleavedBufferAttribute&&(o=o.data),t.get(o)}function r(o){o.isInterleavedBufferAttribute&&(o=o.data);const l=t.get(o);l&&(s.deleteBuffer(l.buffer),t.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){const h=t.get(o);(!h||h.version<o.version)&&t.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}const c=t.get(o);if(c===void 0)t.set(o,e(o,l));else if(c.version<o.version){if(c.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,o,l),c.version=o.version}}return{get:i,remove:r,update:a}}class mn extends _e{constructor(t=1,e=1,n=1,i=1){super(),this.type="PlaneGeometry",this.parameters={width:t,height:e,widthSegments:n,heightSegments:i};const r=t/2,a=e/2,o=Math.floor(n),l=Math.floor(i),c=o+1,h=l+1,d=t/o,f=e/l,p=[],g=[],_=[],m=[];for(let u=0;u<h;u++){const S=u*f-a;for(let w=0;w<c;w++){const v=w*d-r;g.push(v,-S,0),_.push(0,0,1),m.push(w/o),m.push(1-u/l)}}for(let u=0;u<l;u++)for(let S=0;S<o;S++){const w=S+c*u,v=S+c*(u+1),P=S+1+c*(u+1),T=S+1+c*u;p.push(w,v,T),p.push(v,P,T)}this.setIndex(p),this.setAttribute("position",new ie(g,3)),this.setAttribute("normal",new ie(_,3)),this.setAttribute("uv",new ie(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new mn(t.width,t.height,t.widthSegments,t.heightSegments)}}var Dh=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Uh=`#ifdef USE_ALPHAHASH
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
#endif`,Nh=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Fh=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Oh=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,Bh=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,kh=`#ifdef USE_AOMAP
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
#endif`,zh=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Hh=`#ifdef USE_BATCHING
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
#endif`,Vh=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Gh=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,Wh=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,Xh=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,qh=`#ifdef USE_IRIDESCENCE
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
#endif`,Yh=`#ifdef USE_BUMPMAP
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
#endif`,$h=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,Kh=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,jh=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,Zh=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Jh=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,Qh=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,tu=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,eu=`#if defined( USE_COLOR_ALPHA )
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
#endif`,nu=`#define PI 3.141592653589793
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
} // validated`,iu=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,su=`vec3 transformedNormal = objectNormal;
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
#endif`,ru=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,au=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,ou=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,lu=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,cu="gl_FragColor = linearToOutputTexel( gl_FragColor );",hu=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,uu=`#ifdef USE_ENVMAP
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
#endif`,du=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,fu=`#ifdef USE_ENVMAP
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
#endif`,pu=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,mu=`#ifdef USE_ENVMAP
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
#endif`,gu=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,_u=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,vu=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,xu=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,Mu=`#ifdef USE_GRADIENTMAP
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
}`,yu=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Su=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Eu=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,wu=`uniform bool receiveShadow;
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
#endif`,bu=`#ifdef USE_ENVMAP
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
#endif`,Tu=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Au=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Ru=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Cu=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,Pu=`PhysicalMaterial material;
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
#endif`,Lu=`struct PhysicalMaterial {
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
}`,Iu=`
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
#endif`,Du=`#if defined( RE_IndirectDiffuse )
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
#endif`,Uu=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Nu=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Fu=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Ou=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Bu=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,ku=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,zu=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,Hu=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,Vu=`#if defined( USE_POINTS_UV )
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
#endif`,Gu=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,Wu=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,Xu=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,qu=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,Yu=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,$u=`#ifdef USE_MORPHTARGETS
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
#endif`,Ku=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,ju=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,Zu=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,Ju=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,Qu=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,td=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,ed=`#ifdef USE_NORMALMAP
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
#endif`,nd=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,id=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,sd=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,rd=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,ad=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,od=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,ld=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,cd=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,hd=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,ud=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,dd=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,fd=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,pd=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,md=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,gd=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,_d=`float getShadowMask() {
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
}`,vd=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,xd=`#ifdef USE_SKINNING
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
#endif`,Md=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,yd=`#ifdef USE_SKINNING
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
#endif`,Sd=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Ed=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,wd=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,bd=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,Td=`#ifdef USE_TRANSMISSION
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
#endif`,Ad=`#ifdef USE_TRANSMISSION
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
#endif`,Rd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Cd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Pd=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Ld=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const Id=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,Dd=`uniform sampler2D t2D;
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
}`,Ud=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Nd=`#ifdef ENVMAP_TYPE_CUBE
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
}`,Fd=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Od=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Bd=`#include <common>
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
}`,kd=`#if DEPTH_PACKING == 3200
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
}`,zd=`#define DISTANCE
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
}`,Hd=`#define DISTANCE
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
}`,Vd=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Gd=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,Wd=`uniform float scale;
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
}`,Xd=`uniform vec3 diffuse;
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
}`,qd=`#include <common>
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
}`,Yd=`uniform vec3 diffuse;
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
}`,$d=`#define LAMBERT
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
}`,Kd=`#define LAMBERT
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
}`,jd=`#define MATCAP
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
}`,Zd=`#define MATCAP
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
}`,Jd=`#define NORMAL
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
}`,Qd=`#define NORMAL
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
}`,tf=`#define PHONG
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
}`,ef=`#define PHONG
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
}`,nf=`#define STANDARD
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
}`,sf=`#define STANDARD
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
}`,rf=`#define TOON
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
}`,af=`#define TOON
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
}`,of=`uniform float size;
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
}`,lf=`uniform vec3 diffuse;
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
}`,cf=`#include <common>
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
}`,hf=`uniform vec3 color;
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
}`,uf=`uniform float rotation;
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
}`,df=`uniform vec3 diffuse;
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
}`,Nt={alphahash_fragment:Dh,alphahash_pars_fragment:Uh,alphamap_fragment:Nh,alphamap_pars_fragment:Fh,alphatest_fragment:Oh,alphatest_pars_fragment:Bh,aomap_fragment:kh,aomap_pars_fragment:zh,batching_pars_vertex:Hh,batching_vertex:Vh,begin_vertex:Gh,beginnormal_vertex:Wh,bsdfs:Xh,iridescence_fragment:qh,bumpmap_pars_fragment:Yh,clipping_planes_fragment:$h,clipping_planes_pars_fragment:Kh,clipping_planes_pars_vertex:jh,clipping_planes_vertex:Zh,color_fragment:Jh,color_pars_fragment:Qh,color_pars_vertex:tu,color_vertex:eu,common:nu,cube_uv_reflection_fragment:iu,defaultnormal_vertex:su,displacementmap_pars_vertex:ru,displacementmap_vertex:au,emissivemap_fragment:ou,emissivemap_pars_fragment:lu,colorspace_fragment:cu,colorspace_pars_fragment:hu,envmap_fragment:uu,envmap_common_pars_fragment:du,envmap_pars_fragment:fu,envmap_pars_vertex:pu,envmap_physical_pars_fragment:bu,envmap_vertex:mu,fog_vertex:gu,fog_pars_vertex:_u,fog_fragment:vu,fog_pars_fragment:xu,gradientmap_pars_fragment:Mu,lightmap_pars_fragment:yu,lights_lambert_fragment:Su,lights_lambert_pars_fragment:Eu,lights_pars_begin:wu,lights_toon_fragment:Tu,lights_toon_pars_fragment:Au,lights_phong_fragment:Ru,lights_phong_pars_fragment:Cu,lights_physical_fragment:Pu,lights_physical_pars_fragment:Lu,lights_fragment_begin:Iu,lights_fragment_maps:Du,lights_fragment_end:Uu,logdepthbuf_fragment:Nu,logdepthbuf_pars_fragment:Fu,logdepthbuf_pars_vertex:Ou,logdepthbuf_vertex:Bu,map_fragment:ku,map_pars_fragment:zu,map_particle_fragment:Hu,map_particle_pars_fragment:Vu,metalnessmap_fragment:Gu,metalnessmap_pars_fragment:Wu,morphinstance_vertex:Xu,morphcolor_vertex:qu,morphnormal_vertex:Yu,morphtarget_pars_vertex:$u,morphtarget_vertex:Ku,normal_fragment_begin:ju,normal_fragment_maps:Zu,normal_pars_fragment:Ju,normal_pars_vertex:Qu,normal_vertex:td,normalmap_pars_fragment:ed,clearcoat_normal_fragment_begin:nd,clearcoat_normal_fragment_maps:id,clearcoat_pars_fragment:sd,iridescence_pars_fragment:rd,opaque_fragment:ad,packing:od,premultiplied_alpha_fragment:ld,project_vertex:cd,dithering_fragment:hd,dithering_pars_fragment:ud,roughnessmap_fragment:dd,roughnessmap_pars_fragment:fd,shadowmap_pars_fragment:pd,shadowmap_pars_vertex:md,shadowmap_vertex:gd,shadowmask_pars_fragment:_d,skinbase_vertex:vd,skinning_pars_vertex:xd,skinning_vertex:Md,skinnormal_vertex:yd,specularmap_fragment:Sd,specularmap_pars_fragment:Ed,tonemapping_fragment:wd,tonemapping_pars_fragment:bd,transmission_fragment:Td,transmission_pars_fragment:Ad,uv_pars_fragment:Rd,uv_pars_vertex:Cd,uv_vertex:Pd,worldpos_vertex:Ld,background_vert:Id,background_frag:Dd,backgroundCube_vert:Ud,backgroundCube_frag:Nd,cube_vert:Fd,cube_frag:Od,depth_vert:Bd,depth_frag:kd,distanceRGBA_vert:zd,distanceRGBA_frag:Hd,equirect_vert:Vd,equirect_frag:Gd,linedashed_vert:Wd,linedashed_frag:Xd,meshbasic_vert:qd,meshbasic_frag:Yd,meshlambert_vert:$d,meshlambert_frag:Kd,meshmatcap_vert:jd,meshmatcap_frag:Zd,meshnormal_vert:Jd,meshnormal_frag:Qd,meshphong_vert:tf,meshphong_frag:ef,meshphysical_vert:nf,meshphysical_frag:sf,meshtoon_vert:rf,meshtoon_frag:af,points_vert:of,points_frag:lf,shadow_vert:cf,shadow_frag:hf,sprite_vert:uf,sprite_frag:df},et={common:{diffuse:{value:new Ft(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Dt},alphaMap:{value:null},alphaMapTransform:{value:new Dt},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Dt}},envmap:{envMap:{value:null},envMapRotation:{value:new Dt},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Dt}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Dt}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Dt},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Dt},normalScale:{value:new Ct(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Dt},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Dt}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Dt}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Dt}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Ft(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Ft(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Dt},alphaTest:{value:0},uvTransform:{value:new Dt}},sprite:{diffuse:{value:new Ft(16777215)},opacity:{value:1},center:{value:new Ct(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Dt},alphaMap:{value:null},alphaMapTransform:{value:new Dt},alphaTest:{value:0}}},sn={basic:{uniforms:Ce([et.common,et.specularmap,et.envmap,et.aomap,et.lightmap,et.fog]),vertexShader:Nt.meshbasic_vert,fragmentShader:Nt.meshbasic_frag},lambert:{uniforms:Ce([et.common,et.specularmap,et.envmap,et.aomap,et.lightmap,et.emissivemap,et.bumpmap,et.normalmap,et.displacementmap,et.fog,et.lights,{emissive:{value:new Ft(0)}}]),vertexShader:Nt.meshlambert_vert,fragmentShader:Nt.meshlambert_frag},phong:{uniforms:Ce([et.common,et.specularmap,et.envmap,et.aomap,et.lightmap,et.emissivemap,et.bumpmap,et.normalmap,et.displacementmap,et.fog,et.lights,{emissive:{value:new Ft(0)},specular:{value:new Ft(1118481)},shininess:{value:30}}]),vertexShader:Nt.meshphong_vert,fragmentShader:Nt.meshphong_frag},standard:{uniforms:Ce([et.common,et.envmap,et.aomap,et.lightmap,et.emissivemap,et.bumpmap,et.normalmap,et.displacementmap,et.roughnessmap,et.metalnessmap,et.fog,et.lights,{emissive:{value:new Ft(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:Nt.meshphysical_vert,fragmentShader:Nt.meshphysical_frag},toon:{uniforms:Ce([et.common,et.aomap,et.lightmap,et.emissivemap,et.bumpmap,et.normalmap,et.displacementmap,et.gradientmap,et.fog,et.lights,{emissive:{value:new Ft(0)}}]),vertexShader:Nt.meshtoon_vert,fragmentShader:Nt.meshtoon_frag},matcap:{uniforms:Ce([et.common,et.bumpmap,et.normalmap,et.displacementmap,et.fog,{matcap:{value:null}}]),vertexShader:Nt.meshmatcap_vert,fragmentShader:Nt.meshmatcap_frag},points:{uniforms:Ce([et.points,et.fog]),vertexShader:Nt.points_vert,fragmentShader:Nt.points_frag},dashed:{uniforms:Ce([et.common,et.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:Nt.linedashed_vert,fragmentShader:Nt.linedashed_frag},depth:{uniforms:Ce([et.common,et.displacementmap]),vertexShader:Nt.depth_vert,fragmentShader:Nt.depth_frag},normal:{uniforms:Ce([et.common,et.bumpmap,et.normalmap,et.displacementmap,{opacity:{value:1}}]),vertexShader:Nt.meshnormal_vert,fragmentShader:Nt.meshnormal_frag},sprite:{uniforms:Ce([et.sprite,et.fog]),vertexShader:Nt.sprite_vert,fragmentShader:Nt.sprite_frag},background:{uniforms:{uvTransform:{value:new Dt},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:Nt.background_vert,fragmentShader:Nt.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Dt}},vertexShader:Nt.backgroundCube_vert,fragmentShader:Nt.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:Nt.cube_vert,fragmentShader:Nt.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:Nt.equirect_vert,fragmentShader:Nt.equirect_frag},distanceRGBA:{uniforms:Ce([et.common,et.displacementmap,{referencePosition:{value:new R},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:Nt.distanceRGBA_vert,fragmentShader:Nt.distanceRGBA_frag},shadow:{uniforms:Ce([et.lights,et.fog,{color:{value:new Ft(0)},opacity:{value:1}}]),vertexShader:Nt.shadow_vert,fragmentShader:Nt.shadow_frag}};sn.physical={uniforms:Ce([sn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Dt},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Dt},clearcoatNormalScale:{value:new Ct(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Dt},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Dt},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Dt},sheen:{value:0},sheenColor:{value:new Ft(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Dt},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Dt},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Dt},transmissionSamplerSize:{value:new Ct},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Dt},attenuationDistance:{value:0},attenuationColor:{value:new Ft(0)},specularColor:{value:new Ft(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Dt},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Dt},anisotropyVector:{value:new Ct},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Dt}}]),vertexShader:Nt.meshphysical_vert,fragmentShader:Nt.meshphysical_frag};const Ss={r:0,b:0,g:0},Vn=new Be,ff=new Zt;function pf(s,t,e,n,i,r,a){const o=new Ft(0);let l=r===!0?0:1,c,h,d=null,f=0,p=null;function g(S){let w=S.isScene===!0?S.background:null;return w&&w.isTexture&&(w=(S.backgroundBlurriness>0?e:t).get(w)),w}function _(S){let w=!1;const v=g(S);v===null?u(o,l):v&&v.isColor&&(u(v,1),w=!0);const P=s.xr.getEnvironmentBlendMode();P==="additive"?n.buffers.color.setClear(0,0,0,1,a):P==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,a),(s.autoClear||w)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),s.clear(s.autoClearColor,s.autoClearDepth,s.autoClearStencil))}function m(S,w){const v=g(w);v&&(v.isCubeTexture||v.mapping===$s)?(h===void 0&&(h=new it(new oe(1,1,1),new Un({name:"BackgroundCubeMaterial",uniforms:Ci(sn.backgroundCube.uniforms),vertexShader:sn.backgroundCube.vertexShader,fragmentShader:sn.backgroundCube.fragmentShader,side:ye,depthTest:!1,depthWrite:!1,fog:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(P,T,A){this.matrixWorld.copyPosition(A.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(h)),Vn.copy(w.backgroundRotation),Vn.x*=-1,Vn.y*=-1,Vn.z*=-1,v.isCubeTexture&&v.isRenderTargetTexture===!1&&(Vn.y*=-1,Vn.z*=-1),h.material.uniforms.envMap.value=v,h.material.uniforms.flipEnvMap.value=v.isCubeTexture&&v.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=w.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=w.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(ff.makeRotationFromEuler(Vn)),h.material.toneMapped=Wt.getTransfer(v.colorSpace)!==Jt,(d!==v||f!==v.version||p!==s.toneMapping)&&(h.material.needsUpdate=!0,d=v,f=v.version,p=s.toneMapping),h.layers.enableAll(),S.unshift(h,h.geometry,h.material,0,0,null)):v&&v.isTexture&&(c===void 0&&(c=new it(new mn(2,2),new Un({name:"BackgroundMaterial",uniforms:Ci(sn.background.uniforms),vertexShader:sn.background.vertexShader,fragmentShader:sn.background.fragmentShader,side:Dn,depthTest:!1,depthWrite:!1,fog:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(c)),c.material.uniforms.t2D.value=v,c.material.uniforms.backgroundIntensity.value=w.backgroundIntensity,c.material.toneMapped=Wt.getTransfer(v.colorSpace)!==Jt,v.matrixAutoUpdate===!0&&v.updateMatrix(),c.material.uniforms.uvTransform.value.copy(v.matrix),(d!==v||f!==v.version||p!==s.toneMapping)&&(c.material.needsUpdate=!0,d=v,f=v.version,p=s.toneMapping),c.layers.enableAll(),S.unshift(c,c.geometry,c.material,0,0,null))}function u(S,w){S.getRGB(Ss,Bl(s)),n.buffers.color.setClear(Ss.r,Ss.g,Ss.b,w,a)}return{getClearColor:function(){return o},setClearColor:function(S,w=1){o.set(S),l=w,u(o,l)},getClearAlpha:function(){return l},setClearAlpha:function(S){l=S,u(o,l)},render:_,addToRenderList:m}}function mf(s,t){const e=s.getParameter(s.MAX_VERTEX_ATTRIBS),n={},i=f(null);let r=i,a=!1;function o(M,C,k,O,W){let X=!1;const H=d(O,k,C);r!==H&&(r=H,c(r.object)),X=p(M,O,k,W),X&&g(M,O,k,W),W!==null&&t.update(W,s.ELEMENT_ARRAY_BUFFER),(X||a)&&(a=!1,v(M,C,k,O),W!==null&&s.bindBuffer(s.ELEMENT_ARRAY_BUFFER,t.get(W).buffer))}function l(){return s.createVertexArray()}function c(M){return s.bindVertexArray(M)}function h(M){return s.deleteVertexArray(M)}function d(M,C,k){const O=k.wireframe===!0;let W=n[M.id];W===void 0&&(W={},n[M.id]=W);let X=W[C.id];X===void 0&&(X={},W[C.id]=X);let H=X[O];return H===void 0&&(H=f(l()),X[O]=H),H}function f(M){const C=[],k=[],O=[];for(let W=0;W<e;W++)C[W]=0,k[W]=0,O[W]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:C,enabledAttributes:k,attributeDivisors:O,object:M,attributes:{},index:null}}function p(M,C,k,O){const W=r.attributes,X=C.attributes;let H=0;const j=k.getAttributes();for(const V in j)if(j[V].location>=0){const ht=W[V];let Mt=X[V];if(Mt===void 0&&(V==="instanceMatrix"&&M.instanceMatrix&&(Mt=M.instanceMatrix),V==="instanceColor"&&M.instanceColor&&(Mt=M.instanceColor)),ht===void 0||ht.attribute!==Mt||Mt&&ht.data!==Mt.data)return!0;H++}return r.attributesNum!==H||r.index!==O}function g(M,C,k,O){const W={},X=C.attributes;let H=0;const j=k.getAttributes();for(const V in j)if(j[V].location>=0){let ht=X[V];ht===void 0&&(V==="instanceMatrix"&&M.instanceMatrix&&(ht=M.instanceMatrix),V==="instanceColor"&&M.instanceColor&&(ht=M.instanceColor));const Mt={};Mt.attribute=ht,ht&&ht.data&&(Mt.data=ht.data),W[V]=Mt,H++}r.attributes=W,r.attributesNum=H,r.index=O}function _(){const M=r.newAttributes;for(let C=0,k=M.length;C<k;C++)M[C]=0}function m(M){u(M,0)}function u(M,C){const k=r.newAttributes,O=r.enabledAttributes,W=r.attributeDivisors;k[M]=1,O[M]===0&&(s.enableVertexAttribArray(M),O[M]=1),W[M]!==C&&(s.vertexAttribDivisor(M,C),W[M]=C)}function S(){const M=r.newAttributes,C=r.enabledAttributes;for(let k=0,O=C.length;k<O;k++)C[k]!==M[k]&&(s.disableVertexAttribArray(k),C[k]=0)}function w(M,C,k,O,W,X,H){H===!0?s.vertexAttribIPointer(M,C,k,W,X):s.vertexAttribPointer(M,C,k,O,W,X)}function v(M,C,k,O){_();const W=O.attributes,X=k.getAttributes(),H=C.defaultAttributeValues;for(const j in X){const V=X[j];if(V.location>=0){let st=W[j];if(st===void 0&&(j==="instanceMatrix"&&M.instanceMatrix&&(st=M.instanceMatrix),j==="instanceColor"&&M.instanceColor&&(st=M.instanceColor)),st!==void 0){const ht=st.normalized,Mt=st.itemSize,Ot=t.get(st);if(Ot===void 0)continue;const te=Ot.buffer,Y=Ot.type,tt=Ot.bytesPerElement,_t=Y===s.INT||Y===s.UNSIGNED_INT||st.gpuType===Aa;if(st.isInterleavedBufferAttribute){const rt=st.data,bt=rt.stride,Pt=st.offset;if(rt.isInstancedInterleavedBuffer){for(let Bt=0;Bt<V.locationSize;Bt++)u(V.location+Bt,rt.meshPerAttribute);M.isInstancedMesh!==!0&&O._maxInstanceCount===void 0&&(O._maxInstanceCount=rt.meshPerAttribute*rt.count)}else for(let Bt=0;Bt<V.locationSize;Bt++)m(V.location+Bt);s.bindBuffer(s.ARRAY_BUFFER,te);for(let Bt=0;Bt<V.locationSize;Bt++)w(V.location+Bt,Mt/V.locationSize,Y,ht,bt*tt,(Pt+Mt/V.locationSize*Bt)*tt,_t)}else{if(st.isInstancedBufferAttribute){for(let rt=0;rt<V.locationSize;rt++)u(V.location+rt,st.meshPerAttribute);M.isInstancedMesh!==!0&&O._maxInstanceCount===void 0&&(O._maxInstanceCount=st.meshPerAttribute*st.count)}else for(let rt=0;rt<V.locationSize;rt++)m(V.location+rt);s.bindBuffer(s.ARRAY_BUFFER,te);for(let rt=0;rt<V.locationSize;rt++)w(V.location+rt,Mt/V.locationSize,Y,ht,Mt*tt,Mt/V.locationSize*rt*tt,_t)}}else if(H!==void 0){const ht=H[j];if(ht!==void 0)switch(ht.length){case 2:s.vertexAttrib2fv(V.location,ht);break;case 3:s.vertexAttrib3fv(V.location,ht);break;case 4:s.vertexAttrib4fv(V.location,ht);break;default:s.vertexAttrib1fv(V.location,ht)}}}}S()}function P(){L();for(const M in n){const C=n[M];for(const k in C){const O=C[k];for(const W in O)h(O[W].object),delete O[W];delete C[k]}delete n[M]}}function T(M){if(n[M.id]===void 0)return;const C=n[M.id];for(const k in C){const O=C[k];for(const W in O)h(O[W].object),delete O[W];delete C[k]}delete n[M.id]}function A(M){for(const C in n){const k=n[C];if(k[M.id]===void 0)continue;const O=k[M.id];for(const W in O)h(O[W].object),delete O[W];delete k[M.id]}}function L(){E(),a=!0,r!==i&&(r=i,c(r.object))}function E(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:o,reset:L,resetDefaultState:E,dispose:P,releaseStatesOfGeometry:T,releaseStatesOfProgram:A,initAttributes:_,enableAttribute:m,disableUnusedAttributes:S}}function gf(s,t,e){let n;function i(c){n=c}function r(c,h){s.drawArrays(n,c,h),e.update(h,n,1)}function a(c,h,d){d!==0&&(s.drawArraysInstanced(n,c,h,d),e.update(h,n,d))}function o(c,h,d){if(d===0)return;t.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,c,0,h,0,d);let p=0;for(let g=0;g<d;g++)p+=h[g];e.update(p,n,1)}function l(c,h,d,f){if(d===0)return;const p=t.get("WEBGL_multi_draw");if(p===null)for(let g=0;g<c.length;g++)a(c[g],h[g],f[g]);else{p.multiDrawArraysInstancedWEBGL(n,c,0,h,0,f,0,d);let g=0;for(let _=0;_<d;_++)g+=h[_]*f[_];e.update(g,n,1)}}this.setMode=i,this.render=r,this.renderInstances=a,this.renderMultiDraw=o,this.renderMultiDrawInstances=l}function _f(s,t,e,n){let i;function r(){if(i!==void 0)return i;if(t.has("EXT_texture_filter_anisotropic")===!0){const A=t.get("EXT_texture_filter_anisotropic");i=s.getParameter(A.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function a(A){return!(A!==tn&&n.convert(A)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(A){const L=A===es&&(t.has("EXT_color_buffer_half_float")||t.has("EXT_color_buffer_float"));return!(A!==xn&&n.convert(A)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_TYPE)&&A!==an&&!L)}function l(A){if(A==="highp"){if(s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.HIGH_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.HIGH_FLOAT).precision>0)return"highp";A="mediump"}return A==="mediump"&&s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.MEDIUM_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=e.precision!==void 0?e.precision:"highp";const h=l(c);h!==c&&(console.warn("THREE.WebGLRenderer:",c,"not supported, using",h,"instead."),c=h);const d=e.logarithmicDepthBuffer===!0,f=e.reverseDepthBuffer===!0&&t.has("EXT_clip_control"),p=s.getParameter(s.MAX_TEXTURE_IMAGE_UNITS),g=s.getParameter(s.MAX_VERTEX_TEXTURE_IMAGE_UNITS),_=s.getParameter(s.MAX_TEXTURE_SIZE),m=s.getParameter(s.MAX_CUBE_MAP_TEXTURE_SIZE),u=s.getParameter(s.MAX_VERTEX_ATTRIBS),S=s.getParameter(s.MAX_VERTEX_UNIFORM_VECTORS),w=s.getParameter(s.MAX_VARYING_VECTORS),v=s.getParameter(s.MAX_FRAGMENT_UNIFORM_VECTORS),P=g>0,T=s.getParameter(s.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:c,logarithmicDepthBuffer:d,reverseDepthBuffer:f,maxTextures:p,maxVertexTextures:g,maxTextureSize:_,maxCubemapSize:m,maxAttributes:u,maxVertexUniforms:S,maxVaryings:w,maxFragmentUniforms:v,vertexTextures:P,maxSamples:T}}function vf(s){const t=this;let e=null,n=0,i=!1,r=!1;const a=new Wn,o=new Dt,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(d,f){const p=d.length!==0||f||n!==0||i;return i=f,n=d.length,p},this.beginShadows=function(){r=!0,h(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(d,f){e=h(d,f,0)},this.setState=function(d,f,p){const g=d.clippingPlanes,_=d.clipIntersection,m=d.clipShadows,u=s.get(d);if(!i||g===null||g.length===0||r&&!m)r?h(null):c();else{const S=r?0:n,w=S*4;let v=u.clippingState||null;l.value=v,v=h(g,f,w,p);for(let P=0;P!==w;++P)v[P]=e[P];u.clippingState=v,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=S}};function c(){l.value!==e&&(l.value=e,l.needsUpdate=n>0),t.numPlanes=n,t.numIntersection=0}function h(d,f,p,g){const _=d!==null?d.length:0;let m=null;if(_!==0){if(m=l.value,g!==!0||m===null){const u=p+_*4,S=f.matrixWorldInverse;o.getNormalMatrix(S),(m===null||m.length<u)&&(m=new Float32Array(u));for(let w=0,v=p;w!==_;++w,v+=4)a.copy(d[w]).applyMatrix4(S,o),a.normal.toArray(m,v),m[v+3]=a.constant}l.value=m,l.needsUpdate=!0}return t.numPlanes=_,t.numIntersection=0,m}}function xf(s){let t=new WeakMap;function e(a,o){return o===Xr?a.mapping=bi:o===qr&&(a.mapping=Ti),a}function n(a){if(a&&a.isTexture){const o=a.mapping;if(o===Xr||o===qr)if(t.has(a)){const l=t.get(a).texture;return e(l,a.mapping)}else{const l=a.image;if(l&&l.height>0){const c=new Ch(l.height);return c.fromEquirectangularTexture(s,a),t.set(a,c),a.addEventListener("dispose",i),e(c.texture,a.mapping)}else return null}}return a}function i(a){const o=a.target;o.removeEventListener("dispose",i);const l=t.get(o);l!==void 0&&(t.delete(o),l.dispose())}function r(){t=new WeakMap}return{get:n,dispose:r}}class Vl extends kl{constructor(t=-1,e=1,n=1,i=-1,r=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=t,this.right=e,this.top=n,this.bottom=i,this.near=r,this.far=a,this.updateProjectionMatrix()}copy(t,e){return super.copy(t,e),this.left=t.left,this.right=t.right,this.top=t.top,this.bottom=t.bottom,this.near=t.near,this.far=t.far,this.zoom=t.zoom,this.view=t.view===null?null:Object.assign({},t.view),this}setViewOffset(t,e,n,i,r,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=t,this.view.fullHeight=e,this.view.offsetX=n,this.view.offsetY=i,this.view.width=r,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const t=(this.right-this.left)/(2*this.zoom),e=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,i=(this.top+this.bottom)/2;let r=n-t,a=n+t,o=i+e,l=i-e;if(this.view!==null&&this.view.enabled){const c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=c*this.view.offsetX,a=r+c*this.view.width,o-=h*this.view.offsetY,l=o-h*this.view.height}this.projectionMatrix.makeOrthographic(r,a,o,l,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(t){const e=super.toJSON(t);return e.object.zoom=this.zoom,e.object.left=this.left,e.object.right=this.right,e.object.top=this.top,e.object.bottom=this.bottom,e.object.near=this.near,e.object.far=this.far,this.view!==null&&(e.object.view=Object.assign({},this.view)),e}}const Mi=4,bo=[.125,.215,.35,.446,.526,.582],Yn=20,Sr=new Vl,To=new Ft;let Er=null,wr=0,br=0,Tr=!1;const Xn=(1+Math.sqrt(5))/2,pi=1/Xn,Ao=[new R(-Xn,pi,0),new R(Xn,pi,0),new R(-pi,0,Xn),new R(pi,0,Xn),new R(0,Xn,-pi),new R(0,Xn,pi),new R(-1,1,-1),new R(1,1,-1),new R(-1,1,1),new R(1,1,1)];class Ro{constructor(t){this._renderer=t,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(t,e=0,n=.1,i=100){Er=this._renderer.getRenderTarget(),wr=this._renderer.getActiveCubeFace(),br=this._renderer.getActiveMipmapLevel(),Tr=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(256);const r=this._allocateTargets();return r.depthBuffer=!0,this._sceneToCubeUV(t,n,i,r),e>0&&this._blur(r,0,0,e),this._applyPMREM(r),this._cleanup(r),r}fromEquirectangular(t,e=null){return this._fromTexture(t,e)}fromCubemap(t,e=null){return this._fromTexture(t,e)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Lo(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=Po(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(t){this._lodMax=Math.floor(Math.log2(t)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let t=0;t<this._lodPlanes.length;t++)this._lodPlanes[t].dispose()}_cleanup(t){this._renderer.setRenderTarget(Er,wr,br),this._renderer.xr.enabled=Tr,t.scissorTest=!1,Es(t,0,0,t.width,t.height)}_fromTexture(t,e){t.mapping===bi||t.mapping===Ti?this._setSize(t.image.length===0?16:t.image[0].width||t.image[0].image.width):this._setSize(t.image.width/4),Er=this._renderer.getRenderTarget(),wr=this._renderer.getActiveCubeFace(),br=this._renderer.getActiveMipmapLevel(),Tr=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const n=e||this._allocateTargets();return this._textureToCubeUV(t,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const t=3*Math.max(this._cubeSize,112),e=4*this._cubeSize,n={magFilter:rn,minFilter:rn,generateMipmaps:!1,type:es,format:tn,colorSpace:Pi,depthBuffer:!1},i=Co(t,e,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==t||this._pingPongRenderTarget.height!==e){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=Co(t,e,n);const{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=Mf(r)),this._blurMaterial=yf(r,t,e)}return i}_compileMaterial(t){const e=new it(this._lodPlanes[0],t);this._renderer.compile(e,Sr)}_sceneToCubeUV(t,e,n,i){const o=new Le(90,1,e,n),l=[1,-1,1,1,1,1],c=[1,1,1,-1,-1,-1],h=this._renderer,d=h.autoClear,f=h.toneMapping;h.getClearColor(To),h.toneMapping=In,h.autoClear=!1;const p=new St({name:"PMREM.Background",side:ye,depthWrite:!1,depthTest:!1}),g=new it(new oe,p);let _=!1;const m=t.background;m?m.isColor&&(p.color.copy(m),t.background=null,_=!0):(p.color.copy(To),_=!0);for(let u=0;u<6;u++){const S=u%3;S===0?(o.up.set(0,l[u],0),o.lookAt(c[u],0,0)):S===1?(o.up.set(0,0,l[u]),o.lookAt(0,c[u],0)):(o.up.set(0,l[u],0),o.lookAt(0,0,c[u]));const w=this._cubeSize;Es(i,S*w,u>2?w:0,w,w),h.setRenderTarget(i),_&&h.render(g,o),h.render(t,o)}g.geometry.dispose(),g.material.dispose(),h.toneMapping=f,h.autoClear=d,t.background=m}_textureToCubeUV(t,e){const n=this._renderer,i=t.mapping===bi||t.mapping===Ti;i?(this._cubemapMaterial===null&&(this._cubemapMaterial=Lo()),this._cubemapMaterial.uniforms.flipEnvMap.value=t.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=Po());const r=i?this._cubemapMaterial:this._equirectMaterial,a=new it(this._lodPlanes[0],r),o=r.uniforms;o.envMap.value=t;const l=this._cubeSize;Es(e,0,0,3*l,2*l),n.setRenderTarget(e),n.render(a,Sr)}_applyPMREM(t){const e=this._renderer,n=e.autoClear;e.autoClear=!1;const i=this._lodPlanes.length;for(let r=1;r<i;r++){const a=Math.sqrt(this._sigmas[r]*this._sigmas[r]-this._sigmas[r-1]*this._sigmas[r-1]),o=Ao[(i-r-1)%Ao.length];this._blur(t,r-1,r,a,o)}e.autoClear=n}_blur(t,e,n,i,r){const a=this._pingPongRenderTarget;this._halfBlur(t,a,e,n,i,"latitudinal",r),this._halfBlur(a,t,n,n,i,"longitudinal",r)}_halfBlur(t,e,n,i,r,a,o){const l=this._renderer,c=this._blurMaterial;a!=="latitudinal"&&a!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const h=3,d=new it(this._lodPlanes[i],c),f=c.uniforms,p=this._sizeLods[n]-1,g=isFinite(r)?Math.PI/(2*p):2*Math.PI/(2*Yn-1),_=r/g,m=isFinite(r)?1+Math.floor(h*_):Yn;m>Yn&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${m} samples when the maximum is set to ${Yn}`);const u=[];let S=0;for(let A=0;A<Yn;++A){const L=A/_,E=Math.exp(-L*L/2);u.push(E),A===0?S+=E:A<m&&(S+=2*E)}for(let A=0;A<u.length;A++)u[A]=u[A]/S;f.envMap.value=t.texture,f.samples.value=m,f.weights.value=u,f.latitudinal.value=a==="latitudinal",o&&(f.poleAxis.value=o);const{_lodMax:w}=this;f.dTheta.value=g,f.mipInt.value=w-n;const v=this._sizeLods[i],P=3*v*(i>w-Mi?i-w+Mi:0),T=4*(this._cubeSize-v);Es(e,P,T,3*v,2*v),l.setRenderTarget(e),l.render(d,Sr)}}function Mf(s){const t=[],e=[],n=[];let i=s;const r=s-Mi+1+bo.length;for(let a=0;a<r;a++){const o=Math.pow(2,i);e.push(o);let l=1/o;a>s-Mi?l=bo[a-s+Mi-1]:a===0&&(l=0),n.push(l);const c=1/(o-2),h=-c,d=1+c,f=[h,h,d,h,d,d,h,h,d,d,h,d],p=6,g=6,_=3,m=2,u=1,S=new Float32Array(_*g*p),w=new Float32Array(m*g*p),v=new Float32Array(u*g*p);for(let T=0;T<p;T++){const A=T%3*2/3-1,L=T>2?0:-1,E=[A,L,0,A+2/3,L,0,A+2/3,L+1,0,A,L,0,A+2/3,L+1,0,A,L+1,0];S.set(E,_*g*T),w.set(f,m*g*T);const M=[T,T,T,T,T,T];v.set(M,u*g*T)}const P=new _e;P.setAttribute("position",new Ie(S,_)),P.setAttribute("uv",new Ie(w,m)),P.setAttribute("faceIndex",new Ie(v,u)),t.push(P),i>Mi&&i--}return{lodPlanes:t,sizeLods:e,sigmas:n}}function Co(s,t,e){const n=new Mn(s,t,e);return n.texture.mapping=$s,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function Es(s,t,e,n,i){s.viewport.set(t,e,n,i),s.scissor.set(t,e,n,i)}function yf(s,t,e){const n=new Float32Array(Yn),i=new R(0,1,0);return new Un({name:"SphericalGaussianBlur",defines:{n:Yn,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/e,CUBEUV_MAX_MIP:`${s}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:i}},vertexShader:Oa(),fragmentShader:`

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
		`,blending:Ln,depthTest:!1,depthWrite:!1})}function Po(){return new Un({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Oa(),fragmentShader:`

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
		`,blending:Ln,depthTest:!1,depthWrite:!1})}function Lo(){return new Un({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Oa(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:Ln,depthTest:!1,depthWrite:!1})}function Oa(){return`

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
	`}function Sf(s){let t=new WeakMap,e=null;function n(o){if(o&&o.isTexture){const l=o.mapping,c=l===Xr||l===qr,h=l===bi||l===Ti;if(c||h){let d=t.get(o);const f=d!==void 0?d.texture.pmremVersion:0;if(o.isRenderTargetTexture&&o.pmremVersion!==f)return e===null&&(e=new Ro(s)),d=c?e.fromEquirectangular(o,d):e.fromCubemap(o,d),d.texture.pmremVersion=o.pmremVersion,t.set(o,d),d.texture;if(d!==void 0)return d.texture;{const p=o.image;return c&&p&&p.height>0||h&&p&&i(p)?(e===null&&(e=new Ro(s)),d=c?e.fromEquirectangular(o):e.fromCubemap(o),d.texture.pmremVersion=o.pmremVersion,t.set(o,d),o.addEventListener("dispose",r),d.texture):null}}}return o}function i(o){let l=0;const c=6;for(let h=0;h<c;h++)o[h]!==void 0&&l++;return l===c}function r(o){const l=o.target;l.removeEventListener("dispose",r);const c=t.get(l);c!==void 0&&(t.delete(l),c.dispose())}function a(){t=new WeakMap,e!==null&&(e.dispose(),e=null)}return{get:n,dispose:a}}function Ef(s){const t={};function e(n){if(t[n]!==void 0)return t[n];let i;switch(n){case"WEBGL_depth_texture":i=s.getExtension("WEBGL_depth_texture")||s.getExtension("MOZ_WEBGL_depth_texture")||s.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":i=s.getExtension("EXT_texture_filter_anisotropic")||s.getExtension("MOZ_EXT_texture_filter_anisotropic")||s.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":i=s.getExtension("WEBGL_compressed_texture_s3tc")||s.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||s.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":i=s.getExtension("WEBGL_compressed_texture_pvrtc")||s.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:i=s.getExtension(n)}return t[n]=i,i}return{has:function(n){return e(n)!==null},init:function(){e("EXT_color_buffer_float"),e("WEBGL_clip_cull_distance"),e("OES_texture_float_linear"),e("EXT_color_buffer_half_float"),e("WEBGL_multisampled_render_to_texture"),e("WEBGL_render_shared_exponent")},get:function(n){const i=e(n);return i===null&&$i("THREE.WebGLRenderer: "+n+" extension not supported."),i}}}function wf(s,t,e,n){const i={},r=new WeakMap;function a(d){const f=d.target;f.index!==null&&t.remove(f.index);for(const g in f.attributes)t.remove(f.attributes[g]);for(const g in f.morphAttributes){const _=f.morphAttributes[g];for(let m=0,u=_.length;m<u;m++)t.remove(_[m])}f.removeEventListener("dispose",a),delete i[f.id];const p=r.get(f);p&&(t.remove(p),r.delete(f)),n.releaseStatesOfGeometry(f),f.isInstancedBufferGeometry===!0&&delete f._maxInstanceCount,e.memory.geometries--}function o(d,f){return i[f.id]===!0||(f.addEventListener("dispose",a),i[f.id]=!0,e.memory.geometries++),f}function l(d){const f=d.attributes;for(const g in f)t.update(f[g],s.ARRAY_BUFFER);const p=d.morphAttributes;for(const g in p){const _=p[g];for(let m=0,u=_.length;m<u;m++)t.update(_[m],s.ARRAY_BUFFER)}}function c(d){const f=[],p=d.index,g=d.attributes.position;let _=0;if(p!==null){const S=p.array;_=p.version;for(let w=0,v=S.length;w<v;w+=3){const P=S[w+0],T=S[w+1],A=S[w+2];f.push(P,T,T,A,A,P)}}else if(g!==void 0){const S=g.array;_=g.version;for(let w=0,v=S.length/3-1;w<v;w+=3){const P=w+0,T=w+1,A=w+2;f.push(P,T,T,A,A,P)}}else return;const m=new(Ll(f)?Ol:Fl)(f,1);m.version=_;const u=r.get(d);u&&t.remove(u),r.set(d,m)}function h(d){const f=r.get(d);if(f){const p=d.index;p!==null&&f.version<p.version&&c(d)}else c(d);return r.get(d)}return{get:o,update:l,getWireframeAttribute:h}}function bf(s,t,e){let n;function i(f){n=f}let r,a;function o(f){r=f.type,a=f.bytesPerElement}function l(f,p){s.drawElements(n,p,r,f*a),e.update(p,n,1)}function c(f,p,g){g!==0&&(s.drawElementsInstanced(n,p,r,f*a,g),e.update(p,n,g))}function h(f,p,g){if(g===0)return;t.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,p,0,r,f,0,g);let m=0;for(let u=0;u<g;u++)m+=p[u];e.update(m,n,1)}function d(f,p,g,_){if(g===0)return;const m=t.get("WEBGL_multi_draw");if(m===null)for(let u=0;u<f.length;u++)c(f[u]/a,p[u],_[u]);else{m.multiDrawElementsInstancedWEBGL(n,p,0,r,f,0,_,0,g);let u=0;for(let S=0;S<g;S++)u+=p[S]*_[S];e.update(u,n,1)}}this.setMode=i,this.setIndex=o,this.render=l,this.renderInstances=c,this.renderMultiDraw=h,this.renderMultiDrawInstances=d}function Tf(s){const t={geometries:0,textures:0},e={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,a,o){switch(e.calls++,a){case s.TRIANGLES:e.triangles+=o*(r/3);break;case s.LINES:e.lines+=o*(r/2);break;case s.LINE_STRIP:e.lines+=o*(r-1);break;case s.LINE_LOOP:e.lines+=o*r;break;case s.POINTS:e.points+=o*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",a);break}}function i(){e.calls=0,e.triangles=0,e.points=0,e.lines=0}return{memory:t,render:e,programs:null,autoReset:!0,reset:i,update:n}}function Af(s,t,e){const n=new WeakMap,i=new Qt;function r(a,o,l){const c=a.morphTargetInfluences,h=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,d=h!==void 0?h.length:0;let f=n.get(o);if(f===void 0||f.count!==d){let M=function(){L.dispose(),n.delete(o),o.removeEventListener("dispose",M)};var p=M;f!==void 0&&f.texture.dispose();const g=o.morphAttributes.position!==void 0,_=o.morphAttributes.normal!==void 0,m=o.morphAttributes.color!==void 0,u=o.morphAttributes.position||[],S=o.morphAttributes.normal||[],w=o.morphAttributes.color||[];let v=0;g===!0&&(v=1),_===!0&&(v=2),m===!0&&(v=3);let P=o.attributes.position.count*v,T=1;P>t.maxTextureSize&&(T=Math.ceil(P/t.maxTextureSize),P=t.maxTextureSize);const A=new Float32Array(P*T*4*d),L=new Dl(A,P,T,d);L.type=an,L.needsUpdate=!0;const E=v*4;for(let C=0;C<d;C++){const k=u[C],O=S[C],W=w[C],X=P*T*4*C;for(let H=0;H<k.count;H++){const j=H*E;g===!0&&(i.fromBufferAttribute(k,H),A[X+j+0]=i.x,A[X+j+1]=i.y,A[X+j+2]=i.z,A[X+j+3]=0),_===!0&&(i.fromBufferAttribute(O,H),A[X+j+4]=i.x,A[X+j+5]=i.y,A[X+j+6]=i.z,A[X+j+7]=0),m===!0&&(i.fromBufferAttribute(W,H),A[X+j+8]=i.x,A[X+j+9]=i.y,A[X+j+10]=i.z,A[X+j+11]=W.itemSize===4?i.w:1)}}f={count:d,texture:L,size:new Ct(P,T)},n.set(o,f),o.addEventListener("dispose",M)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(s,"morphTexture",a.morphTexture,e);else{let g=0;for(let m=0;m<c.length;m++)g+=c[m];const _=o.morphTargetsRelative?1:1-g;l.getUniforms().setValue(s,"morphTargetBaseInfluence",_),l.getUniforms().setValue(s,"morphTargetInfluences",c)}l.getUniforms().setValue(s,"morphTargetsTexture",f.texture,e),l.getUniforms().setValue(s,"morphTargetsTextureSize",f.size)}return{update:r}}function Rf(s,t,e,n){let i=new WeakMap;function r(l){const c=n.render.frame,h=l.geometry,d=t.get(l,h);if(i.get(d)!==c&&(t.update(d),i.set(d,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",o)===!1&&l.addEventListener("dispose",o),i.get(l)!==c&&(e.update(l.instanceMatrix,s.ARRAY_BUFFER),l.instanceColor!==null&&e.update(l.instanceColor,s.ARRAY_BUFFER),i.set(l,c))),l.isSkinnedMesh){const f=l.skeleton;i.get(f)!==c&&(f.update(),i.set(f,c))}return d}function a(){i=new WeakMap}function o(l){const c=l.target;c.removeEventListener("dispose",o),e.remove(c.instanceMatrix),c.instanceColor!==null&&e.remove(c.instanceColor)}return{update:r,dispose:a}}class Gl extends Ae{constructor(t,e,n,i,r,a,o,l,c,h=Si){if(h!==Si&&h!==Ri)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");n===void 0&&h===Si&&(n=jn),n===void 0&&h===Ri&&(n=Ai),super(null,i,r,a,o,l,h,n,c),this.isDepthTexture=!0,this.image={width:t,height:e},this.magFilter=o!==void 0?o:Ve,this.minFilter=l!==void 0?l:Ve,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(t){return super.copy(t),this.compareFunction=t.compareFunction,this}toJSON(t){const e=super.toJSON(t);return this.compareFunction!==null&&(e.compareFunction=this.compareFunction),e}}const Wl=new Ae,Io=new Gl(1,1),Xl=new Dl,ql=new fh,Yl=new zl,Do=[],Uo=[],No=new Float32Array(16),Fo=new Float32Array(9),Oo=new Float32Array(4);function Ii(s,t,e){const n=s[0];if(n<=0||n>0)return s;const i=t*e;let r=Do[i];if(r===void 0&&(r=new Float32Array(i),Do[i]=r),t!==0){n.toArray(r,0);for(let a=1,o=0;a!==t;++a)o+=e,s[a].toArray(r,o)}return r}function ve(s,t){if(s.length!==t.length)return!1;for(let e=0,n=s.length;e<n;e++)if(s[e]!==t[e])return!1;return!0}function xe(s,t){for(let e=0,n=t.length;e<n;e++)s[e]=t[e]}function js(s,t){let e=Uo[t];e===void 0&&(e=new Int32Array(t),Uo[t]=e);for(let n=0;n!==t;++n)e[n]=s.allocateTextureUnit();return e}function Cf(s,t){const e=this.cache;e[0]!==t&&(s.uniform1f(this.addr,t),e[0]=t)}function Pf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2f(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(ve(e,t))return;s.uniform2fv(this.addr,t),xe(e,t)}}function Lf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3f(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else if(t.r!==void 0)(e[0]!==t.r||e[1]!==t.g||e[2]!==t.b)&&(s.uniform3f(this.addr,t.r,t.g,t.b),e[0]=t.r,e[1]=t.g,e[2]=t.b);else{if(ve(e,t))return;s.uniform3fv(this.addr,t),xe(e,t)}}function If(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4f(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(ve(e,t))return;s.uniform4fv(this.addr,t),xe(e,t)}}function Df(s,t){const e=this.cache,n=t.elements;if(n===void 0){if(ve(e,t))return;s.uniformMatrix2fv(this.addr,!1,t),xe(e,t)}else{if(ve(e,n))return;Oo.set(n),s.uniformMatrix2fv(this.addr,!1,Oo),xe(e,n)}}function Uf(s,t){const e=this.cache,n=t.elements;if(n===void 0){if(ve(e,t))return;s.uniformMatrix3fv(this.addr,!1,t),xe(e,t)}else{if(ve(e,n))return;Fo.set(n),s.uniformMatrix3fv(this.addr,!1,Fo),xe(e,n)}}function Nf(s,t){const e=this.cache,n=t.elements;if(n===void 0){if(ve(e,t))return;s.uniformMatrix4fv(this.addr,!1,t),xe(e,t)}else{if(ve(e,n))return;No.set(n),s.uniformMatrix4fv(this.addr,!1,No),xe(e,n)}}function Ff(s,t){const e=this.cache;e[0]!==t&&(s.uniform1i(this.addr,t),e[0]=t)}function Of(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2i(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(ve(e,t))return;s.uniform2iv(this.addr,t),xe(e,t)}}function Bf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3i(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(ve(e,t))return;s.uniform3iv(this.addr,t),xe(e,t)}}function kf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4i(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(ve(e,t))return;s.uniform4iv(this.addr,t),xe(e,t)}}function zf(s,t){const e=this.cache;e[0]!==t&&(s.uniform1ui(this.addr,t),e[0]=t)}function Hf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y)&&(s.uniform2ui(this.addr,t.x,t.y),e[0]=t.x,e[1]=t.y);else{if(ve(e,t))return;s.uniform2uiv(this.addr,t),xe(e,t)}}function Vf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z)&&(s.uniform3ui(this.addr,t.x,t.y,t.z),e[0]=t.x,e[1]=t.y,e[2]=t.z);else{if(ve(e,t))return;s.uniform3uiv(this.addr,t),xe(e,t)}}function Gf(s,t){const e=this.cache;if(t.x!==void 0)(e[0]!==t.x||e[1]!==t.y||e[2]!==t.z||e[3]!==t.w)&&(s.uniform4ui(this.addr,t.x,t.y,t.z,t.w),e[0]=t.x,e[1]=t.y,e[2]=t.z,e[3]=t.w);else{if(ve(e,t))return;s.uniform4uiv(this.addr,t),xe(e,t)}}function Wf(s,t,e){const n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i);let r;this.type===s.SAMPLER_2D_SHADOW?(Io.compareFunction=Pl,r=Io):r=Wl,e.setTexture2D(t||r,i)}function Xf(s,t,e){const n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),e.setTexture3D(t||ql,i)}function qf(s,t,e){const n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),e.setTextureCube(t||Yl,i)}function Yf(s,t,e){const n=this.cache,i=e.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),e.setTexture2DArray(t||Xl,i)}function $f(s){switch(s){case 5126:return Cf;case 35664:return Pf;case 35665:return Lf;case 35666:return If;case 35674:return Df;case 35675:return Uf;case 35676:return Nf;case 5124:case 35670:return Ff;case 35667:case 35671:return Of;case 35668:case 35672:return Bf;case 35669:case 35673:return kf;case 5125:return zf;case 36294:return Hf;case 36295:return Vf;case 36296:return Gf;case 35678:case 36198:case 36298:case 36306:case 35682:return Wf;case 35679:case 36299:case 36307:return Xf;case 35680:case 36300:case 36308:case 36293:return qf;case 36289:case 36303:case 36311:case 36292:return Yf}}function Kf(s,t){s.uniform1fv(this.addr,t)}function jf(s,t){const e=Ii(t,this.size,2);s.uniform2fv(this.addr,e)}function Zf(s,t){const e=Ii(t,this.size,3);s.uniform3fv(this.addr,e)}function Jf(s,t){const e=Ii(t,this.size,4);s.uniform4fv(this.addr,e)}function Qf(s,t){const e=Ii(t,this.size,4);s.uniformMatrix2fv(this.addr,!1,e)}function tp(s,t){const e=Ii(t,this.size,9);s.uniformMatrix3fv(this.addr,!1,e)}function ep(s,t){const e=Ii(t,this.size,16);s.uniformMatrix4fv(this.addr,!1,e)}function np(s,t){s.uniform1iv(this.addr,t)}function ip(s,t){s.uniform2iv(this.addr,t)}function sp(s,t){s.uniform3iv(this.addr,t)}function rp(s,t){s.uniform4iv(this.addr,t)}function ap(s,t){s.uniform1uiv(this.addr,t)}function op(s,t){s.uniform2uiv(this.addr,t)}function lp(s,t){s.uniform3uiv(this.addr,t)}function cp(s,t){s.uniform4uiv(this.addr,t)}function hp(s,t,e){const n=this.cache,i=t.length,r=js(e,i);ve(n,r)||(s.uniform1iv(this.addr,r),xe(n,r));for(let a=0;a!==i;++a)e.setTexture2D(t[a]||Wl,r[a])}function up(s,t,e){const n=this.cache,i=t.length,r=js(e,i);ve(n,r)||(s.uniform1iv(this.addr,r),xe(n,r));for(let a=0;a!==i;++a)e.setTexture3D(t[a]||ql,r[a])}function dp(s,t,e){const n=this.cache,i=t.length,r=js(e,i);ve(n,r)||(s.uniform1iv(this.addr,r),xe(n,r));for(let a=0;a!==i;++a)e.setTextureCube(t[a]||Yl,r[a])}function fp(s,t,e){const n=this.cache,i=t.length,r=js(e,i);ve(n,r)||(s.uniform1iv(this.addr,r),xe(n,r));for(let a=0;a!==i;++a)e.setTexture2DArray(t[a]||Xl,r[a])}function pp(s){switch(s){case 5126:return Kf;case 35664:return jf;case 35665:return Zf;case 35666:return Jf;case 35674:return Qf;case 35675:return tp;case 35676:return ep;case 5124:case 35670:return np;case 35667:case 35671:return ip;case 35668:case 35672:return sp;case 35669:case 35673:return rp;case 5125:return ap;case 36294:return op;case 36295:return lp;case 36296:return cp;case 35678:case 36198:case 36298:case 36306:case 35682:return hp;case 35679:case 36299:case 36307:return up;case 35680:case 36300:case 36308:case 36293:return dp;case 36289:case 36303:case 36311:case 36292:return fp}}class mp{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.setValue=$f(e.type)}}class gp{constructor(t,e,n){this.id=t,this.addr=n,this.cache=[],this.type=e.type,this.size=e.size,this.setValue=pp(e.type)}}class _p{constructor(t){this.id=t,this.seq=[],this.map={}}setValue(t,e,n){const i=this.seq;for(let r=0,a=i.length;r!==a;++r){const o=i[r];o.setValue(t,e[o.id],n)}}}const Ar=/(\w+)(\])?(\[|\.)?/g;function Bo(s,t){s.seq.push(t),s.map[t.id]=t}function vp(s,t,e){const n=s.name,i=n.length;for(Ar.lastIndex=0;;){const r=Ar.exec(n),a=Ar.lastIndex;let o=r[1];const l=r[2]==="]",c=r[3];if(l&&(o=o|0),c===void 0||c==="["&&a+2===i){Bo(e,c===void 0?new mp(o,s,t):new gp(o,s,t));break}else{let d=e.map[o];d===void 0&&(d=new _p(o),Bo(e,d)),e=d}}}class zs{constructor(t,e){this.seq=[],this.map={};const n=t.getProgramParameter(e,t.ACTIVE_UNIFORMS);for(let i=0;i<n;++i){const r=t.getActiveUniform(e,i),a=t.getUniformLocation(e,r.name);vp(r,a,this)}}setValue(t,e,n,i){const r=this.map[e];r!==void 0&&r.setValue(t,n,i)}setOptional(t,e,n){const i=e[n];i!==void 0&&this.setValue(t,n,i)}static upload(t,e,n,i){for(let r=0,a=e.length;r!==a;++r){const o=e[r],l=n[o.id];l.needsUpdate!==!1&&o.setValue(t,l.value,i)}}static seqWithValue(t,e){const n=[];for(let i=0,r=t.length;i!==r;++i){const a=t[i];a.id in e&&n.push(a)}return n}}function ko(s,t,e){const n=s.createShader(t);return s.shaderSource(n,e),s.compileShader(n),n}const xp=37297;let Mp=0;function yp(s,t){const e=s.split(`
`),n=[],i=Math.max(t-6,0),r=Math.min(t+6,e.length);for(let a=i;a<r;a++){const o=a+1;n.push(`${o===t?">":" "} ${o}: ${e[a]}`)}return n.join(`
`)}const zo=new Dt;function Sp(s){Wt._getMatrix(zo,Wt.workingColorSpace,s);const t=`mat3( ${zo.elements.map(e=>e.toFixed(4))} )`;switch(Wt.getTransfer(s)){case Ks:return[t,"LinearTransferOETF"];case Jt:return[t,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",s),[t,"LinearTransferOETF"]}}function Ho(s,t,e){const n=s.getShaderParameter(t,s.COMPILE_STATUS),i=s.getShaderInfoLog(t).trim();if(n&&i==="")return"";const r=/ERROR: 0:(\d+)/.exec(i);if(r){const a=parseInt(r[1]);return e.toUpperCase()+`

`+i+`

`+yp(s.getShaderSource(t),a)}else return i}function Ep(s,t){const e=Sp(t);return[`vec4 ${s}( vec4 value ) {`,`	return ${e[1]}( vec4( value.rgb * ${e[0]}, value.a ) );`,"}"].join(`
`)}function wp(s,t){let e;switch(t){case Tc:e="Linear";break;case Ac:e="Reinhard";break;case Rc:e="Cineon";break;case vl:e="ACESFilmic";break;case Pc:e="AgX";break;case Lc:e="Neutral";break;case Cc:e="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",t),e="Linear"}return"vec3 "+s+"( vec3 color ) { return "+e+"ToneMapping( color ); }"}const ws=new R;function bp(){Wt.getLuminanceCoefficients(ws);const s=ws.x.toFixed(4),t=ws.y.toFixed(4),e=ws.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${s}, ${t}, ${e} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Tp(s){return[s.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",s.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Ki).join(`
`)}function Ap(s){const t=[];for(const e in s){const n=s[e];n!==!1&&t.push("#define "+e+" "+n)}return t.join(`
`)}function Rp(s,t){const e={},n=s.getProgramParameter(t,s.ACTIVE_ATTRIBUTES);for(let i=0;i<n;i++){const r=s.getActiveAttrib(t,i),a=r.name;let o=1;r.type===s.FLOAT_MAT2&&(o=2),r.type===s.FLOAT_MAT3&&(o=3),r.type===s.FLOAT_MAT4&&(o=4),e[a]={type:r.type,location:s.getAttribLocation(t,a),locationSize:o}}return e}function Ki(s){return s!==""}function Vo(s,t){const e=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return s.replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,e).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function Go(s,t){return s.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}const Cp=/^[ \t]*#include +<([\w\d./]+)>/gm;function Sa(s){return s.replace(Cp,Lp)}const Pp=new Map;function Lp(s,t){let e=Nt[t];if(e===void 0){const n=Pp.get(t);if(n!==void 0)e=Nt[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',t,n);else throw new Error("Can not resolve #include <"+t+">")}return Sa(e)}const Ip=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Wo(s){return s.replace(Ip,Dp)}function Dp(s,t,e,n){let i="";for(let r=parseInt(t);r<parseInt(e);r++)i+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return i}function Xo(s){let t=`precision ${s.precision} float;
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
#define LOW_PRECISION`),t}function Up(s){let t="SHADOWMAP_TYPE_BASIC";return s.shadowMapType===gl?t="SHADOWMAP_TYPE_PCF":s.shadowMapType===rc?t="SHADOWMAP_TYPE_PCF_SOFT":s.shadowMapType===pn&&(t="SHADOWMAP_TYPE_VSM"),t}function Np(s){let t="ENVMAP_TYPE_CUBE";if(s.envMap)switch(s.envMapMode){case bi:case Ti:t="ENVMAP_TYPE_CUBE";break;case $s:t="ENVMAP_TYPE_CUBE_UV";break}return t}function Fp(s){let t="ENVMAP_MODE_REFLECTION";if(s.envMap)switch(s.envMapMode){case Ti:t="ENVMAP_MODE_REFRACTION";break}return t}function Op(s){let t="ENVMAP_BLENDING_NONE";if(s.envMap)switch(s.combine){case _l:t="ENVMAP_BLENDING_MULTIPLY";break;case wc:t="ENVMAP_BLENDING_MIX";break;case bc:t="ENVMAP_BLENDING_ADD";break}return t}function Bp(s){const t=s.envMapCubeUVHeight;if(t===null)return null;const e=Math.log2(t)-2,n=1/t;return{texelWidth:1/(3*Math.max(Math.pow(2,e),7*16)),texelHeight:n,maxMip:e}}function kp(s,t,e,n){const i=s.getContext(),r=e.defines;let a=e.vertexShader,o=e.fragmentShader;const l=Up(e),c=Np(e),h=Fp(e),d=Op(e),f=Bp(e),p=Tp(e),g=Ap(r),_=i.createProgram();let m,u,S=e.glslVersion?"#version "+e.glslVersion+`
`:"";e.isRawShaderMaterial?(m=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g].filter(Ki).join(`
`),m.length>0&&(m+=`
`),u=["#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g].filter(Ki).join(`
`),u.length>0&&(u+=`
`)):(m=[Xo(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g,e.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",e.batching?"#define USE_BATCHING":"",e.batchingColor?"#define USE_BATCHING_COLOR":"",e.instancing?"#define USE_INSTANCING":"",e.instancingColor?"#define USE_INSTANCING_COLOR":"",e.instancingMorph?"#define USE_INSTANCING_MORPH":"",e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.map?"#define USE_MAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+h:"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.displacementMap?"#define USE_DISPLACEMENTMAP":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.mapUv?"#define MAP_UV "+e.mapUv:"",e.alphaMapUv?"#define ALPHAMAP_UV "+e.alphaMapUv:"",e.lightMapUv?"#define LIGHTMAP_UV "+e.lightMapUv:"",e.aoMapUv?"#define AOMAP_UV "+e.aoMapUv:"",e.emissiveMapUv?"#define EMISSIVEMAP_UV "+e.emissiveMapUv:"",e.bumpMapUv?"#define BUMPMAP_UV "+e.bumpMapUv:"",e.normalMapUv?"#define NORMALMAP_UV "+e.normalMapUv:"",e.displacementMapUv?"#define DISPLACEMENTMAP_UV "+e.displacementMapUv:"",e.metalnessMapUv?"#define METALNESSMAP_UV "+e.metalnessMapUv:"",e.roughnessMapUv?"#define ROUGHNESSMAP_UV "+e.roughnessMapUv:"",e.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+e.anisotropyMapUv:"",e.clearcoatMapUv?"#define CLEARCOATMAP_UV "+e.clearcoatMapUv:"",e.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+e.clearcoatNormalMapUv:"",e.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+e.clearcoatRoughnessMapUv:"",e.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+e.iridescenceMapUv:"",e.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+e.iridescenceThicknessMapUv:"",e.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+e.sheenColorMapUv:"",e.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+e.sheenRoughnessMapUv:"",e.specularMapUv?"#define SPECULARMAP_UV "+e.specularMapUv:"",e.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+e.specularColorMapUv:"",e.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+e.specularIntensityMapUv:"",e.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+e.transmissionMapUv:"",e.thicknessMapUv?"#define THICKNESSMAP_UV "+e.thicknessMapUv:"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.flatShading?"#define FLAT_SHADED":"",e.skinning?"#define USE_SKINNING":"",e.morphTargets?"#define USE_MORPHTARGETS":"",e.morphNormals&&e.flatShading===!1?"#define USE_MORPHNORMALS":"",e.morphColors?"#define USE_MORPHCOLORS":"",e.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+e.morphTextureStride:"",e.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+e.morphTargetsCount:"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.sizeAttenuation?"#define USE_SIZEATTENUATION":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",e.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Ki).join(`
`),u=[Xo(e),"#define SHADER_TYPE "+e.shaderType,"#define SHADER_NAME "+e.shaderName,g,e.useFog&&e.fog?"#define USE_FOG":"",e.useFog&&e.fogExp2?"#define FOG_EXP2":"",e.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",e.map?"#define USE_MAP":"",e.matcap?"#define USE_MATCAP":"",e.envMap?"#define USE_ENVMAP":"",e.envMap?"#define "+c:"",e.envMap?"#define "+h:"",e.envMap?"#define "+d:"",f?"#define CUBEUV_TEXEL_WIDTH "+f.texelWidth:"",f?"#define CUBEUV_TEXEL_HEIGHT "+f.texelHeight:"",f?"#define CUBEUV_MAX_MIP "+f.maxMip+".0":"",e.lightMap?"#define USE_LIGHTMAP":"",e.aoMap?"#define USE_AOMAP":"",e.bumpMap?"#define USE_BUMPMAP":"",e.normalMap?"#define USE_NORMALMAP":"",e.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",e.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",e.emissiveMap?"#define USE_EMISSIVEMAP":"",e.anisotropy?"#define USE_ANISOTROPY":"",e.anisotropyMap?"#define USE_ANISOTROPYMAP":"",e.clearcoat?"#define USE_CLEARCOAT":"",e.clearcoatMap?"#define USE_CLEARCOATMAP":"",e.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",e.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",e.dispersion?"#define USE_DISPERSION":"",e.iridescence?"#define USE_IRIDESCENCE":"",e.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",e.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",e.specularMap?"#define USE_SPECULARMAP":"",e.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",e.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",e.roughnessMap?"#define USE_ROUGHNESSMAP":"",e.metalnessMap?"#define USE_METALNESSMAP":"",e.alphaMap?"#define USE_ALPHAMAP":"",e.alphaTest?"#define USE_ALPHATEST":"",e.alphaHash?"#define USE_ALPHAHASH":"",e.sheen?"#define USE_SHEEN":"",e.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",e.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",e.transmission?"#define USE_TRANSMISSION":"",e.transmissionMap?"#define USE_TRANSMISSIONMAP":"",e.thicknessMap?"#define USE_THICKNESSMAP":"",e.vertexTangents&&e.flatShading===!1?"#define USE_TANGENT":"",e.vertexColors||e.instancingColor||e.batchingColor?"#define USE_COLOR":"",e.vertexAlphas?"#define USE_COLOR_ALPHA":"",e.vertexUv1s?"#define USE_UV1":"",e.vertexUv2s?"#define USE_UV2":"",e.vertexUv3s?"#define USE_UV3":"",e.pointsUvs?"#define USE_POINTS_UV":"",e.gradientMap?"#define USE_GRADIENTMAP":"",e.flatShading?"#define FLAT_SHADED":"",e.doubleSided?"#define DOUBLE_SIDED":"",e.flipSided?"#define FLIP_SIDED":"",e.shadowMapEnabled?"#define USE_SHADOWMAP":"",e.shadowMapEnabled?"#define "+l:"",e.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",e.numLightProbes>0?"#define USE_LIGHT_PROBES":"",e.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",e.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",e.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",e.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",e.toneMapping!==In?"#define TONE_MAPPING":"",e.toneMapping!==In?Nt.tonemapping_pars_fragment:"",e.toneMapping!==In?wp("toneMapping",e.toneMapping):"",e.dithering?"#define DITHERING":"",e.opaque?"#define OPAQUE":"",Nt.colorspace_pars_fragment,Ep("linearToOutputTexel",e.outputColorSpace),bp(),e.useDepthPacking?"#define DEPTH_PACKING "+e.depthPacking:"",`
`].filter(Ki).join(`
`)),a=Sa(a),a=Vo(a,e),a=Go(a,e),o=Sa(o),o=Vo(o,e),o=Go(o,e),a=Wo(a),o=Wo(o),e.isRawShaderMaterial!==!0&&(S=`#version 300 es
`,m=[p,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+m,u=["#define varying in",e.glslVersion===no?"":"layout(location = 0) out highp vec4 pc_fragColor;",e.glslVersion===no?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+u);const w=S+m+a,v=S+u+o,P=ko(i,i.VERTEX_SHADER,w),T=ko(i,i.FRAGMENT_SHADER,v);i.attachShader(_,P),i.attachShader(_,T),e.index0AttributeName!==void 0?i.bindAttribLocation(_,0,e.index0AttributeName):e.morphTargets===!0&&i.bindAttribLocation(_,0,"position"),i.linkProgram(_);function A(C){if(s.debug.checkShaderErrors){const k=i.getProgramInfoLog(_).trim(),O=i.getShaderInfoLog(P).trim(),W=i.getShaderInfoLog(T).trim();let X=!0,H=!0;if(i.getProgramParameter(_,i.LINK_STATUS)===!1)if(X=!1,typeof s.debug.onShaderError=="function")s.debug.onShaderError(i,_,P,T);else{const j=Ho(i,P,"vertex"),V=Ho(i,T,"fragment");console.error("THREE.WebGLProgram: Shader Error "+i.getError()+" - VALIDATE_STATUS "+i.getProgramParameter(_,i.VALIDATE_STATUS)+`

Material Name: `+C.name+`
Material Type: `+C.type+`

Program Info Log: `+k+`
`+j+`
`+V)}else k!==""?console.warn("THREE.WebGLProgram: Program Info Log:",k):(O===""||W==="")&&(H=!1);H&&(C.diagnostics={runnable:X,programLog:k,vertexShader:{log:O,prefix:m},fragmentShader:{log:W,prefix:u}})}i.deleteShader(P),i.deleteShader(T),L=new zs(i,_),E=Rp(i,_)}let L;this.getUniforms=function(){return L===void 0&&A(this),L};let E;this.getAttributes=function(){return E===void 0&&A(this),E};let M=e.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return M===!1&&(M=i.getProgramParameter(_,xp)),M},this.destroy=function(){n.releaseStatesOfProgram(this),i.deleteProgram(_),this.program=void 0},this.type=e.shaderType,this.name=e.shaderName,this.id=Mp++,this.cacheKey=t,this.usedTimes=1,this.program=_,this.vertexShader=P,this.fragmentShader=T,this}let zp=0;class Hp{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(t){const e=t.vertexShader,n=t.fragmentShader,i=this._getShaderStage(e),r=this._getShaderStage(n),a=this._getShaderCacheForMaterial(t);return a.has(i)===!1&&(a.add(i),i.usedTimes++),a.has(r)===!1&&(a.add(r),r.usedTimes++),this}remove(t){const e=this.materialCache.get(t);for(const n of e)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(t),this}getVertexShaderID(t){return this._getShaderStage(t.vertexShader).id}getFragmentShaderID(t){return this._getShaderStage(t.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(t){const e=this.materialCache;let n=e.get(t);return n===void 0&&(n=new Set,e.set(t,n)),n}_getShaderStage(t){const e=this.shaderCache;let n=e.get(t);return n===void 0&&(n=new Vp(t),e.set(t,n)),n}}class Vp{constructor(t){this.id=zp++,this.code=t,this.usedTimes=0}}function Gp(s,t,e,n,i,r,a){const o=new Ul,l=new Hp,c=new Set,h=[],d=i.logarithmicDepthBuffer,f=i.vertexTextures;let p=i.precision;const g={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(E){return c.add(E),E===0?"uv":`uv${E}`}function m(E,M,C,k,O){const W=k.fog,X=O.geometry,H=E.isMeshStandardMaterial?k.environment:null,j=(E.isMeshStandardMaterial?e:t).get(E.envMap||H),V=j&&j.mapping===$s?j.image.height:null,st=g[E.type];E.precision!==null&&(p=i.getMaxPrecision(E.precision),p!==E.precision&&console.warn("THREE.WebGLProgram.getParameters:",E.precision,"not supported, using",p,"instead."));const ht=X.morphAttributes.position||X.morphAttributes.normal||X.morphAttributes.color,Mt=ht!==void 0?ht.length:0;let Ot=0;X.morphAttributes.position!==void 0&&(Ot=1),X.morphAttributes.normal!==void 0&&(Ot=2),X.morphAttributes.color!==void 0&&(Ot=3);let te,Y,tt,_t;if(st){const $t=sn[st];te=$t.vertexShader,Y=$t.fragmentShader}else te=E.vertexShader,Y=E.fragmentShader,l.update(E),tt=l.getVertexShaderID(E),_t=l.getFragmentShaderID(E);const rt=s.getRenderTarget(),bt=s.state.buffers.depth.getReversed(),Pt=O.isInstancedMesh===!0,Bt=O.isBatchedMesh===!0,ue=!!E.map,Vt=!!E.matcap,pe=!!j,N=!!E.aoMap,Ge=!!E.lightMap,kt=!!E.bumpMap,zt=!!E.normalMap,Et=!!E.displacementMap,se=!!E.emissiveMap,yt=!!E.metalnessMap,b=!!E.roughnessMap,x=E.anisotropy>0,F=E.clearcoat>0,$=E.dispersion>0,Z=E.iridescence>0,q=E.sheen>0,vt=E.transmission>0,at=x&&!!E.anisotropyMap,ut=F&&!!E.clearcoatMap,Gt=F&&!!E.clearcoatNormalMap,J=F&&!!E.clearcoatRoughnessMap,dt=Z&&!!E.iridescenceMap,wt=Z&&!!E.iridescenceThicknessMap,At=q&&!!E.sheenColorMap,ft=q&&!!E.sheenRoughnessMap,Ht=!!E.specularMap,Ut=!!E.specularColorMap,ee=!!E.specularIntensityMap,I=vt&&!!E.transmissionMap,nt=vt&&!!E.thicknessMap,G=!!E.gradientMap,K=!!E.alphaMap,ct=E.alphaTest>0,ot=!!E.alphaHash,Lt=!!E.extensions;let fe=In;E.toneMapped&&(rt===null||rt.isXRRenderTarget===!0)&&(fe=s.toneMapping);const Se={shaderID:st,shaderType:E.type,shaderName:E.name,vertexShader:te,fragmentShader:Y,defines:E.defines,customVertexShaderID:tt,customFragmentShaderID:_t,isRawShaderMaterial:E.isRawShaderMaterial===!0,glslVersion:E.glslVersion,precision:p,batching:Bt,batchingColor:Bt&&O._colorsTexture!==null,instancing:Pt,instancingColor:Pt&&O.instanceColor!==null,instancingMorph:Pt&&O.morphTexture!==null,supportsVertexTextures:f,outputColorSpace:rt===null?s.outputColorSpace:rt.isXRRenderTarget===!0?rt.texture.colorSpace:Pi,alphaToCoverage:!!E.alphaToCoverage,map:ue,matcap:Vt,envMap:pe,envMapMode:pe&&j.mapping,envMapCubeUVHeight:V,aoMap:N,lightMap:Ge,bumpMap:kt,normalMap:zt,displacementMap:f&&Et,emissiveMap:se,normalMapObjectSpace:zt&&E.normalMapType===Nc,normalMapTangentSpace:zt&&E.normalMapType===Cl,metalnessMap:yt,roughnessMap:b,anisotropy:x,anisotropyMap:at,clearcoat:F,clearcoatMap:ut,clearcoatNormalMap:Gt,clearcoatRoughnessMap:J,dispersion:$,iridescence:Z,iridescenceMap:dt,iridescenceThicknessMap:wt,sheen:q,sheenColorMap:At,sheenRoughnessMap:ft,specularMap:Ht,specularColorMap:Ut,specularIntensityMap:ee,transmission:vt,transmissionMap:I,thicknessMap:nt,gradientMap:G,opaque:E.transparent===!1&&E.blending===yi&&E.alphaToCoverage===!1,alphaMap:K,alphaTest:ct,alphaHash:ot,combine:E.combine,mapUv:ue&&_(E.map.channel),aoMapUv:N&&_(E.aoMap.channel),lightMapUv:Ge&&_(E.lightMap.channel),bumpMapUv:kt&&_(E.bumpMap.channel),normalMapUv:zt&&_(E.normalMap.channel),displacementMapUv:Et&&_(E.displacementMap.channel),emissiveMapUv:se&&_(E.emissiveMap.channel),metalnessMapUv:yt&&_(E.metalnessMap.channel),roughnessMapUv:b&&_(E.roughnessMap.channel),anisotropyMapUv:at&&_(E.anisotropyMap.channel),clearcoatMapUv:ut&&_(E.clearcoatMap.channel),clearcoatNormalMapUv:Gt&&_(E.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:J&&_(E.clearcoatRoughnessMap.channel),iridescenceMapUv:dt&&_(E.iridescenceMap.channel),iridescenceThicknessMapUv:wt&&_(E.iridescenceThicknessMap.channel),sheenColorMapUv:At&&_(E.sheenColorMap.channel),sheenRoughnessMapUv:ft&&_(E.sheenRoughnessMap.channel),specularMapUv:Ht&&_(E.specularMap.channel),specularColorMapUv:Ut&&_(E.specularColorMap.channel),specularIntensityMapUv:ee&&_(E.specularIntensityMap.channel),transmissionMapUv:I&&_(E.transmissionMap.channel),thicknessMapUv:nt&&_(E.thicknessMap.channel),alphaMapUv:K&&_(E.alphaMap.channel),vertexTangents:!!X.attributes.tangent&&(zt||x),vertexColors:E.vertexColors,vertexAlphas:E.vertexColors===!0&&!!X.attributes.color&&X.attributes.color.itemSize===4,pointsUvs:O.isPoints===!0&&!!X.attributes.uv&&(ue||K),fog:!!W,useFog:E.fog===!0,fogExp2:!!W&&W.isFogExp2,flatShading:E.flatShading===!0,sizeAttenuation:E.sizeAttenuation===!0,logarithmicDepthBuffer:d,reverseDepthBuffer:bt,skinning:O.isSkinnedMesh===!0,morphTargets:X.morphAttributes.position!==void 0,morphNormals:X.morphAttributes.normal!==void 0,morphColors:X.morphAttributes.color!==void 0,morphTargetsCount:Mt,morphTextureStride:Ot,numDirLights:M.directional.length,numPointLights:M.point.length,numSpotLights:M.spot.length,numSpotLightMaps:M.spotLightMap.length,numRectAreaLights:M.rectArea.length,numHemiLights:M.hemi.length,numDirLightShadows:M.directionalShadowMap.length,numPointLightShadows:M.pointShadowMap.length,numSpotLightShadows:M.spotShadowMap.length,numSpotLightShadowsWithMaps:M.numSpotLightShadowsWithMaps,numLightProbes:M.numLightProbes,numClippingPlanes:a.numPlanes,numClipIntersection:a.numIntersection,dithering:E.dithering,shadowMapEnabled:s.shadowMap.enabled&&C.length>0,shadowMapType:s.shadowMap.type,toneMapping:fe,decodeVideoTexture:ue&&E.map.isVideoTexture===!0&&Wt.getTransfer(E.map.colorSpace)===Jt,decodeVideoTextureEmissive:se&&E.emissiveMap.isVideoTexture===!0&&Wt.getTransfer(E.emissiveMap.colorSpace)===Jt,premultipliedAlpha:E.premultipliedAlpha,doubleSided:E.side===he,flipSided:E.side===ye,useDepthPacking:E.depthPacking>=0,depthPacking:E.depthPacking||0,index0AttributeName:E.index0AttributeName,extensionClipCullDistance:Lt&&E.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Lt&&E.extensions.multiDraw===!0||Bt)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:E.customProgramCacheKey()};return Se.vertexUv1s=c.has(1),Se.vertexUv2s=c.has(2),Se.vertexUv3s=c.has(3),c.clear(),Se}function u(E){const M=[];if(E.shaderID?M.push(E.shaderID):(M.push(E.customVertexShaderID),M.push(E.customFragmentShaderID)),E.defines!==void 0)for(const C in E.defines)M.push(C),M.push(E.defines[C]);return E.isRawShaderMaterial===!1&&(S(M,E),w(M,E),M.push(s.outputColorSpace)),M.push(E.customProgramCacheKey),M.join()}function S(E,M){E.push(M.precision),E.push(M.outputColorSpace),E.push(M.envMapMode),E.push(M.envMapCubeUVHeight),E.push(M.mapUv),E.push(M.alphaMapUv),E.push(M.lightMapUv),E.push(M.aoMapUv),E.push(M.bumpMapUv),E.push(M.normalMapUv),E.push(M.displacementMapUv),E.push(M.emissiveMapUv),E.push(M.metalnessMapUv),E.push(M.roughnessMapUv),E.push(M.anisotropyMapUv),E.push(M.clearcoatMapUv),E.push(M.clearcoatNormalMapUv),E.push(M.clearcoatRoughnessMapUv),E.push(M.iridescenceMapUv),E.push(M.iridescenceThicknessMapUv),E.push(M.sheenColorMapUv),E.push(M.sheenRoughnessMapUv),E.push(M.specularMapUv),E.push(M.specularColorMapUv),E.push(M.specularIntensityMapUv),E.push(M.transmissionMapUv),E.push(M.thicknessMapUv),E.push(M.combine),E.push(M.fogExp2),E.push(M.sizeAttenuation),E.push(M.morphTargetsCount),E.push(M.morphAttributeCount),E.push(M.numDirLights),E.push(M.numPointLights),E.push(M.numSpotLights),E.push(M.numSpotLightMaps),E.push(M.numHemiLights),E.push(M.numRectAreaLights),E.push(M.numDirLightShadows),E.push(M.numPointLightShadows),E.push(M.numSpotLightShadows),E.push(M.numSpotLightShadowsWithMaps),E.push(M.numLightProbes),E.push(M.shadowMapType),E.push(M.toneMapping),E.push(M.numClippingPlanes),E.push(M.numClipIntersection),E.push(M.depthPacking)}function w(E,M){o.disableAll(),M.supportsVertexTextures&&o.enable(0),M.instancing&&o.enable(1),M.instancingColor&&o.enable(2),M.instancingMorph&&o.enable(3),M.matcap&&o.enable(4),M.envMap&&o.enable(5),M.normalMapObjectSpace&&o.enable(6),M.normalMapTangentSpace&&o.enable(7),M.clearcoat&&o.enable(8),M.iridescence&&o.enable(9),M.alphaTest&&o.enable(10),M.vertexColors&&o.enable(11),M.vertexAlphas&&o.enable(12),M.vertexUv1s&&o.enable(13),M.vertexUv2s&&o.enable(14),M.vertexUv3s&&o.enable(15),M.vertexTangents&&o.enable(16),M.anisotropy&&o.enable(17),M.alphaHash&&o.enable(18),M.batching&&o.enable(19),M.dispersion&&o.enable(20),M.batchingColor&&o.enable(21),E.push(o.mask),o.disableAll(),M.fog&&o.enable(0),M.useFog&&o.enable(1),M.flatShading&&o.enable(2),M.logarithmicDepthBuffer&&o.enable(3),M.reverseDepthBuffer&&o.enable(4),M.skinning&&o.enable(5),M.morphTargets&&o.enable(6),M.morphNormals&&o.enable(7),M.morphColors&&o.enable(8),M.premultipliedAlpha&&o.enable(9),M.shadowMapEnabled&&o.enable(10),M.doubleSided&&o.enable(11),M.flipSided&&o.enable(12),M.useDepthPacking&&o.enable(13),M.dithering&&o.enable(14),M.transmission&&o.enable(15),M.sheen&&o.enable(16),M.opaque&&o.enable(17),M.pointsUvs&&o.enable(18),M.decodeVideoTexture&&o.enable(19),M.decodeVideoTextureEmissive&&o.enable(20),M.alphaToCoverage&&o.enable(21),E.push(o.mask)}function v(E){const M=g[E.type];let C;if(M){const k=sn[M];C=bh.clone(k.uniforms)}else C=E.uniforms;return C}function P(E,M){let C;for(let k=0,O=h.length;k<O;k++){const W=h[k];if(W.cacheKey===M){C=W,++C.usedTimes;break}}return C===void 0&&(C=new kp(s,M,E,r),h.push(C)),C}function T(E){if(--E.usedTimes===0){const M=h.indexOf(E);h[M]=h[h.length-1],h.pop(),E.destroy()}}function A(E){l.remove(E)}function L(){l.dispose()}return{getParameters:m,getProgramCacheKey:u,getUniforms:v,acquireProgram:P,releaseProgram:T,releaseShaderCache:A,programs:h,dispose:L}}function Wp(){let s=new WeakMap;function t(a){return s.has(a)}function e(a){let o=s.get(a);return o===void 0&&(o={},s.set(a,o)),o}function n(a){s.delete(a)}function i(a,o,l){s.get(a)[o]=l}function r(){s=new WeakMap}return{has:t,get:e,remove:n,update:i,dispose:r}}function Xp(s,t){return s.groupOrder!==t.groupOrder?s.groupOrder-t.groupOrder:s.renderOrder!==t.renderOrder?s.renderOrder-t.renderOrder:s.material.id!==t.material.id?s.material.id-t.material.id:s.z!==t.z?s.z-t.z:s.id-t.id}function qo(s,t){return s.groupOrder!==t.groupOrder?s.groupOrder-t.groupOrder:s.renderOrder!==t.renderOrder?s.renderOrder-t.renderOrder:s.z!==t.z?t.z-s.z:s.id-t.id}function Yo(){const s=[];let t=0;const e=[],n=[],i=[];function r(){t=0,e.length=0,n.length=0,i.length=0}function a(d,f,p,g,_,m){let u=s[t];return u===void 0?(u={id:d.id,object:d,geometry:f,material:p,groupOrder:g,renderOrder:d.renderOrder,z:_,group:m},s[t]=u):(u.id=d.id,u.object=d,u.geometry=f,u.material=p,u.groupOrder=g,u.renderOrder=d.renderOrder,u.z=_,u.group=m),t++,u}function o(d,f,p,g,_,m){const u=a(d,f,p,g,_,m);p.transmission>0?n.push(u):p.transparent===!0?i.push(u):e.push(u)}function l(d,f,p,g,_,m){const u=a(d,f,p,g,_,m);p.transmission>0?n.unshift(u):p.transparent===!0?i.unshift(u):e.unshift(u)}function c(d,f){e.length>1&&e.sort(d||Xp),n.length>1&&n.sort(f||qo),i.length>1&&i.sort(f||qo)}function h(){for(let d=t,f=s.length;d<f;d++){const p=s[d];if(p.id===null)break;p.id=null,p.object=null,p.geometry=null,p.material=null,p.group=null}}return{opaque:e,transmissive:n,transparent:i,init:r,push:o,unshift:l,finish:h,sort:c}}function qp(){let s=new WeakMap;function t(n,i){const r=s.get(n);let a;return r===void 0?(a=new Yo,s.set(n,[a])):i>=r.length?(a=new Yo,r.push(a)):a=r[i],a}function e(){s=new WeakMap}return{get:t,dispose:e}}function Yp(){const s={};return{get:function(t){if(s[t.id]!==void 0)return s[t.id];let e;switch(t.type){case"DirectionalLight":e={direction:new R,color:new Ft};break;case"SpotLight":e={position:new R,direction:new R,color:new Ft,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":e={position:new R,color:new Ft,distance:0,decay:0};break;case"HemisphereLight":e={direction:new R,skyColor:new Ft,groundColor:new Ft};break;case"RectAreaLight":e={color:new Ft,position:new R,halfWidth:new R,halfHeight:new R};break}return s[t.id]=e,e}}}function $p(){const s={};return{get:function(t){if(s[t.id]!==void 0)return s[t.id];let e;switch(t.type){case"DirectionalLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ct};break;case"SpotLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ct};break;case"PointLight":e={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Ct,shadowCameraNear:1,shadowCameraFar:1e3};break}return s[t.id]=e,e}}}let Kp=0;function jp(s,t){return(t.castShadow?2:0)-(s.castShadow?2:0)+(t.map?1:0)-(s.map?1:0)}function Zp(s){const t=new Yp,e=$p(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new R);const i=new R,r=new Zt,a=new Zt;function o(c){let h=0,d=0,f=0;for(let E=0;E<9;E++)n.probe[E].set(0,0,0);let p=0,g=0,_=0,m=0,u=0,S=0,w=0,v=0,P=0,T=0,A=0;c.sort(jp);for(let E=0,M=c.length;E<M;E++){const C=c[E],k=C.color,O=C.intensity,W=C.distance,X=C.shadow&&C.shadow.map?C.shadow.map.texture:null;if(C.isAmbientLight)h+=k.r*O,d+=k.g*O,f+=k.b*O;else if(C.isLightProbe){for(let H=0;H<9;H++)n.probe[H].addScaledVector(C.sh.coefficients[H],O);A++}else if(C.isDirectionalLight){const H=t.get(C);if(H.color.copy(C.color).multiplyScalar(C.intensity),C.castShadow){const j=C.shadow,V=e.get(C);V.shadowIntensity=j.intensity,V.shadowBias=j.bias,V.shadowNormalBias=j.normalBias,V.shadowRadius=j.radius,V.shadowMapSize=j.mapSize,n.directionalShadow[p]=V,n.directionalShadowMap[p]=X,n.directionalShadowMatrix[p]=C.shadow.matrix,S++}n.directional[p]=H,p++}else if(C.isSpotLight){const H=t.get(C);H.position.setFromMatrixPosition(C.matrixWorld),H.color.copy(k).multiplyScalar(O),H.distance=W,H.coneCos=Math.cos(C.angle),H.penumbraCos=Math.cos(C.angle*(1-C.penumbra)),H.decay=C.decay,n.spot[_]=H;const j=C.shadow;if(C.map&&(n.spotLightMap[P]=C.map,P++,j.updateMatrices(C),C.castShadow&&T++),n.spotLightMatrix[_]=j.matrix,C.castShadow){const V=e.get(C);V.shadowIntensity=j.intensity,V.shadowBias=j.bias,V.shadowNormalBias=j.normalBias,V.shadowRadius=j.radius,V.shadowMapSize=j.mapSize,n.spotShadow[_]=V,n.spotShadowMap[_]=X,v++}_++}else if(C.isRectAreaLight){const H=t.get(C);H.color.copy(k).multiplyScalar(O),H.halfWidth.set(C.width*.5,0,0),H.halfHeight.set(0,C.height*.5,0),n.rectArea[m]=H,m++}else if(C.isPointLight){const H=t.get(C);if(H.color.copy(C.color).multiplyScalar(C.intensity),H.distance=C.distance,H.decay=C.decay,C.castShadow){const j=C.shadow,V=e.get(C);V.shadowIntensity=j.intensity,V.shadowBias=j.bias,V.shadowNormalBias=j.normalBias,V.shadowRadius=j.radius,V.shadowMapSize=j.mapSize,V.shadowCameraNear=j.camera.near,V.shadowCameraFar=j.camera.far,n.pointShadow[g]=V,n.pointShadowMap[g]=X,n.pointShadowMatrix[g]=C.shadow.matrix,w++}n.point[g]=H,g++}else if(C.isHemisphereLight){const H=t.get(C);H.skyColor.copy(C.color).multiplyScalar(O),H.groundColor.copy(C.groundColor).multiplyScalar(O),n.hemi[u]=H,u++}}m>0&&(s.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=et.LTC_FLOAT_1,n.rectAreaLTC2=et.LTC_FLOAT_2):(n.rectAreaLTC1=et.LTC_HALF_1,n.rectAreaLTC2=et.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=d,n.ambient[2]=f;const L=n.hash;(L.directionalLength!==p||L.pointLength!==g||L.spotLength!==_||L.rectAreaLength!==m||L.hemiLength!==u||L.numDirectionalShadows!==S||L.numPointShadows!==w||L.numSpotShadows!==v||L.numSpotMaps!==P||L.numLightProbes!==A)&&(n.directional.length=p,n.spot.length=_,n.rectArea.length=m,n.point.length=g,n.hemi.length=u,n.directionalShadow.length=S,n.directionalShadowMap.length=S,n.pointShadow.length=w,n.pointShadowMap.length=w,n.spotShadow.length=v,n.spotShadowMap.length=v,n.directionalShadowMatrix.length=S,n.pointShadowMatrix.length=w,n.spotLightMatrix.length=v+P-T,n.spotLightMap.length=P,n.numSpotLightShadowsWithMaps=T,n.numLightProbes=A,L.directionalLength=p,L.pointLength=g,L.spotLength=_,L.rectAreaLength=m,L.hemiLength=u,L.numDirectionalShadows=S,L.numPointShadows=w,L.numSpotShadows=v,L.numSpotMaps=P,L.numLightProbes=A,n.version=Kp++)}function l(c,h){let d=0,f=0,p=0,g=0,_=0;const m=h.matrixWorldInverse;for(let u=0,S=c.length;u<S;u++){const w=c[u];if(w.isDirectionalLight){const v=n.directional[d];v.direction.setFromMatrixPosition(w.matrixWorld),i.setFromMatrixPosition(w.target.matrixWorld),v.direction.sub(i),v.direction.transformDirection(m),d++}else if(w.isSpotLight){const v=n.spot[p];v.position.setFromMatrixPosition(w.matrixWorld),v.position.applyMatrix4(m),v.direction.setFromMatrixPosition(w.matrixWorld),i.setFromMatrixPosition(w.target.matrixWorld),v.direction.sub(i),v.direction.transformDirection(m),p++}else if(w.isRectAreaLight){const v=n.rectArea[g];v.position.setFromMatrixPosition(w.matrixWorld),v.position.applyMatrix4(m),a.identity(),r.copy(w.matrixWorld),r.premultiply(m),a.extractRotation(r),v.halfWidth.set(w.width*.5,0,0),v.halfHeight.set(0,w.height*.5,0),v.halfWidth.applyMatrix4(a),v.halfHeight.applyMatrix4(a),g++}else if(w.isPointLight){const v=n.point[f];v.position.setFromMatrixPosition(w.matrixWorld),v.position.applyMatrix4(m),f++}else if(w.isHemisphereLight){const v=n.hemi[_];v.direction.setFromMatrixPosition(w.matrixWorld),v.direction.transformDirection(m),_++}}}return{setup:o,setupView:l,state:n}}function $o(s){const t=new Zp(s),e=[],n=[];function i(h){c.camera=h,e.length=0,n.length=0}function r(h){e.push(h)}function a(h){n.push(h)}function o(){t.setup(e)}function l(h){t.setupView(e,h)}const c={lightsArray:e,shadowsArray:n,camera:null,lights:t,transmissionRenderTarget:{}};return{init:i,state:c,setupLights:o,setupLightsView:l,pushLight:r,pushShadow:a}}function Jp(s){let t=new WeakMap;function e(i,r=0){const a=t.get(i);let o;return a===void 0?(o=new $o(s),t.set(i,[o])):r>=a.length?(o=new $o(s),a.push(o)):o=a[r],o}function n(){t=new WeakMap}return{get:e,dispose:n}}class Qp extends Fn{static get type(){return"MeshDepthMaterial"}constructor(t){super(),this.isMeshDepthMaterial=!0,this.depthPacking=Dc,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(t)}copy(t){return super.copy(t),this.depthPacking=t.depthPacking,this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this}}class tm extends Fn{static get type(){return"MeshDistanceMaterial"}constructor(t){super(),this.isMeshDistanceMaterial=!0,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(t)}copy(t){return super.copy(t),this.map=t.map,this.alphaMap=t.alphaMap,this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this}}const em=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,nm=`uniform sampler2D shadow_pass;
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
}`;function im(s,t,e){let n=new Fa;const i=new Ct,r=new Ct,a=new Qt,o=new Qp({depthPacking:Uc}),l=new tm,c={},h=e.maxTextureSize,d={[Dn]:ye,[ye]:Dn,[he]:he},f=new Un({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Ct},radius:{value:4}},vertexShader:em,fragmentShader:nm}),p=f.clone();p.defines.HORIZONTAL_PASS=1;const g=new _e;g.setAttribute("position",new Ie(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const _=new it(g,f),m=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=gl;let u=this.type;this.render=function(T,A,L){if(m.enabled===!1||m.autoUpdate===!1&&m.needsUpdate===!1||T.length===0)return;const E=s.getRenderTarget(),M=s.getActiveCubeFace(),C=s.getActiveMipmapLevel(),k=s.state;k.setBlending(Ln),k.buffers.color.setClear(1,1,1,1),k.buffers.depth.setTest(!0),k.setScissorTest(!1);const O=u!==pn&&this.type===pn,W=u===pn&&this.type!==pn;for(let X=0,H=T.length;X<H;X++){const j=T[X],V=j.shadow;if(V===void 0){console.warn("THREE.WebGLShadowMap:",j,"has no shadow.");continue}if(V.autoUpdate===!1&&V.needsUpdate===!1)continue;i.copy(V.mapSize);const st=V.getFrameExtents();if(i.multiply(st),r.copy(V.mapSize),(i.x>h||i.y>h)&&(i.x>h&&(r.x=Math.floor(h/st.x),i.x=r.x*st.x,V.mapSize.x=r.x),i.y>h&&(r.y=Math.floor(h/st.y),i.y=r.y*st.y,V.mapSize.y=r.y)),V.map===null||O===!0||W===!0){const Mt=this.type!==pn?{minFilter:Ve,magFilter:Ve}:{};V.map!==null&&V.map.dispose(),V.map=new Mn(i.x,i.y,Mt),V.map.texture.name=j.name+".shadowMap",V.camera.updateProjectionMatrix()}s.setRenderTarget(V.map),s.clear();const ht=V.getViewportCount();for(let Mt=0;Mt<ht;Mt++){const Ot=V.getViewport(Mt);a.set(r.x*Ot.x,r.y*Ot.y,r.x*Ot.z,r.y*Ot.w),k.viewport(a),V.updateMatrices(j,Mt),n=V.getFrustum(),v(A,L,V.camera,j,this.type)}V.isPointLightShadow!==!0&&this.type===pn&&S(V,L),V.needsUpdate=!1}u=this.type,m.needsUpdate=!1,s.setRenderTarget(E,M,C)};function S(T,A){const L=t.update(_);f.defines.VSM_SAMPLES!==T.blurSamples&&(f.defines.VSM_SAMPLES=T.blurSamples,p.defines.VSM_SAMPLES=T.blurSamples,f.needsUpdate=!0,p.needsUpdate=!0),T.mapPass===null&&(T.mapPass=new Mn(i.x,i.y)),f.uniforms.shadow_pass.value=T.map.texture,f.uniforms.resolution.value=T.mapSize,f.uniforms.radius.value=T.radius,s.setRenderTarget(T.mapPass),s.clear(),s.renderBufferDirect(A,null,L,f,_,null),p.uniforms.shadow_pass.value=T.mapPass.texture,p.uniforms.resolution.value=T.mapSize,p.uniforms.radius.value=T.radius,s.setRenderTarget(T.map),s.clear(),s.renderBufferDirect(A,null,L,p,_,null)}function w(T,A,L,E){let M=null;const C=L.isPointLight===!0?T.customDistanceMaterial:T.customDepthMaterial;if(C!==void 0)M=C;else if(M=L.isPointLight===!0?l:o,s.localClippingEnabled&&A.clipShadows===!0&&Array.isArray(A.clippingPlanes)&&A.clippingPlanes.length!==0||A.displacementMap&&A.displacementScale!==0||A.alphaMap&&A.alphaTest>0||A.map&&A.alphaTest>0){const k=M.uuid,O=A.uuid;let W=c[k];W===void 0&&(W={},c[k]=W);let X=W[O];X===void 0&&(X=M.clone(),W[O]=X,A.addEventListener("dispose",P)),M=X}if(M.visible=A.visible,M.wireframe=A.wireframe,E===pn?M.side=A.shadowSide!==null?A.shadowSide:A.side:M.side=A.shadowSide!==null?A.shadowSide:d[A.side],M.alphaMap=A.alphaMap,M.alphaTest=A.alphaTest,M.map=A.map,M.clipShadows=A.clipShadows,M.clippingPlanes=A.clippingPlanes,M.clipIntersection=A.clipIntersection,M.displacementMap=A.displacementMap,M.displacementScale=A.displacementScale,M.displacementBias=A.displacementBias,M.wireframeLinewidth=A.wireframeLinewidth,M.linewidth=A.linewidth,L.isPointLight===!0&&M.isMeshDistanceMaterial===!0){const k=s.properties.get(M);k.light=L}return M}function v(T,A,L,E,M){if(T.visible===!1)return;if(T.layers.test(A.layers)&&(T.isMesh||T.isLine||T.isPoints)&&(T.castShadow||T.receiveShadow&&M===pn)&&(!T.frustumCulled||n.intersectsObject(T))){T.modelViewMatrix.multiplyMatrices(L.matrixWorldInverse,T.matrixWorld);const O=t.update(T),W=T.material;if(Array.isArray(W)){const X=O.groups;for(let H=0,j=X.length;H<j;H++){const V=X[H],st=W[V.materialIndex];if(st&&st.visible){const ht=w(T,st,E,M);T.onBeforeShadow(s,T,A,L,O,ht,V),s.renderBufferDirect(L,null,O,ht,T,V),T.onAfterShadow(s,T,A,L,O,ht,V)}}}else if(W.visible){const X=w(T,W,E,M);T.onBeforeShadow(s,T,A,L,O,X,null),s.renderBufferDirect(L,null,O,X,T,null),T.onAfterShadow(s,T,A,L,O,X,null)}}const k=T.children;for(let O=0,W=k.length;O<W;O++)v(k[O],A,L,E,M)}function P(T){T.target.removeEventListener("dispose",P);for(const L in c){const E=c[L],M=T.target.uuid;M in E&&(E[M].dispose(),delete E[M])}}}const sm={[Br]:kr,[zr]:Gr,[Hr]:Wr,[wi]:Vr,[kr]:Br,[Gr]:zr,[Wr]:Hr,[Vr]:wi};function rm(s,t){function e(){let I=!1;const nt=new Qt;let G=null;const K=new Qt(0,0,0,0);return{setMask:function(ct){G!==ct&&!I&&(s.colorMask(ct,ct,ct,ct),G=ct)},setLocked:function(ct){I=ct},setClear:function(ct,ot,Lt,fe,Se){Se===!0&&(ct*=fe,ot*=fe,Lt*=fe),nt.set(ct,ot,Lt,fe),K.equals(nt)===!1&&(s.clearColor(ct,ot,Lt,fe),K.copy(nt))},reset:function(){I=!1,G=null,K.set(-1,0,0,0)}}}function n(){let I=!1,nt=!1,G=null,K=null,ct=null;return{setReversed:function(ot){if(nt!==ot){const Lt=t.get("EXT_clip_control");nt?Lt.clipControlEXT(Lt.LOWER_LEFT_EXT,Lt.ZERO_TO_ONE_EXT):Lt.clipControlEXT(Lt.LOWER_LEFT_EXT,Lt.NEGATIVE_ONE_TO_ONE_EXT);const fe=ct;ct=null,this.setClear(fe)}nt=ot},getReversed:function(){return nt},setTest:function(ot){ot?rt(s.DEPTH_TEST):bt(s.DEPTH_TEST)},setMask:function(ot){G!==ot&&!I&&(s.depthMask(ot),G=ot)},setFunc:function(ot){if(nt&&(ot=sm[ot]),K!==ot){switch(ot){case Br:s.depthFunc(s.NEVER);break;case kr:s.depthFunc(s.ALWAYS);break;case zr:s.depthFunc(s.LESS);break;case wi:s.depthFunc(s.LEQUAL);break;case Hr:s.depthFunc(s.EQUAL);break;case Vr:s.depthFunc(s.GEQUAL);break;case Gr:s.depthFunc(s.GREATER);break;case Wr:s.depthFunc(s.NOTEQUAL);break;default:s.depthFunc(s.LEQUAL)}K=ot}},setLocked:function(ot){I=ot},setClear:function(ot){ct!==ot&&(nt&&(ot=1-ot),s.clearDepth(ot),ct=ot)},reset:function(){I=!1,G=null,K=null,ct=null,nt=!1}}}function i(){let I=!1,nt=null,G=null,K=null,ct=null,ot=null,Lt=null,fe=null,Se=null;return{setTest:function($t){I||($t?rt(s.STENCIL_TEST):bt(s.STENCIL_TEST))},setMask:function($t){nt!==$t&&!I&&(s.stencilMask($t),nt=$t)},setFunc:function($t,Ye,on){(G!==$t||K!==Ye||ct!==on)&&(s.stencilFunc($t,Ye,on),G=$t,K=Ye,ct=on)},setOp:function($t,Ye,on){(ot!==$t||Lt!==Ye||fe!==on)&&(s.stencilOp($t,Ye,on),ot=$t,Lt=Ye,fe=on)},setLocked:function($t){I=$t},setClear:function($t){Se!==$t&&(s.clearStencil($t),Se=$t)},reset:function(){I=!1,nt=null,G=null,K=null,ct=null,ot=null,Lt=null,fe=null,Se=null}}}const r=new e,a=new n,o=new i,l=new WeakMap,c=new WeakMap;let h={},d={},f=new WeakMap,p=[],g=null,_=!1,m=null,u=null,S=null,w=null,v=null,P=null,T=null,A=new Ft(0,0,0),L=0,E=!1,M=null,C=null,k=null,O=null,W=null;const X=s.getParameter(s.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let H=!1,j=0;const V=s.getParameter(s.VERSION);V.indexOf("WebGL")!==-1?(j=parseFloat(/^WebGL (\d)/.exec(V)[1]),H=j>=1):V.indexOf("OpenGL ES")!==-1&&(j=parseFloat(/^OpenGL ES (\d)/.exec(V)[1]),H=j>=2);let st=null,ht={};const Mt=s.getParameter(s.SCISSOR_BOX),Ot=s.getParameter(s.VIEWPORT),te=new Qt().fromArray(Mt),Y=new Qt().fromArray(Ot);function tt(I,nt,G,K){const ct=new Uint8Array(4),ot=s.createTexture();s.bindTexture(I,ot),s.texParameteri(I,s.TEXTURE_MIN_FILTER,s.NEAREST),s.texParameteri(I,s.TEXTURE_MAG_FILTER,s.NEAREST);for(let Lt=0;Lt<G;Lt++)I===s.TEXTURE_3D||I===s.TEXTURE_2D_ARRAY?s.texImage3D(nt,0,s.RGBA,1,1,K,0,s.RGBA,s.UNSIGNED_BYTE,ct):s.texImage2D(nt+Lt,0,s.RGBA,1,1,0,s.RGBA,s.UNSIGNED_BYTE,ct);return ot}const _t={};_t[s.TEXTURE_2D]=tt(s.TEXTURE_2D,s.TEXTURE_2D,1),_t[s.TEXTURE_CUBE_MAP]=tt(s.TEXTURE_CUBE_MAP,s.TEXTURE_CUBE_MAP_POSITIVE_X,6),_t[s.TEXTURE_2D_ARRAY]=tt(s.TEXTURE_2D_ARRAY,s.TEXTURE_2D_ARRAY,1,1),_t[s.TEXTURE_3D]=tt(s.TEXTURE_3D,s.TEXTURE_3D,1,1),r.setClear(0,0,0,1),a.setClear(1),o.setClear(0),rt(s.DEPTH_TEST),a.setFunc(wi),kt(!1),zt(Za),rt(s.CULL_FACE),N(Ln);function rt(I){h[I]!==!0&&(s.enable(I),h[I]=!0)}function bt(I){h[I]!==!1&&(s.disable(I),h[I]=!1)}function Pt(I,nt){return d[I]!==nt?(s.bindFramebuffer(I,nt),d[I]=nt,I===s.DRAW_FRAMEBUFFER&&(d[s.FRAMEBUFFER]=nt),I===s.FRAMEBUFFER&&(d[s.DRAW_FRAMEBUFFER]=nt),!0):!1}function Bt(I,nt){let G=p,K=!1;if(I){G=f.get(nt),G===void 0&&(G=[],f.set(nt,G));const ct=I.textures;if(G.length!==ct.length||G[0]!==s.COLOR_ATTACHMENT0){for(let ot=0,Lt=ct.length;ot<Lt;ot++)G[ot]=s.COLOR_ATTACHMENT0+ot;G.length=ct.length,K=!0}}else G[0]!==s.BACK&&(G[0]=s.BACK,K=!0);K&&s.drawBuffers(G)}function ue(I){return g!==I?(s.useProgram(I),g=I,!0):!1}const Vt={[qn]:s.FUNC_ADD,[oc]:s.FUNC_SUBTRACT,[lc]:s.FUNC_REVERSE_SUBTRACT};Vt[cc]=s.MIN,Vt[hc]=s.MAX;const pe={[uc]:s.ZERO,[dc]:s.ONE,[fc]:s.SRC_COLOR,[Fr]:s.SRC_ALPHA,[xc]:s.SRC_ALPHA_SATURATE,[_c]:s.DST_COLOR,[mc]:s.DST_ALPHA,[pc]:s.ONE_MINUS_SRC_COLOR,[Or]:s.ONE_MINUS_SRC_ALPHA,[vc]:s.ONE_MINUS_DST_COLOR,[gc]:s.ONE_MINUS_DST_ALPHA,[Mc]:s.CONSTANT_COLOR,[yc]:s.ONE_MINUS_CONSTANT_COLOR,[Sc]:s.CONSTANT_ALPHA,[Ec]:s.ONE_MINUS_CONSTANT_ALPHA};function N(I,nt,G,K,ct,ot,Lt,fe,Se,$t){if(I===Ln){_===!0&&(bt(s.BLEND),_=!1);return}if(_===!1&&(rt(s.BLEND),_=!0),I!==ac){if(I!==m||$t!==E){if((u!==qn||v!==qn)&&(s.blendEquation(s.FUNC_ADD),u=qn,v=qn),$t)switch(I){case yi:s.blendFuncSeparate(s.ONE,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case Ja:s.blendFunc(s.ONE,s.ONE);break;case Qa:s.blendFuncSeparate(s.ZERO,s.ONE_MINUS_SRC_COLOR,s.ZERO,s.ONE);break;case to:s.blendFuncSeparate(s.ZERO,s.SRC_COLOR,s.ZERO,s.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",I);break}else switch(I){case yi:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case Ja:s.blendFunc(s.SRC_ALPHA,s.ONE);break;case Qa:s.blendFuncSeparate(s.ZERO,s.ONE_MINUS_SRC_COLOR,s.ZERO,s.ONE);break;case to:s.blendFunc(s.ZERO,s.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",I);break}S=null,w=null,P=null,T=null,A.set(0,0,0),L=0,m=I,E=$t}return}ct=ct||nt,ot=ot||G,Lt=Lt||K,(nt!==u||ct!==v)&&(s.blendEquationSeparate(Vt[nt],Vt[ct]),u=nt,v=ct),(G!==S||K!==w||ot!==P||Lt!==T)&&(s.blendFuncSeparate(pe[G],pe[K],pe[ot],pe[Lt]),S=G,w=K,P=ot,T=Lt),(fe.equals(A)===!1||Se!==L)&&(s.blendColor(fe.r,fe.g,fe.b,Se),A.copy(fe),L=Se),m=I,E=!1}function Ge(I,nt){I.side===he?bt(s.CULL_FACE):rt(s.CULL_FACE);let G=I.side===ye;nt&&(G=!G),kt(G),I.blending===yi&&I.transparent===!1?N(Ln):N(I.blending,I.blendEquation,I.blendSrc,I.blendDst,I.blendEquationAlpha,I.blendSrcAlpha,I.blendDstAlpha,I.blendColor,I.blendAlpha,I.premultipliedAlpha),a.setFunc(I.depthFunc),a.setTest(I.depthTest),a.setMask(I.depthWrite),r.setMask(I.colorWrite);const K=I.stencilWrite;o.setTest(K),K&&(o.setMask(I.stencilWriteMask),o.setFunc(I.stencilFunc,I.stencilRef,I.stencilFuncMask),o.setOp(I.stencilFail,I.stencilZFail,I.stencilZPass)),se(I.polygonOffset,I.polygonOffsetFactor,I.polygonOffsetUnits),I.alphaToCoverage===!0?rt(s.SAMPLE_ALPHA_TO_COVERAGE):bt(s.SAMPLE_ALPHA_TO_COVERAGE)}function kt(I){M!==I&&(I?s.frontFace(s.CW):s.frontFace(s.CCW),M=I)}function zt(I){I!==ic?(rt(s.CULL_FACE),I!==C&&(I===Za?s.cullFace(s.BACK):I===sc?s.cullFace(s.FRONT):s.cullFace(s.FRONT_AND_BACK))):bt(s.CULL_FACE),C=I}function Et(I){I!==k&&(H&&s.lineWidth(I),k=I)}function se(I,nt,G){I?(rt(s.POLYGON_OFFSET_FILL),(O!==nt||W!==G)&&(s.polygonOffset(nt,G),O=nt,W=G)):bt(s.POLYGON_OFFSET_FILL)}function yt(I){I?rt(s.SCISSOR_TEST):bt(s.SCISSOR_TEST)}function b(I){I===void 0&&(I=s.TEXTURE0+X-1),st!==I&&(s.activeTexture(I),st=I)}function x(I,nt,G){G===void 0&&(st===null?G=s.TEXTURE0+X-1:G=st);let K=ht[G];K===void 0&&(K={type:void 0,texture:void 0},ht[G]=K),(K.type!==I||K.texture!==nt)&&(st!==G&&(s.activeTexture(G),st=G),s.bindTexture(I,nt||_t[I]),K.type=I,K.texture=nt)}function F(){const I=ht[st];I!==void 0&&I.type!==void 0&&(s.bindTexture(I.type,null),I.type=void 0,I.texture=void 0)}function $(){try{s.compressedTexImage2D.apply(s,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function Z(){try{s.compressedTexImage3D.apply(s,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function q(){try{s.texSubImage2D.apply(s,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function vt(){try{s.texSubImage3D.apply(s,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function at(){try{s.compressedTexSubImage2D.apply(s,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function ut(){try{s.compressedTexSubImage3D.apply(s,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function Gt(){try{s.texStorage2D.apply(s,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function J(){try{s.texStorage3D.apply(s,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function dt(){try{s.texImage2D.apply(s,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function wt(){try{s.texImage3D.apply(s,arguments)}catch(I){console.error("THREE.WebGLState:",I)}}function At(I){te.equals(I)===!1&&(s.scissor(I.x,I.y,I.z,I.w),te.copy(I))}function ft(I){Y.equals(I)===!1&&(s.viewport(I.x,I.y,I.z,I.w),Y.copy(I))}function Ht(I,nt){let G=c.get(nt);G===void 0&&(G=new WeakMap,c.set(nt,G));let K=G.get(I);K===void 0&&(K=s.getUniformBlockIndex(nt,I.name),G.set(I,K))}function Ut(I,nt){const K=c.get(nt).get(I);l.get(nt)!==K&&(s.uniformBlockBinding(nt,K,I.__bindingPointIndex),l.set(nt,K))}function ee(){s.disable(s.BLEND),s.disable(s.CULL_FACE),s.disable(s.DEPTH_TEST),s.disable(s.POLYGON_OFFSET_FILL),s.disable(s.SCISSOR_TEST),s.disable(s.STENCIL_TEST),s.disable(s.SAMPLE_ALPHA_TO_COVERAGE),s.blendEquation(s.FUNC_ADD),s.blendFunc(s.ONE,s.ZERO),s.blendFuncSeparate(s.ONE,s.ZERO,s.ONE,s.ZERO),s.blendColor(0,0,0,0),s.colorMask(!0,!0,!0,!0),s.clearColor(0,0,0,0),s.depthMask(!0),s.depthFunc(s.LESS),a.setReversed(!1),s.clearDepth(1),s.stencilMask(4294967295),s.stencilFunc(s.ALWAYS,0,4294967295),s.stencilOp(s.KEEP,s.KEEP,s.KEEP),s.clearStencil(0),s.cullFace(s.BACK),s.frontFace(s.CCW),s.polygonOffset(0,0),s.activeTexture(s.TEXTURE0),s.bindFramebuffer(s.FRAMEBUFFER,null),s.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),s.bindFramebuffer(s.READ_FRAMEBUFFER,null),s.useProgram(null),s.lineWidth(1),s.scissor(0,0,s.canvas.width,s.canvas.height),s.viewport(0,0,s.canvas.width,s.canvas.height),h={},st=null,ht={},d={},f=new WeakMap,p=[],g=null,_=!1,m=null,u=null,S=null,w=null,v=null,P=null,T=null,A=new Ft(0,0,0),L=0,E=!1,M=null,C=null,k=null,O=null,W=null,te.set(0,0,s.canvas.width,s.canvas.height),Y.set(0,0,s.canvas.width,s.canvas.height),r.reset(),a.reset(),o.reset()}return{buffers:{color:r,depth:a,stencil:o},enable:rt,disable:bt,bindFramebuffer:Pt,drawBuffers:Bt,useProgram:ue,setBlending:N,setMaterial:Ge,setFlipSided:kt,setCullFace:zt,setLineWidth:Et,setPolygonOffset:se,setScissorTest:yt,activeTexture:b,bindTexture:x,unbindTexture:F,compressedTexImage2D:$,compressedTexImage3D:Z,texImage2D:dt,texImage3D:wt,updateUBOMapping:Ht,uniformBlockBinding:Ut,texStorage2D:Gt,texStorage3D:J,texSubImage2D:q,texSubImage3D:vt,compressedTexSubImage2D:at,compressedTexSubImage3D:ut,scissor:At,viewport:ft,reset:ee}}function Ko(s,t,e,n){const i=am(n);switch(e){case El:return s*t;case bl:return s*t;case Tl:return s*t*2;case Pa:return s*t/i.components*i.byteLength;case La:return s*t/i.components*i.byteLength;case Al:return s*t*2/i.components*i.byteLength;case Ia:return s*t*2/i.components*i.byteLength;case wl:return s*t*3/i.components*i.byteLength;case tn:return s*t*4/i.components*i.byteLength;case Da:return s*t*4/i.components*i.byteLength;case Ns:case Fs:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*8;case Os:case Bs:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case jr:case Jr:return Math.max(s,16)*Math.max(t,8)/4;case Kr:case Zr:return Math.max(s,8)*Math.max(t,8)/2;case Qr:case ta:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*8;case ea:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case na:return Math.floor((s+3)/4)*Math.floor((t+3)/4)*16;case ia:return Math.floor((s+4)/5)*Math.floor((t+3)/4)*16;case sa:return Math.floor((s+4)/5)*Math.floor((t+4)/5)*16;case ra:return Math.floor((s+5)/6)*Math.floor((t+4)/5)*16;case aa:return Math.floor((s+5)/6)*Math.floor((t+5)/6)*16;case oa:return Math.floor((s+7)/8)*Math.floor((t+4)/5)*16;case la:return Math.floor((s+7)/8)*Math.floor((t+5)/6)*16;case ca:return Math.floor((s+7)/8)*Math.floor((t+7)/8)*16;case ha:return Math.floor((s+9)/10)*Math.floor((t+4)/5)*16;case ua:return Math.floor((s+9)/10)*Math.floor((t+5)/6)*16;case da:return Math.floor((s+9)/10)*Math.floor((t+7)/8)*16;case fa:return Math.floor((s+9)/10)*Math.floor((t+9)/10)*16;case pa:return Math.floor((s+11)/12)*Math.floor((t+9)/10)*16;case ma:return Math.floor((s+11)/12)*Math.floor((t+11)/12)*16;case ks:case ga:case _a:return Math.ceil(s/4)*Math.ceil(t/4)*16;case Rl:case va:return Math.ceil(s/4)*Math.ceil(t/4)*8;case xa:case Ma:return Math.ceil(s/4)*Math.ceil(t/4)*16}throw new Error(`Unable to determine texture byte length for ${e} format.`)}function am(s){switch(s){case xn:case Ml:return{byteLength:1,components:1};case Qi:case yl:case es:return{byteLength:2,components:1};case Ra:case Ca:return{byteLength:2,components:4};case jn:case Aa:case an:return{byteLength:4,components:1};case Sl:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${s}.`)}function om(s,t,e,n,i,r,a){const o=t.has("WEBGL_multisampled_render_to_texture")?t.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new Ct,h=new WeakMap;let d;const f=new WeakMap;let p=!1;try{p=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function g(b,x){return p?new OffscreenCanvas(b,x):Vs("canvas")}function _(b,x,F){let $=1;const Z=yt(b);if((Z.width>F||Z.height>F)&&($=F/Math.max(Z.width,Z.height)),$<1)if(typeof HTMLImageElement<"u"&&b instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&b instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&b instanceof ImageBitmap||typeof VideoFrame<"u"&&b instanceof VideoFrame){const q=Math.floor($*Z.width),vt=Math.floor($*Z.height);d===void 0&&(d=g(q,vt));const at=x?g(q,vt):d;return at.width=q,at.height=vt,at.getContext("2d").drawImage(b,0,0,q,vt),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+Z.width+"x"+Z.height+") to ("+q+"x"+vt+")."),at}else return"data"in b&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+Z.width+"x"+Z.height+")."),b;return b}function m(b){return b.generateMipmaps}function u(b){s.generateMipmap(b)}function S(b){return b.isWebGLCubeRenderTarget?s.TEXTURE_CUBE_MAP:b.isWebGL3DRenderTarget?s.TEXTURE_3D:b.isWebGLArrayRenderTarget||b.isCompressedArrayTexture?s.TEXTURE_2D_ARRAY:s.TEXTURE_2D}function w(b,x,F,$,Z=!1){if(b!==null){if(s[b]!==void 0)return s[b];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+b+"'")}let q=x;if(x===s.RED&&(F===s.FLOAT&&(q=s.R32F),F===s.HALF_FLOAT&&(q=s.R16F),F===s.UNSIGNED_BYTE&&(q=s.R8)),x===s.RED_INTEGER&&(F===s.UNSIGNED_BYTE&&(q=s.R8UI),F===s.UNSIGNED_SHORT&&(q=s.R16UI),F===s.UNSIGNED_INT&&(q=s.R32UI),F===s.BYTE&&(q=s.R8I),F===s.SHORT&&(q=s.R16I),F===s.INT&&(q=s.R32I)),x===s.RG&&(F===s.FLOAT&&(q=s.RG32F),F===s.HALF_FLOAT&&(q=s.RG16F),F===s.UNSIGNED_BYTE&&(q=s.RG8)),x===s.RG_INTEGER&&(F===s.UNSIGNED_BYTE&&(q=s.RG8UI),F===s.UNSIGNED_SHORT&&(q=s.RG16UI),F===s.UNSIGNED_INT&&(q=s.RG32UI),F===s.BYTE&&(q=s.RG8I),F===s.SHORT&&(q=s.RG16I),F===s.INT&&(q=s.RG32I)),x===s.RGB_INTEGER&&(F===s.UNSIGNED_BYTE&&(q=s.RGB8UI),F===s.UNSIGNED_SHORT&&(q=s.RGB16UI),F===s.UNSIGNED_INT&&(q=s.RGB32UI),F===s.BYTE&&(q=s.RGB8I),F===s.SHORT&&(q=s.RGB16I),F===s.INT&&(q=s.RGB32I)),x===s.RGBA_INTEGER&&(F===s.UNSIGNED_BYTE&&(q=s.RGBA8UI),F===s.UNSIGNED_SHORT&&(q=s.RGBA16UI),F===s.UNSIGNED_INT&&(q=s.RGBA32UI),F===s.BYTE&&(q=s.RGBA8I),F===s.SHORT&&(q=s.RGBA16I),F===s.INT&&(q=s.RGBA32I)),x===s.RGB&&F===s.UNSIGNED_INT_5_9_9_9_REV&&(q=s.RGB9_E5),x===s.RGBA){const vt=Z?Ks:Wt.getTransfer($);F===s.FLOAT&&(q=s.RGBA32F),F===s.HALF_FLOAT&&(q=s.RGBA16F),F===s.UNSIGNED_BYTE&&(q=vt===Jt?s.SRGB8_ALPHA8:s.RGBA8),F===s.UNSIGNED_SHORT_4_4_4_4&&(q=s.RGBA4),F===s.UNSIGNED_SHORT_5_5_5_1&&(q=s.RGB5_A1)}return(q===s.R16F||q===s.R32F||q===s.RG16F||q===s.RG32F||q===s.RGBA16F||q===s.RGBA32F)&&t.get("EXT_color_buffer_float"),q}function v(b,x){let F;return b?x===null||x===jn||x===Ai?F=s.DEPTH24_STENCIL8:x===an?F=s.DEPTH32F_STENCIL8:x===Qi&&(F=s.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):x===null||x===jn||x===Ai?F=s.DEPTH_COMPONENT24:x===an?F=s.DEPTH_COMPONENT32F:x===Qi&&(F=s.DEPTH_COMPONENT16),F}function P(b,x){return m(b)===!0||b.isFramebufferTexture&&b.minFilter!==Ve&&b.minFilter!==rn?Math.log2(Math.max(x.width,x.height))+1:b.mipmaps!==void 0&&b.mipmaps.length>0?b.mipmaps.length:b.isCompressedTexture&&Array.isArray(b.image)?x.mipmaps.length:1}function T(b){const x=b.target;x.removeEventListener("dispose",T),L(x),x.isVideoTexture&&h.delete(x)}function A(b){const x=b.target;x.removeEventListener("dispose",A),M(x)}function L(b){const x=n.get(b);if(x.__webglInit===void 0)return;const F=b.source,$=f.get(F);if($){const Z=$[x.__cacheKey];Z.usedTimes--,Z.usedTimes===0&&E(b),Object.keys($).length===0&&f.delete(F)}n.remove(b)}function E(b){const x=n.get(b);s.deleteTexture(x.__webglTexture);const F=b.source,$=f.get(F);delete $[x.__cacheKey],a.memory.textures--}function M(b){const x=n.get(b);if(b.depthTexture&&(b.depthTexture.dispose(),n.remove(b.depthTexture)),b.isWebGLCubeRenderTarget)for(let $=0;$<6;$++){if(Array.isArray(x.__webglFramebuffer[$]))for(let Z=0;Z<x.__webglFramebuffer[$].length;Z++)s.deleteFramebuffer(x.__webglFramebuffer[$][Z]);else s.deleteFramebuffer(x.__webglFramebuffer[$]);x.__webglDepthbuffer&&s.deleteRenderbuffer(x.__webglDepthbuffer[$])}else{if(Array.isArray(x.__webglFramebuffer))for(let $=0;$<x.__webglFramebuffer.length;$++)s.deleteFramebuffer(x.__webglFramebuffer[$]);else s.deleteFramebuffer(x.__webglFramebuffer);if(x.__webglDepthbuffer&&s.deleteRenderbuffer(x.__webglDepthbuffer),x.__webglMultisampledFramebuffer&&s.deleteFramebuffer(x.__webglMultisampledFramebuffer),x.__webglColorRenderbuffer)for(let $=0;$<x.__webglColorRenderbuffer.length;$++)x.__webglColorRenderbuffer[$]&&s.deleteRenderbuffer(x.__webglColorRenderbuffer[$]);x.__webglDepthRenderbuffer&&s.deleteRenderbuffer(x.__webglDepthRenderbuffer)}const F=b.textures;for(let $=0,Z=F.length;$<Z;$++){const q=n.get(F[$]);q.__webglTexture&&(s.deleteTexture(q.__webglTexture),a.memory.textures--),n.remove(F[$])}n.remove(b)}let C=0;function k(){C=0}function O(){const b=C;return b>=i.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+b+" texture units while this GPU supports only "+i.maxTextures),C+=1,b}function W(b){const x=[];return x.push(b.wrapS),x.push(b.wrapT),x.push(b.wrapR||0),x.push(b.magFilter),x.push(b.minFilter),x.push(b.anisotropy),x.push(b.internalFormat),x.push(b.format),x.push(b.type),x.push(b.generateMipmaps),x.push(b.premultiplyAlpha),x.push(b.flipY),x.push(b.unpackAlignment),x.push(b.colorSpace),x.join()}function X(b,x){const F=n.get(b);if(b.isVideoTexture&&Et(b),b.isRenderTargetTexture===!1&&b.version>0&&F.__version!==b.version){const $=b.image;if($===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if($.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{Y(F,b,x);return}}e.bindTexture(s.TEXTURE_2D,F.__webglTexture,s.TEXTURE0+x)}function H(b,x){const F=n.get(b);if(b.version>0&&F.__version!==b.version){Y(F,b,x);return}e.bindTexture(s.TEXTURE_2D_ARRAY,F.__webglTexture,s.TEXTURE0+x)}function j(b,x){const F=n.get(b);if(b.version>0&&F.__version!==b.version){Y(F,b,x);return}e.bindTexture(s.TEXTURE_3D,F.__webglTexture,s.TEXTURE0+x)}function V(b,x){const F=n.get(b);if(b.version>0&&F.__version!==b.version){tt(F,b,x);return}e.bindTexture(s.TEXTURE_CUBE_MAP,F.__webglTexture,s.TEXTURE0+x)}const st={[Yr]:s.REPEAT,[$n]:s.CLAMP_TO_EDGE,[$r]:s.MIRRORED_REPEAT},ht={[Ve]:s.NEAREST,[Ic]:s.NEAREST_MIPMAP_NEAREST,[ss]:s.NEAREST_MIPMAP_LINEAR,[rn]:s.LINEAR,[er]:s.LINEAR_MIPMAP_NEAREST,[Kn]:s.LINEAR_MIPMAP_LINEAR},Mt={[Fc]:s.NEVER,[Vc]:s.ALWAYS,[Oc]:s.LESS,[Pl]:s.LEQUAL,[Bc]:s.EQUAL,[Hc]:s.GEQUAL,[kc]:s.GREATER,[zc]:s.NOTEQUAL};function Ot(b,x){if(x.type===an&&t.has("OES_texture_float_linear")===!1&&(x.magFilter===rn||x.magFilter===er||x.magFilter===ss||x.magFilter===Kn||x.minFilter===rn||x.minFilter===er||x.minFilter===ss||x.minFilter===Kn)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),s.texParameteri(b,s.TEXTURE_WRAP_S,st[x.wrapS]),s.texParameteri(b,s.TEXTURE_WRAP_T,st[x.wrapT]),(b===s.TEXTURE_3D||b===s.TEXTURE_2D_ARRAY)&&s.texParameteri(b,s.TEXTURE_WRAP_R,st[x.wrapR]),s.texParameteri(b,s.TEXTURE_MAG_FILTER,ht[x.magFilter]),s.texParameteri(b,s.TEXTURE_MIN_FILTER,ht[x.minFilter]),x.compareFunction&&(s.texParameteri(b,s.TEXTURE_COMPARE_MODE,s.COMPARE_REF_TO_TEXTURE),s.texParameteri(b,s.TEXTURE_COMPARE_FUNC,Mt[x.compareFunction])),t.has("EXT_texture_filter_anisotropic")===!0){if(x.magFilter===Ve||x.minFilter!==ss&&x.minFilter!==Kn||x.type===an&&t.has("OES_texture_float_linear")===!1)return;if(x.anisotropy>1||n.get(x).__currentAnisotropy){const F=t.get("EXT_texture_filter_anisotropic");s.texParameterf(b,F.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(x.anisotropy,i.getMaxAnisotropy())),n.get(x).__currentAnisotropy=x.anisotropy}}}function te(b,x){let F=!1;b.__webglInit===void 0&&(b.__webglInit=!0,x.addEventListener("dispose",T));const $=x.source;let Z=f.get($);Z===void 0&&(Z={},f.set($,Z));const q=W(x);if(q!==b.__cacheKey){Z[q]===void 0&&(Z[q]={texture:s.createTexture(),usedTimes:0},a.memory.textures++,F=!0),Z[q].usedTimes++;const vt=Z[b.__cacheKey];vt!==void 0&&(Z[b.__cacheKey].usedTimes--,vt.usedTimes===0&&E(x)),b.__cacheKey=q,b.__webglTexture=Z[q].texture}return F}function Y(b,x,F){let $=s.TEXTURE_2D;(x.isDataArrayTexture||x.isCompressedArrayTexture)&&($=s.TEXTURE_2D_ARRAY),x.isData3DTexture&&($=s.TEXTURE_3D);const Z=te(b,x),q=x.source;e.bindTexture($,b.__webglTexture,s.TEXTURE0+F);const vt=n.get(q);if(q.version!==vt.__version||Z===!0){e.activeTexture(s.TEXTURE0+F);const at=Wt.getPrimaries(Wt.workingColorSpace),ut=x.colorSpace===Cn?null:Wt.getPrimaries(x.colorSpace),Gt=x.colorSpace===Cn||at===ut?s.NONE:s.BROWSER_DEFAULT_WEBGL;s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,x.flipY),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,x.premultiplyAlpha),s.pixelStorei(s.UNPACK_ALIGNMENT,x.unpackAlignment),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,Gt);let J=_(x.image,!1,i.maxTextureSize);J=se(x,J);const dt=r.convert(x.format,x.colorSpace),wt=r.convert(x.type);let At=w(x.internalFormat,dt,wt,x.colorSpace,x.isVideoTexture);Ot($,x);let ft;const Ht=x.mipmaps,Ut=x.isVideoTexture!==!0,ee=vt.__version===void 0||Z===!0,I=q.dataReady,nt=P(x,J);if(x.isDepthTexture)At=v(x.format===Ri,x.type),ee&&(Ut?e.texStorage2D(s.TEXTURE_2D,1,At,J.width,J.height):e.texImage2D(s.TEXTURE_2D,0,At,J.width,J.height,0,dt,wt,null));else if(x.isDataTexture)if(Ht.length>0){Ut&&ee&&e.texStorage2D(s.TEXTURE_2D,nt,At,Ht[0].width,Ht[0].height);for(let G=0,K=Ht.length;G<K;G++)ft=Ht[G],Ut?I&&e.texSubImage2D(s.TEXTURE_2D,G,0,0,ft.width,ft.height,dt,wt,ft.data):e.texImage2D(s.TEXTURE_2D,G,At,ft.width,ft.height,0,dt,wt,ft.data);x.generateMipmaps=!1}else Ut?(ee&&e.texStorage2D(s.TEXTURE_2D,nt,At,J.width,J.height),I&&e.texSubImage2D(s.TEXTURE_2D,0,0,0,J.width,J.height,dt,wt,J.data)):e.texImage2D(s.TEXTURE_2D,0,At,J.width,J.height,0,dt,wt,J.data);else if(x.isCompressedTexture)if(x.isCompressedArrayTexture){Ut&&ee&&e.texStorage3D(s.TEXTURE_2D_ARRAY,nt,At,Ht[0].width,Ht[0].height,J.depth);for(let G=0,K=Ht.length;G<K;G++)if(ft=Ht[G],x.format!==tn)if(dt!==null)if(Ut){if(I)if(x.layerUpdates.size>0){const ct=Ko(ft.width,ft.height,x.format,x.type);for(const ot of x.layerUpdates){const Lt=ft.data.subarray(ot*ct/ft.data.BYTES_PER_ELEMENT,(ot+1)*ct/ft.data.BYTES_PER_ELEMENT);e.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,G,0,0,ot,ft.width,ft.height,1,dt,Lt)}x.clearLayerUpdates()}else e.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,G,0,0,0,ft.width,ft.height,J.depth,dt,ft.data)}else e.compressedTexImage3D(s.TEXTURE_2D_ARRAY,G,At,ft.width,ft.height,J.depth,0,ft.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else Ut?I&&e.texSubImage3D(s.TEXTURE_2D_ARRAY,G,0,0,0,ft.width,ft.height,J.depth,dt,wt,ft.data):e.texImage3D(s.TEXTURE_2D_ARRAY,G,At,ft.width,ft.height,J.depth,0,dt,wt,ft.data)}else{Ut&&ee&&e.texStorage2D(s.TEXTURE_2D,nt,At,Ht[0].width,Ht[0].height);for(let G=0,K=Ht.length;G<K;G++)ft=Ht[G],x.format!==tn?dt!==null?Ut?I&&e.compressedTexSubImage2D(s.TEXTURE_2D,G,0,0,ft.width,ft.height,dt,ft.data):e.compressedTexImage2D(s.TEXTURE_2D,G,At,ft.width,ft.height,0,ft.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):Ut?I&&e.texSubImage2D(s.TEXTURE_2D,G,0,0,ft.width,ft.height,dt,wt,ft.data):e.texImage2D(s.TEXTURE_2D,G,At,ft.width,ft.height,0,dt,wt,ft.data)}else if(x.isDataArrayTexture)if(Ut){if(ee&&e.texStorage3D(s.TEXTURE_2D_ARRAY,nt,At,J.width,J.height,J.depth),I)if(x.layerUpdates.size>0){const G=Ko(J.width,J.height,x.format,x.type);for(const K of x.layerUpdates){const ct=J.data.subarray(K*G/J.data.BYTES_PER_ELEMENT,(K+1)*G/J.data.BYTES_PER_ELEMENT);e.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,K,J.width,J.height,1,dt,wt,ct)}x.clearLayerUpdates()}else e.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,0,J.width,J.height,J.depth,dt,wt,J.data)}else e.texImage3D(s.TEXTURE_2D_ARRAY,0,At,J.width,J.height,J.depth,0,dt,wt,J.data);else if(x.isData3DTexture)Ut?(ee&&e.texStorage3D(s.TEXTURE_3D,nt,At,J.width,J.height,J.depth),I&&e.texSubImage3D(s.TEXTURE_3D,0,0,0,0,J.width,J.height,J.depth,dt,wt,J.data)):e.texImage3D(s.TEXTURE_3D,0,At,J.width,J.height,J.depth,0,dt,wt,J.data);else if(x.isFramebufferTexture){if(ee)if(Ut)e.texStorage2D(s.TEXTURE_2D,nt,At,J.width,J.height);else{let G=J.width,K=J.height;for(let ct=0;ct<nt;ct++)e.texImage2D(s.TEXTURE_2D,ct,At,G,K,0,dt,wt,null),G>>=1,K>>=1}}else if(Ht.length>0){if(Ut&&ee){const G=yt(Ht[0]);e.texStorage2D(s.TEXTURE_2D,nt,At,G.width,G.height)}for(let G=0,K=Ht.length;G<K;G++)ft=Ht[G],Ut?I&&e.texSubImage2D(s.TEXTURE_2D,G,0,0,dt,wt,ft):e.texImage2D(s.TEXTURE_2D,G,At,dt,wt,ft);x.generateMipmaps=!1}else if(Ut){if(ee){const G=yt(J);e.texStorage2D(s.TEXTURE_2D,nt,At,G.width,G.height)}I&&e.texSubImage2D(s.TEXTURE_2D,0,0,0,dt,wt,J)}else e.texImage2D(s.TEXTURE_2D,0,At,dt,wt,J);m(x)&&u($),vt.__version=q.version,x.onUpdate&&x.onUpdate(x)}b.__version=x.version}function tt(b,x,F){if(x.image.length!==6)return;const $=te(b,x),Z=x.source;e.bindTexture(s.TEXTURE_CUBE_MAP,b.__webglTexture,s.TEXTURE0+F);const q=n.get(Z);if(Z.version!==q.__version||$===!0){e.activeTexture(s.TEXTURE0+F);const vt=Wt.getPrimaries(Wt.workingColorSpace),at=x.colorSpace===Cn?null:Wt.getPrimaries(x.colorSpace),ut=x.colorSpace===Cn||vt===at?s.NONE:s.BROWSER_DEFAULT_WEBGL;s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,x.flipY),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,x.premultiplyAlpha),s.pixelStorei(s.UNPACK_ALIGNMENT,x.unpackAlignment),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,ut);const Gt=x.isCompressedTexture||x.image[0].isCompressedTexture,J=x.image[0]&&x.image[0].isDataTexture,dt=[];for(let K=0;K<6;K++)!Gt&&!J?dt[K]=_(x.image[K],!0,i.maxCubemapSize):dt[K]=J?x.image[K].image:x.image[K],dt[K]=se(x,dt[K]);const wt=dt[0],At=r.convert(x.format,x.colorSpace),ft=r.convert(x.type),Ht=w(x.internalFormat,At,ft,x.colorSpace),Ut=x.isVideoTexture!==!0,ee=q.__version===void 0||$===!0,I=Z.dataReady;let nt=P(x,wt);Ot(s.TEXTURE_CUBE_MAP,x);let G;if(Gt){Ut&&ee&&e.texStorage2D(s.TEXTURE_CUBE_MAP,nt,Ht,wt.width,wt.height);for(let K=0;K<6;K++){G=dt[K].mipmaps;for(let ct=0;ct<G.length;ct++){const ot=G[ct];x.format!==tn?At!==null?Ut?I&&e.compressedTexSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+K,ct,0,0,ot.width,ot.height,At,ot.data):e.compressedTexImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+K,ct,Ht,ot.width,ot.height,0,ot.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):Ut?I&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+K,ct,0,0,ot.width,ot.height,At,ft,ot.data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+K,ct,Ht,ot.width,ot.height,0,At,ft,ot.data)}}}else{if(G=x.mipmaps,Ut&&ee){G.length>0&&nt++;const K=yt(dt[0]);e.texStorage2D(s.TEXTURE_CUBE_MAP,nt,Ht,K.width,K.height)}for(let K=0;K<6;K++)if(J){Ut?I&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+K,0,0,0,dt[K].width,dt[K].height,At,ft,dt[K].data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+K,0,Ht,dt[K].width,dt[K].height,0,At,ft,dt[K].data);for(let ct=0;ct<G.length;ct++){const Lt=G[ct].image[K].image;Ut?I&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+K,ct+1,0,0,Lt.width,Lt.height,At,ft,Lt.data):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+K,ct+1,Ht,Lt.width,Lt.height,0,At,ft,Lt.data)}}else{Ut?I&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+K,0,0,0,At,ft,dt[K]):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+K,0,Ht,At,ft,dt[K]);for(let ct=0;ct<G.length;ct++){const ot=G[ct];Ut?I&&e.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+K,ct+1,0,0,At,ft,ot.image[K]):e.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+K,ct+1,Ht,At,ft,ot.image[K])}}}m(x)&&u(s.TEXTURE_CUBE_MAP),q.__version=Z.version,x.onUpdate&&x.onUpdate(x)}b.__version=x.version}function _t(b,x,F,$,Z,q){const vt=r.convert(F.format,F.colorSpace),at=r.convert(F.type),ut=w(F.internalFormat,vt,at,F.colorSpace),Gt=n.get(x),J=n.get(F);if(J.__renderTarget=x,!Gt.__hasExternalTextures){const dt=Math.max(1,x.width>>q),wt=Math.max(1,x.height>>q);Z===s.TEXTURE_3D||Z===s.TEXTURE_2D_ARRAY?e.texImage3D(Z,q,ut,dt,wt,x.depth,0,vt,at,null):e.texImage2D(Z,q,ut,dt,wt,0,vt,at,null)}e.bindFramebuffer(s.FRAMEBUFFER,b),zt(x)?o.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,$,Z,J.__webglTexture,0,kt(x)):(Z===s.TEXTURE_2D||Z>=s.TEXTURE_CUBE_MAP_POSITIVE_X&&Z<=s.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&s.framebufferTexture2D(s.FRAMEBUFFER,$,Z,J.__webglTexture,q),e.bindFramebuffer(s.FRAMEBUFFER,null)}function rt(b,x,F){if(s.bindRenderbuffer(s.RENDERBUFFER,b),x.depthBuffer){const $=x.depthTexture,Z=$&&$.isDepthTexture?$.type:null,q=v(x.stencilBuffer,Z),vt=x.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,at=kt(x);zt(x)?o.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,at,q,x.width,x.height):F?s.renderbufferStorageMultisample(s.RENDERBUFFER,at,q,x.width,x.height):s.renderbufferStorage(s.RENDERBUFFER,q,x.width,x.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,vt,s.RENDERBUFFER,b)}else{const $=x.textures;for(let Z=0;Z<$.length;Z++){const q=$[Z],vt=r.convert(q.format,q.colorSpace),at=r.convert(q.type),ut=w(q.internalFormat,vt,at,q.colorSpace),Gt=kt(x);F&&zt(x)===!1?s.renderbufferStorageMultisample(s.RENDERBUFFER,Gt,ut,x.width,x.height):zt(x)?o.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,Gt,ut,x.width,x.height):s.renderbufferStorage(s.RENDERBUFFER,ut,x.width,x.height)}}s.bindRenderbuffer(s.RENDERBUFFER,null)}function bt(b,x){if(x&&x.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(e.bindFramebuffer(s.FRAMEBUFFER,b),!(x.depthTexture&&x.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");const $=n.get(x.depthTexture);$.__renderTarget=x,(!$.__webglTexture||x.depthTexture.image.width!==x.width||x.depthTexture.image.height!==x.height)&&(x.depthTexture.image.width=x.width,x.depthTexture.image.height=x.height,x.depthTexture.needsUpdate=!0),X(x.depthTexture,0);const Z=$.__webglTexture,q=kt(x);if(x.depthTexture.format===Si)zt(x)?o.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,s.DEPTH_ATTACHMENT,s.TEXTURE_2D,Z,0,q):s.framebufferTexture2D(s.FRAMEBUFFER,s.DEPTH_ATTACHMENT,s.TEXTURE_2D,Z,0);else if(x.depthTexture.format===Ri)zt(x)?o.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,s.DEPTH_STENCIL_ATTACHMENT,s.TEXTURE_2D,Z,0,q):s.framebufferTexture2D(s.FRAMEBUFFER,s.DEPTH_STENCIL_ATTACHMENT,s.TEXTURE_2D,Z,0);else throw new Error("Unknown depthTexture format")}function Pt(b){const x=n.get(b),F=b.isWebGLCubeRenderTarget===!0;if(x.__boundDepthTexture!==b.depthTexture){const $=b.depthTexture;if(x.__depthDisposeCallback&&x.__depthDisposeCallback(),$){const Z=()=>{delete x.__boundDepthTexture,delete x.__depthDisposeCallback,$.removeEventListener("dispose",Z)};$.addEventListener("dispose",Z),x.__depthDisposeCallback=Z}x.__boundDepthTexture=$}if(b.depthTexture&&!x.__autoAllocateDepthBuffer){if(F)throw new Error("target.depthTexture not supported in Cube render targets");bt(x.__webglFramebuffer,b)}else if(F){x.__webglDepthbuffer=[];for(let $=0;$<6;$++)if(e.bindFramebuffer(s.FRAMEBUFFER,x.__webglFramebuffer[$]),x.__webglDepthbuffer[$]===void 0)x.__webglDepthbuffer[$]=s.createRenderbuffer(),rt(x.__webglDepthbuffer[$],b,!1);else{const Z=b.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,q=x.__webglDepthbuffer[$];s.bindRenderbuffer(s.RENDERBUFFER,q),s.framebufferRenderbuffer(s.FRAMEBUFFER,Z,s.RENDERBUFFER,q)}}else if(e.bindFramebuffer(s.FRAMEBUFFER,x.__webglFramebuffer),x.__webglDepthbuffer===void 0)x.__webglDepthbuffer=s.createRenderbuffer(),rt(x.__webglDepthbuffer,b,!1);else{const $=b.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,Z=x.__webglDepthbuffer;s.bindRenderbuffer(s.RENDERBUFFER,Z),s.framebufferRenderbuffer(s.FRAMEBUFFER,$,s.RENDERBUFFER,Z)}e.bindFramebuffer(s.FRAMEBUFFER,null)}function Bt(b,x,F){const $=n.get(b);x!==void 0&&_t($.__webglFramebuffer,b,b.texture,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,0),F!==void 0&&Pt(b)}function ue(b){const x=b.texture,F=n.get(b),$=n.get(x);b.addEventListener("dispose",A);const Z=b.textures,q=b.isWebGLCubeRenderTarget===!0,vt=Z.length>1;if(vt||($.__webglTexture===void 0&&($.__webglTexture=s.createTexture()),$.__version=x.version,a.memory.textures++),q){F.__webglFramebuffer=[];for(let at=0;at<6;at++)if(x.mipmaps&&x.mipmaps.length>0){F.__webglFramebuffer[at]=[];for(let ut=0;ut<x.mipmaps.length;ut++)F.__webglFramebuffer[at][ut]=s.createFramebuffer()}else F.__webglFramebuffer[at]=s.createFramebuffer()}else{if(x.mipmaps&&x.mipmaps.length>0){F.__webglFramebuffer=[];for(let at=0;at<x.mipmaps.length;at++)F.__webglFramebuffer[at]=s.createFramebuffer()}else F.__webglFramebuffer=s.createFramebuffer();if(vt)for(let at=0,ut=Z.length;at<ut;at++){const Gt=n.get(Z[at]);Gt.__webglTexture===void 0&&(Gt.__webglTexture=s.createTexture(),a.memory.textures++)}if(b.samples>0&&zt(b)===!1){F.__webglMultisampledFramebuffer=s.createFramebuffer(),F.__webglColorRenderbuffer=[],e.bindFramebuffer(s.FRAMEBUFFER,F.__webglMultisampledFramebuffer);for(let at=0;at<Z.length;at++){const ut=Z[at];F.__webglColorRenderbuffer[at]=s.createRenderbuffer(),s.bindRenderbuffer(s.RENDERBUFFER,F.__webglColorRenderbuffer[at]);const Gt=r.convert(ut.format,ut.colorSpace),J=r.convert(ut.type),dt=w(ut.internalFormat,Gt,J,ut.colorSpace,b.isXRRenderTarget===!0),wt=kt(b);s.renderbufferStorageMultisample(s.RENDERBUFFER,wt,dt,b.width,b.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+at,s.RENDERBUFFER,F.__webglColorRenderbuffer[at])}s.bindRenderbuffer(s.RENDERBUFFER,null),b.depthBuffer&&(F.__webglDepthRenderbuffer=s.createRenderbuffer(),rt(F.__webglDepthRenderbuffer,b,!0)),e.bindFramebuffer(s.FRAMEBUFFER,null)}}if(q){e.bindTexture(s.TEXTURE_CUBE_MAP,$.__webglTexture),Ot(s.TEXTURE_CUBE_MAP,x);for(let at=0;at<6;at++)if(x.mipmaps&&x.mipmaps.length>0)for(let ut=0;ut<x.mipmaps.length;ut++)_t(F.__webglFramebuffer[at][ut],b,x,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+at,ut);else _t(F.__webglFramebuffer[at],b,x,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+at,0);m(x)&&u(s.TEXTURE_CUBE_MAP),e.unbindTexture()}else if(vt){for(let at=0,ut=Z.length;at<ut;at++){const Gt=Z[at],J=n.get(Gt);e.bindTexture(s.TEXTURE_2D,J.__webglTexture),Ot(s.TEXTURE_2D,Gt),_t(F.__webglFramebuffer,b,Gt,s.COLOR_ATTACHMENT0+at,s.TEXTURE_2D,0),m(Gt)&&u(s.TEXTURE_2D)}e.unbindTexture()}else{let at=s.TEXTURE_2D;if((b.isWebGL3DRenderTarget||b.isWebGLArrayRenderTarget)&&(at=b.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),e.bindTexture(at,$.__webglTexture),Ot(at,x),x.mipmaps&&x.mipmaps.length>0)for(let ut=0;ut<x.mipmaps.length;ut++)_t(F.__webglFramebuffer[ut],b,x,s.COLOR_ATTACHMENT0,at,ut);else _t(F.__webglFramebuffer,b,x,s.COLOR_ATTACHMENT0,at,0);m(x)&&u(at),e.unbindTexture()}b.depthBuffer&&Pt(b)}function Vt(b){const x=b.textures;for(let F=0,$=x.length;F<$;F++){const Z=x[F];if(m(Z)){const q=S(b),vt=n.get(Z).__webglTexture;e.bindTexture(q,vt),u(q),e.unbindTexture()}}}const pe=[],N=[];function Ge(b){if(b.samples>0){if(zt(b)===!1){const x=b.textures,F=b.width,$=b.height;let Z=s.COLOR_BUFFER_BIT;const q=b.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,vt=n.get(b),at=x.length>1;if(at)for(let ut=0;ut<x.length;ut++)e.bindFramebuffer(s.FRAMEBUFFER,vt.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+ut,s.RENDERBUFFER,null),e.bindFramebuffer(s.FRAMEBUFFER,vt.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+ut,s.TEXTURE_2D,null,0);e.bindFramebuffer(s.READ_FRAMEBUFFER,vt.__webglMultisampledFramebuffer),e.bindFramebuffer(s.DRAW_FRAMEBUFFER,vt.__webglFramebuffer);for(let ut=0;ut<x.length;ut++){if(b.resolveDepthBuffer&&(b.depthBuffer&&(Z|=s.DEPTH_BUFFER_BIT),b.stencilBuffer&&b.resolveStencilBuffer&&(Z|=s.STENCIL_BUFFER_BIT)),at){s.framebufferRenderbuffer(s.READ_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.RENDERBUFFER,vt.__webglColorRenderbuffer[ut]);const Gt=n.get(x[ut]).__webglTexture;s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,Gt,0)}s.blitFramebuffer(0,0,F,$,0,0,F,$,Z,s.NEAREST),l===!0&&(pe.length=0,N.length=0,pe.push(s.COLOR_ATTACHMENT0+ut),b.depthBuffer&&b.resolveDepthBuffer===!1&&(pe.push(q),N.push(q),s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,N)),s.invalidateFramebuffer(s.READ_FRAMEBUFFER,pe))}if(e.bindFramebuffer(s.READ_FRAMEBUFFER,null),e.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),at)for(let ut=0;ut<x.length;ut++){e.bindFramebuffer(s.FRAMEBUFFER,vt.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+ut,s.RENDERBUFFER,vt.__webglColorRenderbuffer[ut]);const Gt=n.get(x[ut]).__webglTexture;e.bindFramebuffer(s.FRAMEBUFFER,vt.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+ut,s.TEXTURE_2D,Gt,0)}e.bindFramebuffer(s.DRAW_FRAMEBUFFER,vt.__webglMultisampledFramebuffer)}else if(b.depthBuffer&&b.resolveDepthBuffer===!1&&l){const x=b.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,[x])}}}function kt(b){return Math.min(i.maxSamples,b.samples)}function zt(b){const x=n.get(b);return b.samples>0&&t.has("WEBGL_multisampled_render_to_texture")===!0&&x.__useRenderToTexture!==!1}function Et(b){const x=a.render.frame;h.get(b)!==x&&(h.set(b,x),b.update())}function se(b,x){const F=b.colorSpace,$=b.format,Z=b.type;return b.isCompressedTexture===!0||b.isVideoTexture===!0||F!==Pi&&F!==Cn&&(Wt.getTransfer(F)===Jt?($!==tn||Z!==xn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",F)),x}function yt(b){return typeof HTMLImageElement<"u"&&b instanceof HTMLImageElement?(c.width=b.naturalWidth||b.width,c.height=b.naturalHeight||b.height):typeof VideoFrame<"u"&&b instanceof VideoFrame?(c.width=b.displayWidth,c.height=b.displayHeight):(c.width=b.width,c.height=b.height),c}this.allocateTextureUnit=O,this.resetTextureUnits=k,this.setTexture2D=X,this.setTexture2DArray=H,this.setTexture3D=j,this.setTextureCube=V,this.rebindTextures=Bt,this.setupRenderTarget=ue,this.updateRenderTargetMipmap=Vt,this.updateMultisampleRenderTarget=Ge,this.setupDepthRenderbuffer=Pt,this.setupFrameBufferTexture=_t,this.useMultisampledRTT=zt}function lm(s,t){function e(n,i=Cn){let r;const a=Wt.getTransfer(i);if(n===xn)return s.UNSIGNED_BYTE;if(n===Ra)return s.UNSIGNED_SHORT_4_4_4_4;if(n===Ca)return s.UNSIGNED_SHORT_5_5_5_1;if(n===Sl)return s.UNSIGNED_INT_5_9_9_9_REV;if(n===Ml)return s.BYTE;if(n===yl)return s.SHORT;if(n===Qi)return s.UNSIGNED_SHORT;if(n===Aa)return s.INT;if(n===jn)return s.UNSIGNED_INT;if(n===an)return s.FLOAT;if(n===es)return s.HALF_FLOAT;if(n===El)return s.ALPHA;if(n===wl)return s.RGB;if(n===tn)return s.RGBA;if(n===bl)return s.LUMINANCE;if(n===Tl)return s.LUMINANCE_ALPHA;if(n===Si)return s.DEPTH_COMPONENT;if(n===Ri)return s.DEPTH_STENCIL;if(n===Pa)return s.RED;if(n===La)return s.RED_INTEGER;if(n===Al)return s.RG;if(n===Ia)return s.RG_INTEGER;if(n===Da)return s.RGBA_INTEGER;if(n===Ns||n===Fs||n===Os||n===Bs)if(a===Jt)if(r=t.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===Ns)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Fs)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Os)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===Bs)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=t.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===Ns)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Fs)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Os)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===Bs)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===Kr||n===jr||n===Zr||n===Jr)if(r=t.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===Kr)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===jr)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===Zr)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===Jr)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===Qr||n===ta||n===ea)if(r=t.get("WEBGL_compressed_texture_etc"),r!==null){if(n===Qr||n===ta)return a===Jt?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===ea)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===na||n===ia||n===sa||n===ra||n===aa||n===oa||n===la||n===ca||n===ha||n===ua||n===da||n===fa||n===pa||n===ma)if(r=t.get("WEBGL_compressed_texture_astc"),r!==null){if(n===na)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===ia)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===sa)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===ra)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===aa)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===oa)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===la)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===ca)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===ha)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===ua)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===da)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===fa)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===pa)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===ma)return a===Jt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===ks||n===ga||n===_a)if(r=t.get("EXT_texture_compression_bptc"),r!==null){if(n===ks)return a===Jt?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===ga)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===_a)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===Rl||n===va||n===xa||n===Ma)if(r=t.get("EXT_texture_compression_rgtc"),r!==null){if(n===ks)return r.COMPRESSED_RED_RGTC1_EXT;if(n===va)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===xa)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===Ma)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===Ai?s.UNSIGNED_INT_24_8:s[n]!==void 0?s[n]:null}return{convert:e}}class cm extends Le{constructor(t=[]){super(),this.isArrayCamera=!0,this.cameras=t}}class Te extends jt{constructor(){super(),this.isGroup=!0,this.type="Group"}}const hm={type:"move"};class Rr{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Te,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Te,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new R,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new R),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Te,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new R,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new R),this._grip}dispatchEvent(t){return this._targetRay!==null&&this._targetRay.dispatchEvent(t),this._grip!==null&&this._grip.dispatchEvent(t),this._hand!==null&&this._hand.dispatchEvent(t),this}connect(t){if(t&&t.hand){const e=this._hand;if(e)for(const n of t.hand.values())this._getHandJoint(e,n)}return this.dispatchEvent({type:"connected",data:t}),this}disconnect(t){return this.dispatchEvent({type:"disconnected",data:t}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(t,e,n){let i=null,r=null,a=null;const o=this._targetRay,l=this._grip,c=this._hand;if(t&&e.session.visibilityState!=="visible-blurred"){if(c&&t.hand){a=!0;for(const _ of t.hand.values()){const m=e.getJointPose(_,n),u=this._getHandJoint(c,_);m!==null&&(u.matrix.fromArray(m.transform.matrix),u.matrix.decompose(u.position,u.rotation,u.scale),u.matrixWorldNeedsUpdate=!0,u.jointRadius=m.radius),u.visible=m!==null}const h=c.joints["index-finger-tip"],d=c.joints["thumb-tip"],f=h.position.distanceTo(d.position),p=.02,g=.005;c.inputState.pinching&&f>p+g?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:t.handedness,target:this})):!c.inputState.pinching&&f<=p-g&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:t.handedness,target:this}))}else l!==null&&t.gripSpace&&(r=e.getPose(t.gripSpace,n),r!==null&&(l.matrix.fromArray(r.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,r.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(r.linearVelocity)):l.hasLinearVelocity=!1,r.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(r.angularVelocity)):l.hasAngularVelocity=!1));o!==null&&(i=e.getPose(t.targetRaySpace,n),i===null&&r!==null&&(i=r),i!==null&&(o.matrix.fromArray(i.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,i.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(i.linearVelocity)):o.hasLinearVelocity=!1,i.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(i.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(hm)))}return o!==null&&(o.visible=i!==null),l!==null&&(l.visible=r!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(t,e){if(t.joints[e.jointName]===void 0){const n=new Te;n.matrixAutoUpdate=!1,n.visible=!1,t.joints[e.jointName]=n,t.add(n)}return t.joints[e.jointName]}}const um=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,dm=`
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

}`;class fm{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(t,e,n){if(this.texture===null){const i=new Ae,r=t.properties.get(i);r.__webglTexture=e.texture,(e.depthNear!=n.depthNear||e.depthFar!=n.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=i}}getMesh(t){if(this.texture!==null&&this.mesh===null){const e=t.cameras[0].viewport,n=new Un({vertexShader:um,fragmentShader:dm,uniforms:{depthColor:{value:this.texture},depthWidth:{value:e.z},depthHeight:{value:e.w}}});this.mesh=new it(new mn(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class pm extends Li{constructor(t,e){super();const n=this;let i=null,r=1,a=null,o="local-floor",l=1,c=null,h=null,d=null,f=null,p=null,g=null;const _=new fm,m=e.getContextAttributes();let u=null,S=null;const w=[],v=[],P=new Ct;let T=null;const A=new Le;A.viewport=new Qt;const L=new Le;L.viewport=new Qt;const E=[A,L],M=new cm;let C=null,k=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(Y){let tt=w[Y];return tt===void 0&&(tt=new Rr,w[Y]=tt),tt.getTargetRaySpace()},this.getControllerGrip=function(Y){let tt=w[Y];return tt===void 0&&(tt=new Rr,w[Y]=tt),tt.getGripSpace()},this.getHand=function(Y){let tt=w[Y];return tt===void 0&&(tt=new Rr,w[Y]=tt),tt.getHandSpace()};function O(Y){const tt=v.indexOf(Y.inputSource);if(tt===-1)return;const _t=w[tt];_t!==void 0&&(_t.update(Y.inputSource,Y.frame,c||a),_t.dispatchEvent({type:Y.type,data:Y.inputSource}))}function W(){i.removeEventListener("select",O),i.removeEventListener("selectstart",O),i.removeEventListener("selectend",O),i.removeEventListener("squeeze",O),i.removeEventListener("squeezestart",O),i.removeEventListener("squeezeend",O),i.removeEventListener("end",W),i.removeEventListener("inputsourceschange",X);for(let Y=0;Y<w.length;Y++){const tt=v[Y];tt!==null&&(v[Y]=null,w[Y].disconnect(tt))}C=null,k=null,_.reset(),t.setRenderTarget(u),p=null,f=null,d=null,i=null,S=null,te.stop(),n.isPresenting=!1,t.setPixelRatio(T),t.setSize(P.width,P.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(Y){r=Y,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(Y){o=Y,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(Y){c=Y},this.getBaseLayer=function(){return f!==null?f:p},this.getBinding=function(){return d},this.getFrame=function(){return g},this.getSession=function(){return i},this.setSession=async function(Y){if(i=Y,i!==null){if(u=t.getRenderTarget(),i.addEventListener("select",O),i.addEventListener("selectstart",O),i.addEventListener("selectend",O),i.addEventListener("squeeze",O),i.addEventListener("squeezestart",O),i.addEventListener("squeezeend",O),i.addEventListener("end",W),i.addEventListener("inputsourceschange",X),m.xrCompatible!==!0&&await e.makeXRCompatible(),T=t.getPixelRatio(),t.getSize(P),i.renderState.layers===void 0){const tt={antialias:m.antialias,alpha:!0,depth:m.depth,stencil:m.stencil,framebufferScaleFactor:r};p=new XRWebGLLayer(i,e,tt),i.updateRenderState({baseLayer:p}),t.setPixelRatio(1),t.setSize(p.framebufferWidth,p.framebufferHeight,!1),S=new Mn(p.framebufferWidth,p.framebufferHeight,{format:tn,type:xn,colorSpace:t.outputColorSpace,stencilBuffer:m.stencil})}else{let tt=null,_t=null,rt=null;m.depth&&(rt=m.stencil?e.DEPTH24_STENCIL8:e.DEPTH_COMPONENT24,tt=m.stencil?Ri:Si,_t=m.stencil?Ai:jn);const bt={colorFormat:e.RGBA8,depthFormat:rt,scaleFactor:r};d=new XRWebGLBinding(i,e),f=d.createProjectionLayer(bt),i.updateRenderState({layers:[f]}),t.setPixelRatio(1),t.setSize(f.textureWidth,f.textureHeight,!1),S=new Mn(f.textureWidth,f.textureHeight,{format:tn,type:xn,depthTexture:new Gl(f.textureWidth,f.textureHeight,_t,void 0,void 0,void 0,void 0,void 0,void 0,tt),stencilBuffer:m.stencil,colorSpace:t.outputColorSpace,samples:m.antialias?4:0,resolveDepthBuffer:f.ignoreDepthValues===!1})}S.isXRRenderTarget=!0,this.setFoveation(l),c=null,a=await i.requestReferenceSpace(o),te.setContext(i),te.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(i!==null)return i.environmentBlendMode},this.getDepthTexture=function(){return _.getDepthTexture()};function X(Y){for(let tt=0;tt<Y.removed.length;tt++){const _t=Y.removed[tt],rt=v.indexOf(_t);rt>=0&&(v[rt]=null,w[rt].disconnect(_t))}for(let tt=0;tt<Y.added.length;tt++){const _t=Y.added[tt];let rt=v.indexOf(_t);if(rt===-1){for(let Pt=0;Pt<w.length;Pt++)if(Pt>=v.length){v.push(_t),rt=Pt;break}else if(v[Pt]===null){v[Pt]=_t,rt=Pt;break}if(rt===-1)break}const bt=w[rt];bt&&bt.connect(_t)}}const H=new R,j=new R;function V(Y,tt,_t){H.setFromMatrixPosition(tt.matrixWorld),j.setFromMatrixPosition(_t.matrixWorld);const rt=H.distanceTo(j),bt=tt.projectionMatrix.elements,Pt=_t.projectionMatrix.elements,Bt=bt[14]/(bt[10]-1),ue=bt[14]/(bt[10]+1),Vt=(bt[9]+1)/bt[5],pe=(bt[9]-1)/bt[5],N=(bt[8]-1)/bt[0],Ge=(Pt[8]+1)/Pt[0],kt=Bt*N,zt=Bt*Ge,Et=rt/(-N+Ge),se=Et*-N;if(tt.matrixWorld.decompose(Y.position,Y.quaternion,Y.scale),Y.translateX(se),Y.translateZ(Et),Y.matrixWorld.compose(Y.position,Y.quaternion,Y.scale),Y.matrixWorldInverse.copy(Y.matrixWorld).invert(),bt[10]===-1)Y.projectionMatrix.copy(tt.projectionMatrix),Y.projectionMatrixInverse.copy(tt.projectionMatrixInverse);else{const yt=Bt+Et,b=ue+Et,x=kt-se,F=zt+(rt-se),$=Vt*ue/b*yt,Z=pe*ue/b*yt;Y.projectionMatrix.makePerspective(x,F,$,Z,yt,b),Y.projectionMatrixInverse.copy(Y.projectionMatrix).invert()}}function st(Y,tt){tt===null?Y.matrixWorld.copy(Y.matrix):Y.matrixWorld.multiplyMatrices(tt.matrixWorld,Y.matrix),Y.matrixWorldInverse.copy(Y.matrixWorld).invert()}this.updateCamera=function(Y){if(i===null)return;let tt=Y.near,_t=Y.far;_.texture!==null&&(_.depthNear>0&&(tt=_.depthNear),_.depthFar>0&&(_t=_.depthFar)),M.near=L.near=A.near=tt,M.far=L.far=A.far=_t,(C!==M.near||k!==M.far)&&(i.updateRenderState({depthNear:M.near,depthFar:M.far}),C=M.near,k=M.far),A.layers.mask=Y.layers.mask|2,L.layers.mask=Y.layers.mask|4,M.layers.mask=A.layers.mask|L.layers.mask;const rt=Y.parent,bt=M.cameras;st(M,rt);for(let Pt=0;Pt<bt.length;Pt++)st(bt[Pt],rt);bt.length===2?V(M,A,L):M.projectionMatrix.copy(A.projectionMatrix),ht(Y,M,rt)};function ht(Y,tt,_t){_t===null?Y.matrix.copy(tt.matrixWorld):(Y.matrix.copy(_t.matrixWorld),Y.matrix.invert(),Y.matrix.multiply(tt.matrixWorld)),Y.matrix.decompose(Y.position,Y.quaternion,Y.scale),Y.updateMatrixWorld(!0),Y.projectionMatrix.copy(tt.projectionMatrix),Y.projectionMatrixInverse.copy(tt.projectionMatrixInverse),Y.isPerspectiveCamera&&(Y.fov=ts*2*Math.atan(1/Y.projectionMatrix.elements[5]),Y.zoom=1)}this.getCamera=function(){return M},this.getFoveation=function(){if(!(f===null&&p===null))return l},this.setFoveation=function(Y){l=Y,f!==null&&(f.fixedFoveation=Y),p!==null&&p.fixedFoveation!==void 0&&(p.fixedFoveation=Y)},this.hasDepthSensing=function(){return _.texture!==null},this.getDepthSensingMesh=function(){return _.getMesh(M)};let Mt=null;function Ot(Y,tt){if(h=tt.getViewerPose(c||a),g=tt,h!==null){const _t=h.views;p!==null&&(t.setRenderTargetFramebuffer(S,p.framebuffer),t.setRenderTarget(S));let rt=!1;_t.length!==M.cameras.length&&(M.cameras.length=0,rt=!0);for(let Pt=0;Pt<_t.length;Pt++){const Bt=_t[Pt];let ue=null;if(p!==null)ue=p.getViewport(Bt);else{const pe=d.getViewSubImage(f,Bt);ue=pe.viewport,Pt===0&&(t.setRenderTargetTextures(S,pe.colorTexture,f.ignoreDepthValues?void 0:pe.depthStencilTexture),t.setRenderTarget(S))}let Vt=E[Pt];Vt===void 0&&(Vt=new Le,Vt.layers.enable(Pt),Vt.viewport=new Qt,E[Pt]=Vt),Vt.matrix.fromArray(Bt.transform.matrix),Vt.matrix.decompose(Vt.position,Vt.quaternion,Vt.scale),Vt.projectionMatrix.fromArray(Bt.projectionMatrix),Vt.projectionMatrixInverse.copy(Vt.projectionMatrix).invert(),Vt.viewport.set(ue.x,ue.y,ue.width,ue.height),Pt===0&&(M.matrix.copy(Vt.matrix),M.matrix.decompose(M.position,M.quaternion,M.scale)),rt===!0&&M.cameras.push(Vt)}const bt=i.enabledFeatures;if(bt&&bt.includes("depth-sensing")){const Pt=d.getDepthInformation(_t[0]);Pt&&Pt.isValid&&Pt.texture&&_.init(t,Pt,i.renderState)}}for(let _t=0;_t<w.length;_t++){const rt=v[_t],bt=w[_t];rt!==null&&bt!==void 0&&bt.update(rt,tt,c||a)}Mt&&Mt(Y,tt),tt.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:tt}),g=null}const te=new Hl;te.setAnimationLoop(Ot),this.setAnimationLoop=function(Y){Mt=Y},this.dispose=function(){}}}const Gn=new Be,mm=new Zt;function gm(s,t){function e(m,u){m.matrixAutoUpdate===!0&&m.updateMatrix(),u.value.copy(m.matrix)}function n(m,u){u.color.getRGB(m.fogColor.value,Bl(s)),u.isFog?(m.fogNear.value=u.near,m.fogFar.value=u.far):u.isFogExp2&&(m.fogDensity.value=u.density)}function i(m,u,S,w,v){u.isMeshBasicMaterial||u.isMeshLambertMaterial?r(m,u):u.isMeshToonMaterial?(r(m,u),d(m,u)):u.isMeshPhongMaterial?(r(m,u),h(m,u)):u.isMeshStandardMaterial?(r(m,u),f(m,u),u.isMeshPhysicalMaterial&&p(m,u,v)):u.isMeshMatcapMaterial?(r(m,u),g(m,u)):u.isMeshDepthMaterial?r(m,u):u.isMeshDistanceMaterial?(r(m,u),_(m,u)):u.isMeshNormalMaterial?r(m,u):u.isLineBasicMaterial?(a(m,u),u.isLineDashedMaterial&&o(m,u)):u.isPointsMaterial?l(m,u,S,w):u.isSpriteMaterial?c(m,u):u.isShadowMaterial?(m.color.value.copy(u.color),m.opacity.value=u.opacity):u.isShaderMaterial&&(u.uniformsNeedUpdate=!1)}function r(m,u){m.opacity.value=u.opacity,u.color&&m.diffuse.value.copy(u.color),u.emissive&&m.emissive.value.copy(u.emissive).multiplyScalar(u.emissiveIntensity),u.map&&(m.map.value=u.map,e(u.map,m.mapTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,e(u.alphaMap,m.alphaMapTransform)),u.bumpMap&&(m.bumpMap.value=u.bumpMap,e(u.bumpMap,m.bumpMapTransform),m.bumpScale.value=u.bumpScale,u.side===ye&&(m.bumpScale.value*=-1)),u.normalMap&&(m.normalMap.value=u.normalMap,e(u.normalMap,m.normalMapTransform),m.normalScale.value.copy(u.normalScale),u.side===ye&&m.normalScale.value.negate()),u.displacementMap&&(m.displacementMap.value=u.displacementMap,e(u.displacementMap,m.displacementMapTransform),m.displacementScale.value=u.displacementScale,m.displacementBias.value=u.displacementBias),u.emissiveMap&&(m.emissiveMap.value=u.emissiveMap,e(u.emissiveMap,m.emissiveMapTransform)),u.specularMap&&(m.specularMap.value=u.specularMap,e(u.specularMap,m.specularMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest);const S=t.get(u),w=S.envMap,v=S.envMapRotation;w&&(m.envMap.value=w,Gn.copy(v),Gn.x*=-1,Gn.y*=-1,Gn.z*=-1,w.isCubeTexture&&w.isRenderTargetTexture===!1&&(Gn.y*=-1,Gn.z*=-1),m.envMapRotation.value.setFromMatrix4(mm.makeRotationFromEuler(Gn)),m.flipEnvMap.value=w.isCubeTexture&&w.isRenderTargetTexture===!1?-1:1,m.reflectivity.value=u.reflectivity,m.ior.value=u.ior,m.refractionRatio.value=u.refractionRatio),u.lightMap&&(m.lightMap.value=u.lightMap,m.lightMapIntensity.value=u.lightMapIntensity,e(u.lightMap,m.lightMapTransform)),u.aoMap&&(m.aoMap.value=u.aoMap,m.aoMapIntensity.value=u.aoMapIntensity,e(u.aoMap,m.aoMapTransform))}function a(m,u){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,u.map&&(m.map.value=u.map,e(u.map,m.mapTransform))}function o(m,u){m.dashSize.value=u.dashSize,m.totalSize.value=u.dashSize+u.gapSize,m.scale.value=u.scale}function l(m,u,S,w){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,m.size.value=u.size*S,m.scale.value=w*.5,u.map&&(m.map.value=u.map,e(u.map,m.uvTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,e(u.alphaMap,m.alphaMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest)}function c(m,u){m.diffuse.value.copy(u.color),m.opacity.value=u.opacity,m.rotation.value=u.rotation,u.map&&(m.map.value=u.map,e(u.map,m.mapTransform)),u.alphaMap&&(m.alphaMap.value=u.alphaMap,e(u.alphaMap,m.alphaMapTransform)),u.alphaTest>0&&(m.alphaTest.value=u.alphaTest)}function h(m,u){m.specular.value.copy(u.specular),m.shininess.value=Math.max(u.shininess,1e-4)}function d(m,u){u.gradientMap&&(m.gradientMap.value=u.gradientMap)}function f(m,u){m.metalness.value=u.metalness,u.metalnessMap&&(m.metalnessMap.value=u.metalnessMap,e(u.metalnessMap,m.metalnessMapTransform)),m.roughness.value=u.roughness,u.roughnessMap&&(m.roughnessMap.value=u.roughnessMap,e(u.roughnessMap,m.roughnessMapTransform)),u.envMap&&(m.envMapIntensity.value=u.envMapIntensity)}function p(m,u,S){m.ior.value=u.ior,u.sheen>0&&(m.sheenColor.value.copy(u.sheenColor).multiplyScalar(u.sheen),m.sheenRoughness.value=u.sheenRoughness,u.sheenColorMap&&(m.sheenColorMap.value=u.sheenColorMap,e(u.sheenColorMap,m.sheenColorMapTransform)),u.sheenRoughnessMap&&(m.sheenRoughnessMap.value=u.sheenRoughnessMap,e(u.sheenRoughnessMap,m.sheenRoughnessMapTransform))),u.clearcoat>0&&(m.clearcoat.value=u.clearcoat,m.clearcoatRoughness.value=u.clearcoatRoughness,u.clearcoatMap&&(m.clearcoatMap.value=u.clearcoatMap,e(u.clearcoatMap,m.clearcoatMapTransform)),u.clearcoatRoughnessMap&&(m.clearcoatRoughnessMap.value=u.clearcoatRoughnessMap,e(u.clearcoatRoughnessMap,m.clearcoatRoughnessMapTransform)),u.clearcoatNormalMap&&(m.clearcoatNormalMap.value=u.clearcoatNormalMap,e(u.clearcoatNormalMap,m.clearcoatNormalMapTransform),m.clearcoatNormalScale.value.copy(u.clearcoatNormalScale),u.side===ye&&m.clearcoatNormalScale.value.negate())),u.dispersion>0&&(m.dispersion.value=u.dispersion),u.iridescence>0&&(m.iridescence.value=u.iridescence,m.iridescenceIOR.value=u.iridescenceIOR,m.iridescenceThicknessMinimum.value=u.iridescenceThicknessRange[0],m.iridescenceThicknessMaximum.value=u.iridescenceThicknessRange[1],u.iridescenceMap&&(m.iridescenceMap.value=u.iridescenceMap,e(u.iridescenceMap,m.iridescenceMapTransform)),u.iridescenceThicknessMap&&(m.iridescenceThicknessMap.value=u.iridescenceThicknessMap,e(u.iridescenceThicknessMap,m.iridescenceThicknessMapTransform))),u.transmission>0&&(m.transmission.value=u.transmission,m.transmissionSamplerMap.value=S.texture,m.transmissionSamplerSize.value.set(S.width,S.height),u.transmissionMap&&(m.transmissionMap.value=u.transmissionMap,e(u.transmissionMap,m.transmissionMapTransform)),m.thickness.value=u.thickness,u.thicknessMap&&(m.thicknessMap.value=u.thicknessMap,e(u.thicknessMap,m.thicknessMapTransform)),m.attenuationDistance.value=u.attenuationDistance,m.attenuationColor.value.copy(u.attenuationColor)),u.anisotropy>0&&(m.anisotropyVector.value.set(u.anisotropy*Math.cos(u.anisotropyRotation),u.anisotropy*Math.sin(u.anisotropyRotation)),u.anisotropyMap&&(m.anisotropyMap.value=u.anisotropyMap,e(u.anisotropyMap,m.anisotropyMapTransform))),m.specularIntensity.value=u.specularIntensity,m.specularColor.value.copy(u.specularColor),u.specularColorMap&&(m.specularColorMap.value=u.specularColorMap,e(u.specularColorMap,m.specularColorMapTransform)),u.specularIntensityMap&&(m.specularIntensityMap.value=u.specularIntensityMap,e(u.specularIntensityMap,m.specularIntensityMapTransform))}function g(m,u){u.matcap&&(m.matcap.value=u.matcap)}function _(m,u){const S=t.get(u).light;m.referencePosition.value.setFromMatrixPosition(S.matrixWorld),m.nearDistance.value=S.shadow.camera.near,m.farDistance.value=S.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:i}}function _m(s,t,e,n){let i={},r={},a=[];const o=s.getParameter(s.MAX_UNIFORM_BUFFER_BINDINGS);function l(S,w){const v=w.program;n.uniformBlockBinding(S,v)}function c(S,w){let v=i[S.id];v===void 0&&(g(S),v=h(S),i[S.id]=v,S.addEventListener("dispose",m));const P=w.program;n.updateUBOMapping(S,P);const T=t.render.frame;r[S.id]!==T&&(f(S),r[S.id]=T)}function h(S){const w=d();S.__bindingPointIndex=w;const v=s.createBuffer(),P=S.__size,T=S.usage;return s.bindBuffer(s.UNIFORM_BUFFER,v),s.bufferData(s.UNIFORM_BUFFER,P,T),s.bindBuffer(s.UNIFORM_BUFFER,null),s.bindBufferBase(s.UNIFORM_BUFFER,w,v),v}function d(){for(let S=0;S<o;S++)if(a.indexOf(S)===-1)return a.push(S),S;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function f(S){const w=i[S.id],v=S.uniforms,P=S.__cache;s.bindBuffer(s.UNIFORM_BUFFER,w);for(let T=0,A=v.length;T<A;T++){const L=Array.isArray(v[T])?v[T]:[v[T]];for(let E=0,M=L.length;E<M;E++){const C=L[E];if(p(C,T,E,P)===!0){const k=C.__offset,O=Array.isArray(C.value)?C.value:[C.value];let W=0;for(let X=0;X<O.length;X++){const H=O[X],j=_(H);typeof H=="number"||typeof H=="boolean"?(C.__data[0]=H,s.bufferSubData(s.UNIFORM_BUFFER,k+W,C.__data)):H.isMatrix3?(C.__data[0]=H.elements[0],C.__data[1]=H.elements[1],C.__data[2]=H.elements[2],C.__data[3]=0,C.__data[4]=H.elements[3],C.__data[5]=H.elements[4],C.__data[6]=H.elements[5],C.__data[7]=0,C.__data[8]=H.elements[6],C.__data[9]=H.elements[7],C.__data[10]=H.elements[8],C.__data[11]=0):(H.toArray(C.__data,W),W+=j.storage/Float32Array.BYTES_PER_ELEMENT)}s.bufferSubData(s.UNIFORM_BUFFER,k,C.__data)}}}s.bindBuffer(s.UNIFORM_BUFFER,null)}function p(S,w,v,P){const T=S.value,A=w+"_"+v;if(P[A]===void 0)return typeof T=="number"||typeof T=="boolean"?P[A]=T:P[A]=T.clone(),!0;{const L=P[A];if(typeof T=="number"||typeof T=="boolean"){if(L!==T)return P[A]=T,!0}else if(L.equals(T)===!1)return L.copy(T),!0}return!1}function g(S){const w=S.uniforms;let v=0;const P=16;for(let A=0,L=w.length;A<L;A++){const E=Array.isArray(w[A])?w[A]:[w[A]];for(let M=0,C=E.length;M<C;M++){const k=E[M],O=Array.isArray(k.value)?k.value:[k.value];for(let W=0,X=O.length;W<X;W++){const H=O[W],j=_(H),V=v%P,st=V%j.boundary,ht=V+st;v+=st,ht!==0&&P-ht<j.storage&&(v+=P-ht),k.__data=new Float32Array(j.storage/Float32Array.BYTES_PER_ELEMENT),k.__offset=v,v+=j.storage}}}const T=v%P;return T>0&&(v+=P-T),S.__size=v,S.__cache={},this}function _(S){const w={boundary:0,storage:0};return typeof S=="number"||typeof S=="boolean"?(w.boundary=4,w.storage=4):S.isVector2?(w.boundary=8,w.storage=8):S.isVector3||S.isColor?(w.boundary=16,w.storage=12):S.isVector4?(w.boundary=16,w.storage=16):S.isMatrix3?(w.boundary=48,w.storage=48):S.isMatrix4?(w.boundary=64,w.storage=64):S.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",S),w}function m(S){const w=S.target;w.removeEventListener("dispose",m);const v=a.indexOf(w.__bindingPointIndex);a.splice(v,1),s.deleteBuffer(i[w.id]),delete i[w.id],delete r[w.id]}function u(){for(const S in i)s.deleteBuffer(i[S]);a=[],i={},r={}}return{bind:l,update:c,dispose:u}}class vm{constructor(t={}){const{canvas:e=rh(),context:n=null,depth:i=!0,stencil:r=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:d=!1,reverseDepthBuffer:f=!1}=t;this.isWebGLRenderer=!0;let p;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");p=n.getContextAttributes().alpha}else p=a;const g=new Uint32Array(4),_=new Int32Array(4);let m=null,u=null;const S=[],w=[];this.domElement=e,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=Oe,this.toneMapping=In,this.toneMappingExposure=1;const v=this;let P=!1,T=0,A=0,L=null,E=-1,M=null;const C=new Qt,k=new Qt;let O=null;const W=new Ft(0);let X=0,H=e.width,j=e.height,V=1,st=null,ht=null;const Mt=new Qt(0,0,H,j),Ot=new Qt(0,0,H,j);let te=!1;const Y=new Fa;let tt=!1,_t=!1;const rt=new Zt,bt=new Zt,Pt=new R,Bt=new Qt,ue={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let Vt=!1;function pe(){return L===null?V:1}let N=n;function Ge(y,D){return e.getContext(y,D)}try{const y={alpha:!0,depth:i,stencil:r,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:d};if("setAttribute"in e&&e.setAttribute("data-engine",`three.js r${Ta}`),e.addEventListener("webglcontextlost",K,!1),e.addEventListener("webglcontextrestored",ct,!1),e.addEventListener("webglcontextcreationerror",ot,!1),N===null){const D="webgl2";if(N=Ge(D,y),N===null)throw Ge(D)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(y){throw console.error("THREE.WebGLRenderer: "+y.message),y}let kt,zt,Et,se,yt,b,x,F,$,Z,q,vt,at,ut,Gt,J,dt,wt,At,ft,Ht,Ut,ee,I;function nt(){kt=new Ef(N),kt.init(),Ut=new lm(N,kt),zt=new _f(N,kt,t,Ut),Et=new rm(N,kt),zt.reverseDepthBuffer&&f&&Et.buffers.depth.setReversed(!0),se=new Tf(N),yt=new Wp,b=new om(N,kt,Et,yt,zt,Ut,se),x=new xf(v),F=new Sf(v),$=new Ih(N),ee=new mf(N,$),Z=new wf(N,$,se,ee),q=new Rf(N,Z,$,se),At=new Af(N,zt,b),J=new vf(yt),vt=new Gp(v,x,F,kt,zt,ee,J),at=new gm(v,yt),ut=new qp,Gt=new Jp(kt),wt=new pf(v,x,F,Et,q,p,l),dt=new im(v,q,zt),I=new _m(N,se,zt,Et),ft=new gf(N,kt,se),Ht=new bf(N,kt,se),se.programs=vt.programs,v.capabilities=zt,v.extensions=kt,v.properties=yt,v.renderLists=ut,v.shadowMap=dt,v.state=Et,v.info=se}nt();const G=new pm(v,N);this.xr=G,this.getContext=function(){return N},this.getContextAttributes=function(){return N.getContextAttributes()},this.forceContextLoss=function(){const y=kt.get("WEBGL_lose_context");y&&y.loseContext()},this.forceContextRestore=function(){const y=kt.get("WEBGL_lose_context");y&&y.restoreContext()},this.getPixelRatio=function(){return V},this.setPixelRatio=function(y){y!==void 0&&(V=y,this.setSize(H,j,!1))},this.getSize=function(y){return y.set(H,j)},this.setSize=function(y,D,B=!0){if(G.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}H=y,j=D,e.width=Math.floor(y*V),e.height=Math.floor(D*V),B===!0&&(e.style.width=y+"px",e.style.height=D+"px"),this.setViewport(0,0,y,D)},this.getDrawingBufferSize=function(y){return y.set(H*V,j*V).floor()},this.setDrawingBufferSize=function(y,D,B){H=y,j=D,V=B,e.width=Math.floor(y*B),e.height=Math.floor(D*B),this.setViewport(0,0,y,D)},this.getCurrentViewport=function(y){return y.copy(C)},this.getViewport=function(y){return y.copy(Mt)},this.setViewport=function(y,D,B,z){y.isVector4?Mt.set(y.x,y.y,y.z,y.w):Mt.set(y,D,B,z),Et.viewport(C.copy(Mt).multiplyScalar(V).round())},this.getScissor=function(y){return y.copy(Ot)},this.setScissor=function(y,D,B,z){y.isVector4?Ot.set(y.x,y.y,y.z,y.w):Ot.set(y,D,B,z),Et.scissor(k.copy(Ot).multiplyScalar(V).round())},this.getScissorTest=function(){return te},this.setScissorTest=function(y){Et.setScissorTest(te=y)},this.setOpaqueSort=function(y){st=y},this.setTransparentSort=function(y){ht=y},this.getClearColor=function(y){return y.copy(wt.getClearColor())},this.setClearColor=function(){wt.setClearColor.apply(wt,arguments)},this.getClearAlpha=function(){return wt.getClearAlpha()},this.setClearAlpha=function(){wt.setClearAlpha.apply(wt,arguments)},this.clear=function(y=!0,D=!0,B=!0){let z=0;if(y){let U=!1;if(L!==null){const Q=L.texture.format;U=Q===Da||Q===Ia||Q===La}if(U){const Q=L.texture.type,lt=Q===xn||Q===jn||Q===Qi||Q===Ai||Q===Ra||Q===Ca,pt=wt.getClearColor(),mt=wt.getClearAlpha(),Rt=pt.r,It=pt.g,gt=pt.b;lt?(g[0]=Rt,g[1]=It,g[2]=gt,g[3]=mt,N.clearBufferuiv(N.COLOR,0,g)):(_[0]=Rt,_[1]=It,_[2]=gt,_[3]=mt,N.clearBufferiv(N.COLOR,0,_))}else z|=N.COLOR_BUFFER_BIT}D&&(z|=N.DEPTH_BUFFER_BIT),B&&(z|=N.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),N.clear(z)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){e.removeEventListener("webglcontextlost",K,!1),e.removeEventListener("webglcontextrestored",ct,!1),e.removeEventListener("webglcontextcreationerror",ot,!1),ut.dispose(),Gt.dispose(),yt.dispose(),x.dispose(),F.dispose(),q.dispose(),ee.dispose(),I.dispose(),vt.dispose(),G.dispose(),G.removeEventListener("sessionstart",Ga),G.removeEventListener("sessionend",Wa),On.stop()};function K(y){y.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),P=!0}function ct(){console.log("THREE.WebGLRenderer: Context Restored."),P=!1;const y=se.autoReset,D=dt.enabled,B=dt.autoUpdate,z=dt.needsUpdate,U=dt.type;nt(),se.autoReset=y,dt.enabled=D,dt.autoUpdate=B,dt.needsUpdate=z,dt.type=U}function ot(y){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",y.statusMessage)}function Lt(y){const D=y.target;D.removeEventListener("dispose",Lt),fe(D)}function fe(y){Se(y),yt.remove(y)}function Se(y){const D=yt.get(y).programs;D!==void 0&&(D.forEach(function(B){vt.releaseProgram(B)}),y.isShaderMaterial&&vt.releaseShaderCache(y))}this.renderBufferDirect=function(y,D,B,z,U,Q){D===null&&(D=ue);const lt=U.isMesh&&U.matrixWorld.determinant()<0,pt=tc(y,D,B,z,U);Et.setMaterial(z,lt);let mt=B.index,Rt=1;if(z.wireframe===!0){if(mt=Z.getWireframeAttribute(B),mt===void 0)return;Rt=2}const It=B.drawRange,gt=B.attributes.position;let Xt=It.start*Rt,ne=(It.start+It.count)*Rt;Q!==null&&(Xt=Math.max(Xt,Q.start*Rt),ne=Math.min(ne,(Q.start+Q.count)*Rt)),mt!==null?(Xt=Math.max(Xt,0),ne=Math.min(ne,mt.count)):gt!=null&&(Xt=Math.max(Xt,0),ne=Math.min(ne,gt.count));const re=ne-Xt;if(re<0||re===1/0)return;ee.setup(U,z,pt,B,mt);let De,qt=ft;if(mt!==null&&(De=$.get(mt),qt=Ht,qt.setIndex(De)),U.isMesh)z.wireframe===!0?(Et.setLineWidth(z.wireframeLinewidth*pe()),qt.setMode(N.LINES)):qt.setMode(N.TRIANGLES);else if(U.isLine){let xt=z.linewidth;xt===void 0&&(xt=1),Et.setLineWidth(xt*pe()),U.isLineSegments?qt.setMode(N.LINES):U.isLineLoop?qt.setMode(N.LINE_LOOP):qt.setMode(N.LINE_STRIP)}else U.isPoints?qt.setMode(N.POINTS):U.isSprite&&qt.setMode(N.TRIANGLES);if(U.isBatchedMesh)if(U._multiDrawInstances!==null)qt.renderMultiDrawInstances(U._multiDrawStarts,U._multiDrawCounts,U._multiDrawCount,U._multiDrawInstances);else if(kt.get("WEBGL_multi_draw"))qt.renderMultiDraw(U._multiDrawStarts,U._multiDrawCounts,U._multiDrawCount);else{const xt=U._multiDrawStarts,ln=U._multiDrawCounts,Yt=U._multiDrawCount,$e=mt?$.get(mt).bytesPerElement:1,ti=yt.get(z).currentProgram.getUniforms();for(let ke=0;ke<Yt;ke++)ti.setValue(N,"_gl_DrawID",ke),qt.render(xt[ke]/$e,ln[ke])}else if(U.isInstancedMesh)qt.renderInstances(Xt,re,U.count);else if(B.isInstancedBufferGeometry){const xt=B._maxInstanceCount!==void 0?B._maxInstanceCount:1/0,ln=Math.min(B.instanceCount,xt);qt.renderInstances(Xt,re,ln)}else qt.render(Xt,re)};function $t(y,D,B){y.transparent===!0&&y.side===he&&y.forceSinglePass===!1?(y.side=ye,y.needsUpdate=!0,is(y,D,B),y.side=Dn,y.needsUpdate=!0,is(y,D,B),y.side=he):is(y,D,B)}this.compile=function(y,D,B=null){B===null&&(B=y),u=Gt.get(B),u.init(D),w.push(u),B.traverseVisible(function(U){U.isLight&&U.layers.test(D.layers)&&(u.pushLight(U),U.castShadow&&u.pushShadow(U))}),y!==B&&y.traverseVisible(function(U){U.isLight&&U.layers.test(D.layers)&&(u.pushLight(U),U.castShadow&&u.pushShadow(U))}),u.setupLights();const z=new Set;return y.traverse(function(U){if(!(U.isMesh||U.isPoints||U.isLine||U.isSprite))return;const Q=U.material;if(Q)if(Array.isArray(Q))for(let lt=0;lt<Q.length;lt++){const pt=Q[lt];$t(pt,B,U),z.add(pt)}else $t(Q,B,U),z.add(Q)}),w.pop(),u=null,z},this.compileAsync=function(y,D,B=null){const z=this.compile(y,D,B);return new Promise(U=>{function Q(){if(z.forEach(function(lt){yt.get(lt).currentProgram.isReady()&&z.delete(lt)}),z.size===0){U(y);return}setTimeout(Q,10)}kt.get("KHR_parallel_shader_compile")!==null?Q():setTimeout(Q,10)})};let Ye=null;function on(y){Ye&&Ye(y)}function Ga(){On.stop()}function Wa(){On.start()}const On=new Hl;On.setAnimationLoop(on),typeof self<"u"&&On.setContext(self),this.setAnimationLoop=function(y){Ye=y,G.setAnimationLoop(y),y===null?On.stop():On.start()},G.addEventListener("sessionstart",Ga),G.addEventListener("sessionend",Wa),this.render=function(y,D){if(D!==void 0&&D.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(P===!0)return;if(y.matrixWorldAutoUpdate===!0&&y.updateMatrixWorld(),D.parent===null&&D.matrixWorldAutoUpdate===!0&&D.updateMatrixWorld(),G.enabled===!0&&G.isPresenting===!0&&(G.cameraAutoUpdate===!0&&G.updateCamera(D),D=G.getCamera()),y.isScene===!0&&y.onBeforeRender(v,y,D,L),u=Gt.get(y,w.length),u.init(D),w.push(u),bt.multiplyMatrices(D.projectionMatrix,D.matrixWorldInverse),Y.setFromProjectionMatrix(bt),_t=this.localClippingEnabled,tt=J.init(this.clippingPlanes,_t),m=ut.get(y,S.length),m.init(),S.push(m),G.enabled===!0&&G.isPresenting===!0){const Q=v.xr.getDepthSensingMesh();Q!==null&&tr(Q,D,-1/0,v.sortObjects)}tr(y,D,0,v.sortObjects),m.finish(),v.sortObjects===!0&&m.sort(st,ht),Vt=G.enabled===!1||G.isPresenting===!1||G.hasDepthSensing()===!1,Vt&&wt.addToRenderList(m,y),this.info.render.frame++,tt===!0&&J.beginShadows();const B=u.state.shadowsArray;dt.render(B,y,D),tt===!0&&J.endShadows(),this.info.autoReset===!0&&this.info.reset();const z=m.opaque,U=m.transmissive;if(u.setupLights(),D.isArrayCamera){const Q=D.cameras;if(U.length>0)for(let lt=0,pt=Q.length;lt<pt;lt++){const mt=Q[lt];qa(z,U,y,mt)}Vt&&wt.render(y);for(let lt=0,pt=Q.length;lt<pt;lt++){const mt=Q[lt];Xa(m,y,mt,mt.viewport)}}else U.length>0&&qa(z,U,y,D),Vt&&wt.render(y),Xa(m,y,D);L!==null&&(b.updateMultisampleRenderTarget(L),b.updateRenderTargetMipmap(L)),y.isScene===!0&&y.onAfterRender(v,y,D),ee.resetDefaultState(),E=-1,M=null,w.pop(),w.length>0?(u=w[w.length-1],tt===!0&&J.setGlobalState(v.clippingPlanes,u.state.camera)):u=null,S.pop(),S.length>0?m=S[S.length-1]:m=null};function tr(y,D,B,z){if(y.visible===!1)return;if(y.layers.test(D.layers)){if(y.isGroup)B=y.renderOrder;else if(y.isLOD)y.autoUpdate===!0&&y.update(D);else if(y.isLight)u.pushLight(y),y.castShadow&&u.pushShadow(y);else if(y.isSprite){if(!y.frustumCulled||Y.intersectsSprite(y)){z&&Bt.setFromMatrixPosition(y.matrixWorld).applyMatrix4(bt);const lt=q.update(y),pt=y.material;pt.visible&&m.push(y,lt,pt,B,Bt.z,null)}}else if((y.isMesh||y.isLine||y.isPoints)&&(!y.frustumCulled||Y.intersectsObject(y))){const lt=q.update(y),pt=y.material;if(z&&(y.boundingSphere!==void 0?(y.boundingSphere===null&&y.computeBoundingSphere(),Bt.copy(y.boundingSphere.center)):(lt.boundingSphere===null&&lt.computeBoundingSphere(),Bt.copy(lt.boundingSphere.center)),Bt.applyMatrix4(y.matrixWorld).applyMatrix4(bt)),Array.isArray(pt)){const mt=lt.groups;for(let Rt=0,It=mt.length;Rt<It;Rt++){const gt=mt[Rt],Xt=pt[gt.materialIndex];Xt&&Xt.visible&&m.push(y,lt,Xt,B,Bt.z,gt)}}else pt.visible&&m.push(y,lt,pt,B,Bt.z,null)}}const Q=y.children;for(let lt=0,pt=Q.length;lt<pt;lt++)tr(Q[lt],D,B,z)}function Xa(y,D,B,z){const U=y.opaque,Q=y.transmissive,lt=y.transparent;u.setupLightsView(B),tt===!0&&J.setGlobalState(v.clippingPlanes,B),z&&Et.viewport(C.copy(z)),U.length>0&&ns(U,D,B),Q.length>0&&ns(Q,D,B),lt.length>0&&ns(lt,D,B),Et.buffers.depth.setTest(!0),Et.buffers.depth.setMask(!0),Et.buffers.color.setMask(!0),Et.setPolygonOffset(!1)}function qa(y,D,B,z){if((B.isScene===!0?B.overrideMaterial:null)!==null)return;u.state.transmissionRenderTarget[z.id]===void 0&&(u.state.transmissionRenderTarget[z.id]=new Mn(1,1,{generateMipmaps:!0,type:kt.has("EXT_color_buffer_half_float")||kt.has("EXT_color_buffer_float")?es:xn,minFilter:Kn,samples:4,stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:Wt.workingColorSpace}));const Q=u.state.transmissionRenderTarget[z.id],lt=z.viewport||C;Q.setSize(lt.z,lt.w);const pt=v.getRenderTarget();v.setRenderTarget(Q),v.getClearColor(W),X=v.getClearAlpha(),X<1&&v.setClearColor(16777215,.5),v.clear(),Vt&&wt.render(B);const mt=v.toneMapping;v.toneMapping=In;const Rt=z.viewport;if(z.viewport!==void 0&&(z.viewport=void 0),u.setupLightsView(z),tt===!0&&J.setGlobalState(v.clippingPlanes,z),ns(y,B,z),b.updateMultisampleRenderTarget(Q),b.updateRenderTargetMipmap(Q),kt.has("WEBGL_multisampled_render_to_texture")===!1){let It=!1;for(let gt=0,Xt=D.length;gt<Xt;gt++){const ne=D[gt],re=ne.object,De=ne.geometry,qt=ne.material,xt=ne.group;if(qt.side===he&&re.layers.test(z.layers)){const ln=qt.side;qt.side=ye,qt.needsUpdate=!0,Ya(re,B,z,De,qt,xt),qt.side=ln,qt.needsUpdate=!0,It=!0}}It===!0&&(b.updateMultisampleRenderTarget(Q),b.updateRenderTargetMipmap(Q))}v.setRenderTarget(pt),v.setClearColor(W,X),Rt!==void 0&&(z.viewport=Rt),v.toneMapping=mt}function ns(y,D,B){const z=D.isScene===!0?D.overrideMaterial:null;for(let U=0,Q=y.length;U<Q;U++){const lt=y[U],pt=lt.object,mt=lt.geometry,Rt=z===null?lt.material:z,It=lt.group;pt.layers.test(B.layers)&&Ya(pt,D,B,mt,Rt,It)}}function Ya(y,D,B,z,U,Q){y.onBeforeRender(v,D,B,z,U,Q),y.modelViewMatrix.multiplyMatrices(B.matrixWorldInverse,y.matrixWorld),y.normalMatrix.getNormalMatrix(y.modelViewMatrix),U.onBeforeRender(v,D,B,z,y,Q),U.transparent===!0&&U.side===he&&U.forceSinglePass===!1?(U.side=ye,U.needsUpdate=!0,v.renderBufferDirect(B,D,z,U,y,Q),U.side=Dn,U.needsUpdate=!0,v.renderBufferDirect(B,D,z,U,y,Q),U.side=he):v.renderBufferDirect(B,D,z,U,y,Q),y.onAfterRender(v,D,B,z,U,Q)}function is(y,D,B){D.isScene!==!0&&(D=ue);const z=yt.get(y),U=u.state.lights,Q=u.state.shadowsArray,lt=U.state.version,pt=vt.getParameters(y,U.state,Q,D,B),mt=vt.getProgramCacheKey(pt);let Rt=z.programs;z.environment=y.isMeshStandardMaterial?D.environment:null,z.fog=D.fog,z.envMap=(y.isMeshStandardMaterial?F:x).get(y.envMap||z.environment),z.envMapRotation=z.environment!==null&&y.envMap===null?D.environmentRotation:y.envMapRotation,Rt===void 0&&(y.addEventListener("dispose",Lt),Rt=new Map,z.programs=Rt);let It=Rt.get(mt);if(It!==void 0){if(z.currentProgram===It&&z.lightsStateVersion===lt)return Ka(y,pt),It}else pt.uniforms=vt.getUniforms(y),y.onBeforeCompile(pt,v),It=vt.acquireProgram(pt,mt),Rt.set(mt,It),z.uniforms=pt.uniforms;const gt=z.uniforms;return(!y.isShaderMaterial&&!y.isRawShaderMaterial||y.clipping===!0)&&(gt.clippingPlanes=J.uniform),Ka(y,pt),z.needsLights=nc(y),z.lightsStateVersion=lt,z.needsLights&&(gt.ambientLightColor.value=U.state.ambient,gt.lightProbe.value=U.state.probe,gt.directionalLights.value=U.state.directional,gt.directionalLightShadows.value=U.state.directionalShadow,gt.spotLights.value=U.state.spot,gt.spotLightShadows.value=U.state.spotShadow,gt.rectAreaLights.value=U.state.rectArea,gt.ltc_1.value=U.state.rectAreaLTC1,gt.ltc_2.value=U.state.rectAreaLTC2,gt.pointLights.value=U.state.point,gt.pointLightShadows.value=U.state.pointShadow,gt.hemisphereLights.value=U.state.hemi,gt.directionalShadowMap.value=U.state.directionalShadowMap,gt.directionalShadowMatrix.value=U.state.directionalShadowMatrix,gt.spotShadowMap.value=U.state.spotShadowMap,gt.spotLightMatrix.value=U.state.spotLightMatrix,gt.spotLightMap.value=U.state.spotLightMap,gt.pointShadowMap.value=U.state.pointShadowMap,gt.pointShadowMatrix.value=U.state.pointShadowMatrix),z.currentProgram=It,z.uniformsList=null,It}function $a(y){if(y.uniformsList===null){const D=y.currentProgram.getUniforms();y.uniformsList=zs.seqWithValue(D.seq,y.uniforms)}return y.uniformsList}function Ka(y,D){const B=yt.get(y);B.outputColorSpace=D.outputColorSpace,B.batching=D.batching,B.batchingColor=D.batchingColor,B.instancing=D.instancing,B.instancingColor=D.instancingColor,B.instancingMorph=D.instancingMorph,B.skinning=D.skinning,B.morphTargets=D.morphTargets,B.morphNormals=D.morphNormals,B.morphColors=D.morphColors,B.morphTargetsCount=D.morphTargetsCount,B.numClippingPlanes=D.numClippingPlanes,B.numIntersection=D.numClipIntersection,B.vertexAlphas=D.vertexAlphas,B.vertexTangents=D.vertexTangents,B.toneMapping=D.toneMapping}function tc(y,D,B,z,U){D.isScene!==!0&&(D=ue),b.resetTextureUnits();const Q=D.fog,lt=z.isMeshStandardMaterial?D.environment:null,pt=L===null?v.outputColorSpace:L.isXRRenderTarget===!0?L.texture.colorSpace:Pi,mt=(z.isMeshStandardMaterial?F:x).get(z.envMap||lt),Rt=z.vertexColors===!0&&!!B.attributes.color&&B.attributes.color.itemSize===4,It=!!B.attributes.tangent&&(!!z.normalMap||z.anisotropy>0),gt=!!B.morphAttributes.position,Xt=!!B.morphAttributes.normal,ne=!!B.morphAttributes.color;let re=In;z.toneMapped&&(L===null||L.isXRRenderTarget===!0)&&(re=v.toneMapping);const De=B.morphAttributes.position||B.morphAttributes.normal||B.morphAttributes.color,qt=De!==void 0?De.length:0,xt=yt.get(z),ln=u.state.lights;if(tt===!0&&(_t===!0||y!==M)){const We=y===M&&z.id===E;J.setState(z,y,We)}let Yt=!1;z.version===xt.__version?(xt.needsLights&&xt.lightsStateVersion!==ln.state.version||xt.outputColorSpace!==pt||U.isBatchedMesh&&xt.batching===!1||!U.isBatchedMesh&&xt.batching===!0||U.isBatchedMesh&&xt.batchingColor===!0&&U.colorTexture===null||U.isBatchedMesh&&xt.batchingColor===!1&&U.colorTexture!==null||U.isInstancedMesh&&xt.instancing===!1||!U.isInstancedMesh&&xt.instancing===!0||U.isSkinnedMesh&&xt.skinning===!1||!U.isSkinnedMesh&&xt.skinning===!0||U.isInstancedMesh&&xt.instancingColor===!0&&U.instanceColor===null||U.isInstancedMesh&&xt.instancingColor===!1&&U.instanceColor!==null||U.isInstancedMesh&&xt.instancingMorph===!0&&U.morphTexture===null||U.isInstancedMesh&&xt.instancingMorph===!1&&U.morphTexture!==null||xt.envMap!==mt||z.fog===!0&&xt.fog!==Q||xt.numClippingPlanes!==void 0&&(xt.numClippingPlanes!==J.numPlanes||xt.numIntersection!==J.numIntersection)||xt.vertexAlphas!==Rt||xt.vertexTangents!==It||xt.morphTargets!==gt||xt.morphNormals!==Xt||xt.morphColors!==ne||xt.toneMapping!==re||xt.morphTargetsCount!==qt)&&(Yt=!0):(Yt=!0,xt.__version=z.version);let $e=xt.currentProgram;Yt===!0&&($e=is(z,D,U));let ti=!1,ke=!1,Ui=!1;const ae=$e.getUniforms(),nn=xt.uniforms;if(Et.useProgram($e.program)&&(ti=!0,ke=!0,Ui=!0),z.id!==E&&(E=z.id,ke=!0),ti||M!==y){Et.buffers.depth.getReversed()?(rt.copy(y.projectionMatrix),oh(rt),lh(rt),ae.setValue(N,"projectionMatrix",rt)):ae.setValue(N,"projectionMatrix",y.projectionMatrix),ae.setValue(N,"viewMatrix",y.matrixWorldInverse);const yn=ae.map.cameraPosition;yn!==void 0&&yn.setValue(N,Pt.setFromMatrixPosition(y.matrixWorld)),zt.logarithmicDepthBuffer&&ae.setValue(N,"logDepthBufFC",2/(Math.log(y.far+1)/Math.LN2)),(z.isMeshPhongMaterial||z.isMeshToonMaterial||z.isMeshLambertMaterial||z.isMeshBasicMaterial||z.isMeshStandardMaterial||z.isShaderMaterial)&&ae.setValue(N,"isOrthographic",y.isOrthographicCamera===!0),M!==y&&(M=y,ke=!0,Ui=!0)}if(U.isSkinnedMesh){ae.setOptional(N,U,"bindMatrix"),ae.setOptional(N,U,"bindMatrixInverse");const We=U.skeleton;We&&(We.boneTexture===null&&We.computeBoneTexture(),ae.setValue(N,"boneTexture",We.boneTexture,b))}U.isBatchedMesh&&(ae.setOptional(N,U,"batchingTexture"),ae.setValue(N,"batchingTexture",U._matricesTexture,b),ae.setOptional(N,U,"batchingIdTexture"),ae.setValue(N,"batchingIdTexture",U._indirectTexture,b),ae.setOptional(N,U,"batchingColorTexture"),U._colorsTexture!==null&&ae.setValue(N,"batchingColorTexture",U._colorsTexture,b));const Ni=B.morphAttributes;if((Ni.position!==void 0||Ni.normal!==void 0||Ni.color!==void 0)&&At.update(U,B,$e),(ke||xt.receiveShadow!==U.receiveShadow)&&(xt.receiveShadow=U.receiveShadow,ae.setValue(N,"receiveShadow",U.receiveShadow)),z.isMeshGouraudMaterial&&z.envMap!==null&&(nn.envMap.value=mt,nn.flipEnvMap.value=mt.isCubeTexture&&mt.isRenderTargetTexture===!1?-1:1),z.isMeshStandardMaterial&&z.envMap===null&&D.environment!==null&&(nn.envMapIntensity.value=D.environmentIntensity),ke&&(ae.setValue(N,"toneMappingExposure",v.toneMappingExposure),xt.needsLights&&ec(nn,Ui),Q&&z.fog===!0&&at.refreshFogUniforms(nn,Q),at.refreshMaterialUniforms(nn,z,V,j,u.state.transmissionRenderTarget[y.id]),zs.upload(N,$a(xt),nn,b)),z.isShaderMaterial&&z.uniformsNeedUpdate===!0&&(zs.upload(N,$a(xt),nn,b),z.uniformsNeedUpdate=!1),z.isSpriteMaterial&&ae.setValue(N,"center",U.center),ae.setValue(N,"modelViewMatrix",U.modelViewMatrix),ae.setValue(N,"normalMatrix",U.normalMatrix),ae.setValue(N,"modelMatrix",U.matrixWorld),z.isShaderMaterial||z.isRawShaderMaterial){const We=z.uniformsGroups;for(let yn=0,Sn=We.length;yn<Sn;yn++){const ja=We[yn];I.update(ja,$e),I.bind(ja,$e)}}return $e}function ec(y,D){y.ambientLightColor.needsUpdate=D,y.lightProbe.needsUpdate=D,y.directionalLights.needsUpdate=D,y.directionalLightShadows.needsUpdate=D,y.pointLights.needsUpdate=D,y.pointLightShadows.needsUpdate=D,y.spotLights.needsUpdate=D,y.spotLightShadows.needsUpdate=D,y.rectAreaLights.needsUpdate=D,y.hemisphereLights.needsUpdate=D}function nc(y){return y.isMeshLambertMaterial||y.isMeshToonMaterial||y.isMeshPhongMaterial||y.isMeshStandardMaterial||y.isShadowMaterial||y.isShaderMaterial&&y.lights===!0}this.getActiveCubeFace=function(){return T},this.getActiveMipmapLevel=function(){return A},this.getRenderTarget=function(){return L},this.setRenderTargetTextures=function(y,D,B){yt.get(y.texture).__webglTexture=D,yt.get(y.depthTexture).__webglTexture=B;const z=yt.get(y);z.__hasExternalTextures=!0,z.__autoAllocateDepthBuffer=B===void 0,z.__autoAllocateDepthBuffer||kt.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),z.__useRenderToTexture=!1)},this.setRenderTargetFramebuffer=function(y,D){const B=yt.get(y);B.__webglFramebuffer=D,B.__useDefaultFramebuffer=D===void 0},this.setRenderTarget=function(y,D=0,B=0){L=y,T=D,A=B;let z=!0,U=null,Q=!1,lt=!1;if(y){const mt=yt.get(y);if(mt.__useDefaultFramebuffer!==void 0)Et.bindFramebuffer(N.FRAMEBUFFER,null),z=!1;else if(mt.__webglFramebuffer===void 0)b.setupRenderTarget(y);else if(mt.__hasExternalTextures)b.rebindTextures(y,yt.get(y.texture).__webglTexture,yt.get(y.depthTexture).__webglTexture);else if(y.depthBuffer){const gt=y.depthTexture;if(mt.__boundDepthTexture!==gt){if(gt!==null&&yt.has(gt)&&(y.width!==gt.image.width||y.height!==gt.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");b.setupDepthRenderbuffer(y)}}const Rt=y.texture;(Rt.isData3DTexture||Rt.isDataArrayTexture||Rt.isCompressedArrayTexture)&&(lt=!0);const It=yt.get(y).__webglFramebuffer;y.isWebGLCubeRenderTarget?(Array.isArray(It[D])?U=It[D][B]:U=It[D],Q=!0):y.samples>0&&b.useMultisampledRTT(y)===!1?U=yt.get(y).__webglMultisampledFramebuffer:Array.isArray(It)?U=It[B]:U=It,C.copy(y.viewport),k.copy(y.scissor),O=y.scissorTest}else C.copy(Mt).multiplyScalar(V).floor(),k.copy(Ot).multiplyScalar(V).floor(),O=te;if(Et.bindFramebuffer(N.FRAMEBUFFER,U)&&z&&Et.drawBuffers(y,U),Et.viewport(C),Et.scissor(k),Et.setScissorTest(O),Q){const mt=yt.get(y.texture);N.framebufferTexture2D(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0,N.TEXTURE_CUBE_MAP_POSITIVE_X+D,mt.__webglTexture,B)}else if(lt){const mt=yt.get(y.texture),Rt=D||0;N.framebufferTextureLayer(N.FRAMEBUFFER,N.COLOR_ATTACHMENT0,mt.__webglTexture,B||0,Rt)}E=-1},this.readRenderTargetPixels=function(y,D,B,z,U,Q,lt){if(!(y&&y.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let pt=yt.get(y).__webglFramebuffer;if(y.isWebGLCubeRenderTarget&&lt!==void 0&&(pt=pt[lt]),pt){Et.bindFramebuffer(N.FRAMEBUFFER,pt);try{const mt=y.texture,Rt=mt.format,It=mt.type;if(!zt.textureFormatReadable(Rt)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!zt.textureTypeReadable(It)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}D>=0&&D<=y.width-z&&B>=0&&B<=y.height-U&&N.readPixels(D,B,z,U,Ut.convert(Rt),Ut.convert(It),Q)}finally{const mt=L!==null?yt.get(L).__webglFramebuffer:null;Et.bindFramebuffer(N.FRAMEBUFFER,mt)}}},this.readRenderTargetPixelsAsync=async function(y,D,B,z,U,Q,lt){if(!(y&&y.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let pt=yt.get(y).__webglFramebuffer;if(y.isWebGLCubeRenderTarget&&lt!==void 0&&(pt=pt[lt]),pt){const mt=y.texture,Rt=mt.format,It=mt.type;if(!zt.textureFormatReadable(Rt))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!zt.textureTypeReadable(It))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");if(D>=0&&D<=y.width-z&&B>=0&&B<=y.height-U){Et.bindFramebuffer(N.FRAMEBUFFER,pt);const gt=N.createBuffer();N.bindBuffer(N.PIXEL_PACK_BUFFER,gt),N.bufferData(N.PIXEL_PACK_BUFFER,Q.byteLength,N.STREAM_READ),N.readPixels(D,B,z,U,Ut.convert(Rt),Ut.convert(It),0);const Xt=L!==null?yt.get(L).__webglFramebuffer:null;Et.bindFramebuffer(N.FRAMEBUFFER,Xt);const ne=N.fenceSync(N.SYNC_GPU_COMMANDS_COMPLETE,0);return N.flush(),await ah(N,ne,4),N.bindBuffer(N.PIXEL_PACK_BUFFER,gt),N.getBufferSubData(N.PIXEL_PACK_BUFFER,0,Q),N.deleteBuffer(gt),N.deleteSync(ne),Q}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")}},this.copyFramebufferToTexture=function(y,D=null,B=0){y.isTexture!==!0&&($i("WebGLRenderer: copyFramebufferToTexture function signature has changed."),D=arguments[0]||null,y=arguments[1]);const z=Math.pow(2,-B),U=Math.floor(y.image.width*z),Q=Math.floor(y.image.height*z),lt=D!==null?D.x:0,pt=D!==null?D.y:0;b.setTexture2D(y,0),N.copyTexSubImage2D(N.TEXTURE_2D,B,0,0,lt,pt,U,Q),Et.unbindTexture()},this.copyTextureToTexture=function(y,D,B=null,z=null,U=0){y.isTexture!==!0&&($i("WebGLRenderer: copyTextureToTexture function signature has changed."),z=arguments[0]||null,y=arguments[1],D=arguments[2],U=arguments[3]||0,B=null);let Q,lt,pt,mt,Rt,It,gt,Xt,ne;const re=y.isCompressedTexture?y.mipmaps[U]:y.image;B!==null?(Q=B.max.x-B.min.x,lt=B.max.y-B.min.y,pt=B.isBox3?B.max.z-B.min.z:1,mt=B.min.x,Rt=B.min.y,It=B.isBox3?B.min.z:0):(Q=re.width,lt=re.height,pt=re.depth||1,mt=0,Rt=0,It=0),z!==null?(gt=z.x,Xt=z.y,ne=z.z):(gt=0,Xt=0,ne=0);const De=Ut.convert(D.format),qt=Ut.convert(D.type);let xt;D.isData3DTexture?(b.setTexture3D(D,0),xt=N.TEXTURE_3D):D.isDataArrayTexture||D.isCompressedArrayTexture?(b.setTexture2DArray(D,0),xt=N.TEXTURE_2D_ARRAY):(b.setTexture2D(D,0),xt=N.TEXTURE_2D),N.pixelStorei(N.UNPACK_FLIP_Y_WEBGL,D.flipY),N.pixelStorei(N.UNPACK_PREMULTIPLY_ALPHA_WEBGL,D.premultiplyAlpha),N.pixelStorei(N.UNPACK_ALIGNMENT,D.unpackAlignment);const ln=N.getParameter(N.UNPACK_ROW_LENGTH),Yt=N.getParameter(N.UNPACK_IMAGE_HEIGHT),$e=N.getParameter(N.UNPACK_SKIP_PIXELS),ti=N.getParameter(N.UNPACK_SKIP_ROWS),ke=N.getParameter(N.UNPACK_SKIP_IMAGES);N.pixelStorei(N.UNPACK_ROW_LENGTH,re.width),N.pixelStorei(N.UNPACK_IMAGE_HEIGHT,re.height),N.pixelStorei(N.UNPACK_SKIP_PIXELS,mt),N.pixelStorei(N.UNPACK_SKIP_ROWS,Rt),N.pixelStorei(N.UNPACK_SKIP_IMAGES,It);const Ui=y.isDataArrayTexture||y.isData3DTexture,ae=D.isDataArrayTexture||D.isData3DTexture;if(y.isRenderTargetTexture||y.isDepthTexture){const nn=yt.get(y),Ni=yt.get(D),We=yt.get(nn.__renderTarget),yn=yt.get(Ni.__renderTarget);Et.bindFramebuffer(N.READ_FRAMEBUFFER,We.__webglFramebuffer),Et.bindFramebuffer(N.DRAW_FRAMEBUFFER,yn.__webglFramebuffer);for(let Sn=0;Sn<pt;Sn++)Ui&&N.framebufferTextureLayer(N.READ_FRAMEBUFFER,N.COLOR_ATTACHMENT0,yt.get(y).__webglTexture,U,It+Sn),y.isDepthTexture?(ae&&N.framebufferTextureLayer(N.DRAW_FRAMEBUFFER,N.COLOR_ATTACHMENT0,yt.get(D).__webglTexture,U,ne+Sn),N.blitFramebuffer(mt,Rt,Q,lt,gt,Xt,Q,lt,N.DEPTH_BUFFER_BIT,N.NEAREST)):ae?N.copyTexSubImage3D(xt,U,gt,Xt,ne+Sn,mt,Rt,Q,lt):N.copyTexSubImage2D(xt,U,gt,Xt,ne+Sn,mt,Rt,Q,lt);Et.bindFramebuffer(N.READ_FRAMEBUFFER,null),Et.bindFramebuffer(N.DRAW_FRAMEBUFFER,null)}else ae?y.isDataTexture||y.isData3DTexture?N.texSubImage3D(xt,U,gt,Xt,ne,Q,lt,pt,De,qt,re.data):D.isCompressedArrayTexture?N.compressedTexSubImage3D(xt,U,gt,Xt,ne,Q,lt,pt,De,re.data):N.texSubImage3D(xt,U,gt,Xt,ne,Q,lt,pt,De,qt,re):y.isDataTexture?N.texSubImage2D(N.TEXTURE_2D,U,gt,Xt,Q,lt,De,qt,re.data):y.isCompressedTexture?N.compressedTexSubImage2D(N.TEXTURE_2D,U,gt,Xt,re.width,re.height,De,re.data):N.texSubImage2D(N.TEXTURE_2D,U,gt,Xt,Q,lt,De,qt,re);N.pixelStorei(N.UNPACK_ROW_LENGTH,ln),N.pixelStorei(N.UNPACK_IMAGE_HEIGHT,Yt),N.pixelStorei(N.UNPACK_SKIP_PIXELS,$e),N.pixelStorei(N.UNPACK_SKIP_ROWS,ti),N.pixelStorei(N.UNPACK_SKIP_IMAGES,ke),U===0&&D.generateMipmaps&&N.generateMipmap(xt),Et.unbindTexture()},this.copyTextureToTexture3D=function(y,D,B=null,z=null,U=0){return y.isTexture!==!0&&($i("WebGLRenderer: copyTextureToTexture3D function signature has changed."),B=arguments[0]||null,z=arguments[1]||null,y=arguments[2],D=arguments[3],U=arguments[4]||0),$i('WebGLRenderer: copyTextureToTexture3D function has been deprecated. Use "copyTextureToTexture" instead.'),this.copyTextureToTexture(y,D,B,z,U)},this.initRenderTarget=function(y){yt.get(y).__webglFramebuffer===void 0&&b.setupRenderTarget(y)},this.initTexture=function(y){y.isCubeTexture?b.setTextureCube(y,0):y.isData3DTexture?b.setTexture3D(y,0):y.isDataArrayTexture||y.isCompressedArrayTexture?b.setTexture2DArray(y,0):b.setTexture2D(y,0),Et.unbindTexture()},this.resetState=function(){T=0,A=0,L=null,Et.reset(),ee.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return gn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(t){this._outputColorSpace=t;const e=this.getContext();e.drawingBufferColorspace=Wt._getDrawingBufferColorSpace(t),e.unpackColorSpace=Wt._getUnpackColorSpace()}}class Ba{constructor(t,e=25e-5){this.isFogExp2=!0,this.name="",this.color=new Ft(t),this.density=e}clone(){return new Ba(this.color,this.density)}toJSON(){return{type:"FogExp2",name:this.name,color:this.color.getHex(),density:this.density}}}class xm extends jt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Be,this.environmentIntensity=1,this.environmentRotation=new Be,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(t,e){return super.copy(t,e),t.background!==null&&(this.background=t.background.clone()),t.environment!==null&&(this.environment=t.environment.clone()),t.fog!==null&&(this.fog=t.fog.clone()),this.backgroundBlurriness=t.backgroundBlurriness,this.backgroundIntensity=t.backgroundIntensity,this.backgroundRotation.copy(t.backgroundRotation),this.environmentIntensity=t.environmentIntensity,this.environmentRotation.copy(t.environmentRotation),t.overrideMaterial!==null&&(this.overrideMaterial=t.overrideMaterial.clone()),this.matrixAutoUpdate=t.matrixAutoUpdate,this}toJSON(t){const e=super.toJSON(t);return this.fog!==null&&(e.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(e.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(e.object.backgroundIntensity=this.backgroundIntensity),e.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(e.object.environmentIntensity=this.environmentIntensity),e.object.environmentRotation=this.environmentRotation.toArray(),e}}class Mm{constructor(t,e){this.isInterleavedBuffer=!0,this.array=t,this.stride=e,this.count=t!==void 0?t.length/e:0,this.usage=ya,this.updateRanges=[],this.version=0,this.uuid=_n()}onUploadCallback(){}set needsUpdate(t){t===!0&&this.version++}setUsage(t){return this.usage=t,this}addUpdateRange(t,e){this.updateRanges.push({start:t,count:e})}clearUpdateRanges(){this.updateRanges.length=0}copy(t){return this.array=new t.array.constructor(t.array),this.count=t.count,this.stride=t.stride,this.usage=t.usage,this}copyAt(t,e,n){t*=this.stride,n*=e.stride;for(let i=0,r=this.stride;i<r;i++)this.array[t+i]=e.array[n+i];return this}set(t,e=0){return this.array.set(t,e),this}clone(t){t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=_n()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);const e=new this.array.constructor(t.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(e,this.stride);return n.setUsage(this.usage),n}onUpload(t){return this.onUploadCallback=t,this}toJSON(t){return t.arrayBuffers===void 0&&(t.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=_n()),t.arrayBuffers[this.array.buffer._uuid]===void 0&&(t.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}}const Re=new R;class Gs{constructor(t,e,n,i=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=t,this.itemSize=e,this.offset=n,this.normalized=i}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(t){this.data.needsUpdate=t}applyMatrix4(t){for(let e=0,n=this.data.count;e<n;e++)Re.fromBufferAttribute(this,e),Re.applyMatrix4(t),this.setXYZ(e,Re.x,Re.y,Re.z);return this}applyNormalMatrix(t){for(let e=0,n=this.count;e<n;e++)Re.fromBufferAttribute(this,e),Re.applyNormalMatrix(t),this.setXYZ(e,Re.x,Re.y,Re.z);return this}transformDirection(t){for(let e=0,n=this.count;e<n;e++)Re.fromBufferAttribute(this,e),Re.transformDirection(t),this.setXYZ(e,Re.x,Re.y,Re.z);return this}getComponent(t,e){let n=this.array[t*this.data.stride+this.offset+e];return this.normalized&&(n=Qe(n,this.array)),n}setComponent(t,e,n){return this.normalized&&(n=Kt(n,this.array)),this.data.array[t*this.data.stride+this.offset+e]=n,this}setX(t,e){return this.normalized&&(e=Kt(e,this.array)),this.data.array[t*this.data.stride+this.offset]=e,this}setY(t,e){return this.normalized&&(e=Kt(e,this.array)),this.data.array[t*this.data.stride+this.offset+1]=e,this}setZ(t,e){return this.normalized&&(e=Kt(e,this.array)),this.data.array[t*this.data.stride+this.offset+2]=e,this}setW(t,e){return this.normalized&&(e=Kt(e,this.array)),this.data.array[t*this.data.stride+this.offset+3]=e,this}getX(t){let e=this.data.array[t*this.data.stride+this.offset];return this.normalized&&(e=Qe(e,this.array)),e}getY(t){let e=this.data.array[t*this.data.stride+this.offset+1];return this.normalized&&(e=Qe(e,this.array)),e}getZ(t){let e=this.data.array[t*this.data.stride+this.offset+2];return this.normalized&&(e=Qe(e,this.array)),e}getW(t){let e=this.data.array[t*this.data.stride+this.offset+3];return this.normalized&&(e=Qe(e,this.array)),e}setXY(t,e,n){return t=t*this.data.stride+this.offset,this.normalized&&(e=Kt(e,this.array),n=Kt(n,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this}setXYZ(t,e,n,i){return t=t*this.data.stride+this.offset,this.normalized&&(e=Kt(e,this.array),n=Kt(n,this.array),i=Kt(i,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this.data.array[t+2]=i,this}setXYZW(t,e,n,i,r){return t=t*this.data.stride+this.offset,this.normalized&&(e=Kt(e,this.array),n=Kt(n,this.array),i=Kt(i,this.array),r=Kt(r,this.array)),this.data.array[t+0]=e,this.data.array[t+1]=n,this.data.array[t+2]=i,this.data.array[t+3]=r,this}clone(t){if(t===void 0){console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let n=0;n<this.count;n++){const i=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)e.push(this.data.array[i+r])}return new Ie(new this.array.constructor(e),this.itemSize,this.normalized)}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.clone(t)),new Gs(t.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(t){if(t===void 0){console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");const e=[];for(let n=0;n<this.count;n++){const i=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)e.push(this.data.array[i+r])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:e,normalized:this.normalized}}else return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.toJSON(t)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}}class ka extends Fn{static get type(){return"SpriteMaterial"}constructor(t){super(),this.isSpriteMaterial=!0,this.color=new Ft(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.rotation=t.rotation,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}}let mi;const zi=new R,gi=new R,_i=new R,vi=new Ct,Hi=new Ct,$l=new Zt,bs=new R,Vi=new R,Ts=new R,jo=new Ct,Cr=new Ct,Zo=new Ct;class Kl extends jt{constructor(t=new ka){if(super(),this.isSprite=!0,this.type="Sprite",mi===void 0){mi=new _e;const e=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),n=new Mm(e,5);mi.setIndex([0,1,2,0,2,3]),mi.setAttribute("position",new Gs(n,3,0,!1)),mi.setAttribute("uv",new Gs(n,2,3,!1))}this.geometry=mi,this.material=t,this.center=new Ct(.5,.5)}raycast(t,e){t.camera===null&&console.error('THREE.Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),gi.setFromMatrixScale(this.matrixWorld),$l.copy(t.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(t.camera.matrixWorldInverse,this.matrixWorld),_i.setFromMatrixPosition(this.modelViewMatrix),t.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&gi.multiplyScalar(-_i.z);const n=this.material.rotation;let i,r;n!==0&&(r=Math.cos(n),i=Math.sin(n));const a=this.center;As(bs.set(-.5,-.5,0),_i,a,gi,i,r),As(Vi.set(.5,-.5,0),_i,a,gi,i,r),As(Ts.set(.5,.5,0),_i,a,gi,i,r),jo.set(0,0),Cr.set(1,0),Zo.set(1,1);let o=t.ray.intersectTriangle(bs,Vi,Ts,!1,zi);if(o===null&&(As(Vi.set(-.5,.5,0),_i,a,gi,i,r),Cr.set(0,1),o=t.ray.intersectTriangle(bs,Ts,Vi,!1,zi),o===null))return;const l=t.ray.origin.distanceTo(zi);l<t.near||l>t.far||e.push({distance:l,point:zi.clone(),uv:qe.getInterpolation(zi,bs,Vi,Ts,jo,Cr,Zo,new Ct),face:null,object:this})}copy(t,e){return super.copy(t,e),t.center!==void 0&&this.center.copy(t.center),this.material=t.material,this}}function As(s,t,e,n,i,r){vi.subVectors(s,e).addScalar(.5).multiply(n),i!==void 0?(Hi.x=r*vi.x-i*vi.y,Hi.y=i*vi.x+r*vi.y):Hi.copy(vi),s.copy(t),s.x+=Hi.x,s.y+=Hi.y,s.applyMatrix4($l)}class ym extends Ae{constructor(t=null,e=1,n=1,i,r,a,o,l,c=Ve,h=Ve,d,f){super(null,a,o,l,c,h,i,r,d,f),this.isDataTexture=!0,this.image={data:t,width:e,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Jo extends Ie{constructor(t,e,n,i=1){super(t,e,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=i}copy(t){return super.copy(t),this.meshPerAttribute=t.meshPerAttribute,this}toJSON(){const t=super.toJSON();return t.meshPerAttribute=this.meshPerAttribute,t.isInstancedBufferAttribute=!0,t}}const xi=new Zt,Qo=new Zt,Rs=[],tl=new Jn,Sm=new Zt,Gi=new it,Wi=new Qn;class Ue extends it{constructor(t,e,n){super(t,e),this.isInstancedMesh=!0,this.instanceMatrix=new Jo(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let i=0;i<n;i++)this.setMatrixAt(i,Sm)}computeBoundingBox(){const t=this.geometry,e=this.count;this.boundingBox===null&&(this.boundingBox=new Jn),t.boundingBox===null&&t.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,xi),tl.copy(t.boundingBox).applyMatrix4(xi),this.boundingBox.union(tl)}computeBoundingSphere(){const t=this.geometry,e=this.count;this.boundingSphere===null&&(this.boundingSphere=new Qn),t.boundingSphere===null&&t.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<e;n++)this.getMatrixAt(n,xi),Wi.copy(t.boundingSphere).applyMatrix4(xi),this.boundingSphere.union(Wi)}copy(t,e){return super.copy(t,e),this.instanceMatrix.copy(t.instanceMatrix),t.morphTexture!==null&&(this.morphTexture=t.morphTexture.clone()),t.instanceColor!==null&&(this.instanceColor=t.instanceColor.clone()),this.count=t.count,t.boundingBox!==null&&(this.boundingBox=t.boundingBox.clone()),t.boundingSphere!==null&&(this.boundingSphere=t.boundingSphere.clone()),this}getColorAt(t,e){e.fromArray(this.instanceColor.array,t*3)}getMatrixAt(t,e){e.fromArray(this.instanceMatrix.array,t*16)}getMorphAt(t,e){const n=e.morphTargetInfluences,i=this.morphTexture.source.data.data,r=n.length+1,a=t*r+1;for(let o=0;o<n.length;o++)n[o]=i[a+o]}raycast(t,e){const n=this.matrixWorld,i=this.count;if(Gi.geometry=this.geometry,Gi.material=this.material,Gi.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),Wi.copy(this.boundingSphere),Wi.applyMatrix4(n),t.ray.intersectsSphere(Wi)!==!1))for(let r=0;r<i;r++){this.getMatrixAt(r,xi),Qo.multiplyMatrices(n,xi),Gi.matrixWorld=Qo,Gi.raycast(t,Rs);for(let a=0,o=Rs.length;a<o;a++){const l=Rs[a];l.instanceId=r,l.object=this,e.push(l)}Rs.length=0}}setColorAt(t,e){this.instanceColor===null&&(this.instanceColor=new Jo(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),e.toArray(this.instanceColor.array,t*3)}setMatrixAt(t,e){e.toArray(this.instanceMatrix.array,t*16)}setMorphAt(t,e){const n=e.morphTargetInfluences,i=n.length+1;this.morphTexture===null&&(this.morphTexture=new ym(new Float32Array(i*this.count),i,this.count,Pa,an));const r=this.morphTexture.source.data.data;let a=0;for(let c=0;c<n.length;c++)a+=n[c];const o=this.geometry.morphTargetsRelative?1:1-a,l=i*t;r[l]=o,r.set(n,l+1)}updateMorphTargets(){}dispose(){return this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null),this}}class jl extends Fn{static get type(){return"LineBasicMaterial"}constructor(t){super(),this.isLineBasicMaterial=!0,this.color=new Ft(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.linewidth=t.linewidth,this.linecap=t.linecap,this.linejoin=t.linejoin,this.fog=t.fog,this}}const Ws=new R,Xs=new R,el=new Zt,Xi=new Na,Cs=new Qn,Pr=new R,nl=new R;class Em extends jt{constructor(t=new _e,e=new jl){super(),this.isLine=!0,this.type="Line",this.geometry=t,this.material=e,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}computeLineDistances(){const t=this.geometry;if(t.index===null){const e=t.attributes.position,n=[0];for(let i=1,r=e.count;i<r;i++)Ws.fromBufferAttribute(e,i-1),Xs.fromBufferAttribute(e,i),n[i]=n[i-1],n[i]+=Ws.distanceTo(Xs);t.setAttribute("lineDistance",new ie(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(t,e){const n=this.geometry,i=this.matrixWorld,r=t.params.Line.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Cs.copy(n.boundingSphere),Cs.applyMatrix4(i),Cs.radius+=r,t.ray.intersectsSphere(Cs)===!1)return;el.copy(i).invert(),Xi.copy(t.ray).applyMatrix4(el);const o=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,c=this.isLineSegments?2:1,h=n.index,f=n.attributes.position;if(h!==null){const p=Math.max(0,a.start),g=Math.min(h.count,a.start+a.count);for(let _=p,m=g-1;_<m;_+=c){const u=h.getX(_),S=h.getX(_+1),w=Ps(this,t,Xi,l,u,S);w&&e.push(w)}if(this.isLineLoop){const _=h.getX(g-1),m=h.getX(p),u=Ps(this,t,Xi,l,_,m);u&&e.push(u)}}else{const p=Math.max(0,a.start),g=Math.min(f.count,a.start+a.count);for(let _=p,m=g-1;_<m;_+=c){const u=Ps(this,t,Xi,l,_,_+1);u&&e.push(u)}if(this.isLineLoop){const _=Ps(this,t,Xi,l,g-1,p);_&&e.push(_)}}}updateMorphTargets(){const e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){const i=e[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=i.length;r<a;r++){const o=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}}function Ps(s,t,e,n,i,r){const a=s.geometry.attributes.position;if(Ws.fromBufferAttribute(a,i),Xs.fromBufferAttribute(a,r),e.distanceSqToSegment(Ws,Xs,Pr,nl)>n)return;Pr.applyMatrix4(s.matrixWorld);const l=t.ray.origin.distanceTo(Pr);if(!(l<t.near||l>t.far))return{distance:l,point:nl.clone().applyMatrix4(s.matrixWorld),index:i,face:null,faceIndex:null,barycoord:null,object:s}}class qs extends Fn{static get type(){return"PointsMaterial"}constructor(t){super(),this.isPointsMaterial=!0,this.color=new Ft(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.color.copy(t.color),this.map=t.map,this.alphaMap=t.alphaMap,this.size=t.size,this.sizeAttenuation=t.sizeAttenuation,this.fog=t.fog,this}}const il=new Zt,Ea=new Na,Ls=new Qn,Is=new R;class wa extends jt{constructor(t=new _e,e=new qs){super(),this.isPoints=!0,this.type="Points",this.geometry=t,this.material=e,this.updateMorphTargets()}copy(t,e){return super.copy(t,e),this.material=Array.isArray(t.material)?t.material.slice():t.material,this.geometry=t.geometry,this}raycast(t,e){const n=this.geometry,i=this.matrixWorld,r=t.params.Points.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),Ls.copy(n.boundingSphere),Ls.applyMatrix4(i),Ls.radius+=r,t.ray.intersectsSphere(Ls)===!1)return;il.copy(i).invert(),Ea.copy(t.ray).applyMatrix4(il);const o=r/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,c=n.index,d=n.attributes.position;if(c!==null){const f=Math.max(0,a.start),p=Math.min(c.count,a.start+a.count);for(let g=f,_=p;g<_;g++){const m=c.getX(g);Is.fromBufferAttribute(d,m),sl(Is,m,l,i,t,e,this)}}else{const f=Math.max(0,a.start),p=Math.min(d.count,a.start+a.count);for(let g=f,_=p;g<_;g++)Is.fromBufferAttribute(d,g),sl(Is,g,l,i,t,e,this)}}updateMorphTargets(){const e=this.geometry.morphAttributes,n=Object.keys(e);if(n.length>0){const i=e[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,a=i.length;r<a;r++){const o=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=r}}}}}function sl(s,t,e,n,i,r,a){const o=Ea.distanceSqToPoint(s);if(o<e){const l=new R;Ea.closestPointToPoint(s,l),l.applyMatrix4(n);const c=i.ray.origin.distanceTo(l);if(c<i.near||c>i.far)return;r.push({distance:c,distanceToRay:Math.sqrt(o),point:l,index:t,face:null,faceIndex:null,barycoord:null,object:a})}}class za extends Ae{constructor(t,e,n,i,r,a,o,l,c){super(t,e,n,i,r,a,o,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}}class Fe extends _e{constructor(t=1,e=32,n=0,i=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:t,segments:e,thetaStart:n,thetaLength:i},e=Math.max(3,e);const r=[],a=[],o=[],l=[],c=new R,h=new Ct;a.push(0,0,0),o.push(0,0,1),l.push(.5,.5);for(let d=0,f=3;d<=e;d++,f+=3){const p=n+d/e*i;c.x=t*Math.cos(p),c.y=t*Math.sin(p),a.push(c.x,c.y,c.z),o.push(0,0,1),h.x=(a[f]/t+1)/2,h.y=(a[f+1]/t+1)/2,l.push(h.x,h.y)}for(let d=1;d<=e;d++)r.push(d,d+1,0);this.setIndex(r),this.setAttribute("position",new ie(a,3)),this.setAttribute("normal",new ie(o,3)),this.setAttribute("uv",new ie(l,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Fe(t.radius,t.segments,t.thetaStart,t.thetaLength)}}class en extends _e{constructor(t=1,e=1,n=1,i=32,r=1,a=!1,o=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:t,radiusBottom:e,height:n,radialSegments:i,heightSegments:r,openEnded:a,thetaStart:o,thetaLength:l};const c=this;i=Math.floor(i),r=Math.floor(r);const h=[],d=[],f=[],p=[];let g=0;const _=[],m=n/2;let u=0;S(),a===!1&&(t>0&&w(!0),e>0&&w(!1)),this.setIndex(h),this.setAttribute("position",new ie(d,3)),this.setAttribute("normal",new ie(f,3)),this.setAttribute("uv",new ie(p,2));function S(){const v=new R,P=new R;let T=0;const A=(e-t)/n;for(let L=0;L<=r;L++){const E=[],M=L/r,C=M*(e-t)+t;for(let k=0;k<=i;k++){const O=k/i,W=O*l+o,X=Math.sin(W),H=Math.cos(W);P.x=C*X,P.y=-M*n+m,P.z=C*H,d.push(P.x,P.y,P.z),v.set(X,A,H).normalize(),f.push(v.x,v.y,v.z),p.push(O,1-M),E.push(g++)}_.push(E)}for(let L=0;L<i;L++)for(let E=0;E<r;E++){const M=_[E][L],C=_[E+1][L],k=_[E+1][L+1],O=_[E][L+1];(t>0||E!==0)&&(h.push(M,C,O),T+=3),(e>0||E!==r-1)&&(h.push(C,k,O),T+=3)}c.addGroup(u,T,0),u+=T}function w(v){const P=g,T=new Ct,A=new R;let L=0;const E=v===!0?t:e,M=v===!0?1:-1;for(let k=1;k<=i;k++)d.push(0,m*M,0),f.push(0,M,0),p.push(.5,.5),g++;const C=g;for(let k=0;k<=i;k++){const W=k/i*l+o,X=Math.cos(W),H=Math.sin(W);A.x=E*H,A.y=m*M,A.z=E*X,d.push(A.x,A.y,A.z),f.push(0,M,0),T.x=X*.5+.5,T.y=H*.5*M+.5,p.push(T.x,T.y),g++}for(let k=0;k<i;k++){const O=P+k,W=C+k;v===!0?h.push(W,W+1,O):h.push(W+1,W,O),L+=3}c.addGroup(u,L,v===!0?1:2),u+=L}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new en(t.radiusTop,t.radiusBottom,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class Di extends en{constructor(t=1,e=1,n=32,i=1,r=!1,a=0,o=Math.PI*2){super(0,t,e,n,i,r,a,o),this.type="ConeGeometry",this.parameters={radius:t,height:e,radialSegments:n,heightSegments:i,openEnded:r,thetaStart:a,thetaLength:o}}static fromJSON(t){return new Di(t.radius,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}}class Zs extends _e{constructor(t=[],e=[],n=1,i=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:t,indices:e,radius:n,detail:i};const r=[],a=[];o(i),c(n),h(),this.setAttribute("position",new ie(r,3)),this.setAttribute("normal",new ie(r.slice(),3)),this.setAttribute("uv",new ie(a,2)),i===0?this.computeVertexNormals():this.normalizeNormals();function o(S){const w=new R,v=new R,P=new R;for(let T=0;T<e.length;T+=3)p(e[T+0],w),p(e[T+1],v),p(e[T+2],P),l(w,v,P,S)}function l(S,w,v,P){const T=P+1,A=[];for(let L=0;L<=T;L++){A[L]=[];const E=S.clone().lerp(v,L/T),M=w.clone().lerp(v,L/T),C=T-L;for(let k=0;k<=C;k++)k===0&&L===T?A[L][k]=E:A[L][k]=E.clone().lerp(M,k/C)}for(let L=0;L<T;L++)for(let E=0;E<2*(T-L)-1;E++){const M=Math.floor(E/2);E%2===0?(f(A[L][M+1]),f(A[L+1][M]),f(A[L][M])):(f(A[L][M+1]),f(A[L+1][M+1]),f(A[L+1][M]))}}function c(S){const w=new R;for(let v=0;v<r.length;v+=3)w.x=r[v+0],w.y=r[v+1],w.z=r[v+2],w.normalize().multiplyScalar(S),r[v+0]=w.x,r[v+1]=w.y,r[v+2]=w.z}function h(){const S=new R;for(let w=0;w<r.length;w+=3){S.x=r[w+0],S.y=r[w+1],S.z=r[w+2];const v=m(S)/2/Math.PI+.5,P=u(S)/Math.PI+.5;a.push(v,1-P)}g(),d()}function d(){for(let S=0;S<a.length;S+=6){const w=a[S+0],v=a[S+2],P=a[S+4],T=Math.max(w,v,P),A=Math.min(w,v,P);T>.9&&A<.1&&(w<.2&&(a[S+0]+=1),v<.2&&(a[S+2]+=1),P<.2&&(a[S+4]+=1))}}function f(S){r.push(S.x,S.y,S.z)}function p(S,w){const v=S*3;w.x=t[v+0],w.y=t[v+1],w.z=t[v+2]}function g(){const S=new R,w=new R,v=new R,P=new R,T=new Ct,A=new Ct,L=new Ct;for(let E=0,M=0;E<r.length;E+=9,M+=6){S.set(r[E+0],r[E+1],r[E+2]),w.set(r[E+3],r[E+4],r[E+5]),v.set(r[E+6],r[E+7],r[E+8]),T.set(a[M+0],a[M+1]),A.set(a[M+2],a[M+3]),L.set(a[M+4],a[M+5]),P.copy(S).add(w).add(v).divideScalar(3);const C=m(P);_(T,M+0,S,C),_(A,M+2,w,C),_(L,M+4,v,C)}}function _(S,w,v,P){P<0&&S.x===1&&(a[w]=S.x-1),v.x===0&&v.z===0&&(a[w]=P/2/Math.PI+.5)}function m(S){return Math.atan2(S.z,-S.x)}function u(S){return Math.atan2(-S.y,Math.sqrt(S.x*S.x+S.z*S.z))}}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Zs(t.vertices,t.indices,t.radius,t.details)}}class Js extends Zs{constructor(t=1,e=0){const n=(1+Math.sqrt(5))/2,i=[-1,n,0,1,n,0,-1,-n,0,1,-n,0,0,-1,n,0,1,n,0,-1,-n,0,1,-n,n,0,-1,n,0,1,-n,0,-1,-n,0,1],r=[0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1];super(i,r,t,e),this.type="IcosahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new Js(t.radius,t.detail)}}class Ha extends Zs{constructor(t=1,e=0){const n=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],i=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super(n,i,t,e),this.type="OctahedronGeometry",this.parameters={radius:t,detail:e}}static fromJSON(t){return new Ha(t.radius,t.detail)}}class Ji extends _e{constructor(t=.5,e=1,n=32,i=1,r=0,a=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:t,outerRadius:e,thetaSegments:n,phiSegments:i,thetaStart:r,thetaLength:a},n=Math.max(3,n),i=Math.max(1,i);const o=[],l=[],c=[],h=[];let d=t;const f=(e-t)/i,p=new R,g=new Ct;for(let _=0;_<=i;_++){for(let m=0;m<=n;m++){const u=r+m/n*a;p.x=d*Math.cos(u),p.y=d*Math.sin(u),l.push(p.x,p.y,p.z),c.push(0,0,1),g.x=(p.x/e+1)/2,g.y=(p.y/e+1)/2,h.push(g.x,g.y)}d+=f}for(let _=0;_<i;_++){const m=_*(n+1);for(let u=0;u<n;u++){const S=u+m,w=S,v=S+n+1,P=S+n+2,T=S+1;o.push(w,v,T),o.push(v,P,T)}}this.setIndex(o),this.setAttribute("position",new ie(l,3)),this.setAttribute("normal",new ie(c,3)),this.setAttribute("uv",new ie(h,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Ji(t.innerRadius,t.outerRadius,t.thetaSegments,t.phiSegments,t.thetaStart,t.thetaLength)}}class be extends _e{constructor(t=1,e=32,n=16,i=0,r=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:t,widthSegments:e,heightSegments:n,phiStart:i,phiLength:r,thetaStart:a,thetaLength:o},e=Math.max(3,Math.floor(e)),n=Math.max(2,Math.floor(n));const l=Math.min(a+o,Math.PI);let c=0;const h=[],d=new R,f=new R,p=[],g=[],_=[],m=[];for(let u=0;u<=n;u++){const S=[],w=u/n;let v=0;u===0&&a===0?v=.5/e:u===n&&l===Math.PI&&(v=-.5/e);for(let P=0;P<=e;P++){const T=P/e;d.x=-t*Math.cos(i+T*r)*Math.sin(a+w*o),d.y=t*Math.cos(a+w*o),d.z=t*Math.sin(i+T*r)*Math.sin(a+w*o),g.push(d.x,d.y,d.z),f.copy(d).normalize(),_.push(f.x,f.y,f.z),m.push(T+v,1-w),S.push(c++)}h.push(S)}for(let u=0;u<n;u++)for(let S=0;S<e;S++){const w=h[u][S+1],v=h[u][S],P=h[u+1][S],T=h[u+1][S+1];(u!==0||a>0)&&p.push(w,v,T),(u!==n-1||l<Math.PI)&&p.push(v,P,T)}this.setIndex(p),this.setAttribute("position",new ie(g,3)),this.setAttribute("normal",new ie(_,3)),this.setAttribute("uv",new ie(m,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new be(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}}class Zn extends _e{constructor(t=1,e=.4,n=12,i=48,r=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:t,tube:e,radialSegments:n,tubularSegments:i,arc:r},n=Math.floor(n),i=Math.floor(i);const a=[],o=[],l=[],c=[],h=new R,d=new R,f=new R;for(let p=0;p<=n;p++)for(let g=0;g<=i;g++){const _=g/i*r,m=p/n*Math.PI*2;d.x=(t+e*Math.cos(m))*Math.cos(_),d.y=(t+e*Math.cos(m))*Math.sin(_),d.z=e*Math.sin(m),o.push(d.x,d.y,d.z),h.x=t*Math.cos(_),h.y=t*Math.sin(_),f.subVectors(d,h).normalize(),l.push(f.x,f.y,f.z),c.push(g/i),c.push(p/n)}for(let p=1;p<=n;p++)for(let g=1;g<=i;g++){const _=(i+1)*p+g-1,m=(i+1)*(p-1)+g-1,u=(i+1)*(p-1)+g,S=(i+1)*p+g;a.push(_,m,S),a.push(m,u,S)}this.setIndex(a),this.setAttribute("position",new ie(o,3)),this.setAttribute("normal",new ie(l,3)),this.setAttribute("uv",new ie(c,2))}copy(t){return super.copy(t),this.parameters=Object.assign({},t.parameters),this}static fromJSON(t){return new Zn(t.radius,t.tube,t.radialSegments,t.tubularSegments,t.arc)}}class me extends Fn{static get type(){return"MeshStandardMaterial"}constructor(t){super(),this.isMeshStandardMaterial=!0,this.defines={STANDARD:""},this.color=new Ft(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Ft(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Cl,this.normalScale=new Ct(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Be,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(t)}copy(t){return super.copy(t),this.defines={STANDARD:""},this.color.copy(t.color),this.roughness=t.roughness,this.metalness=t.metalness,this.map=t.map,this.lightMap=t.lightMap,this.lightMapIntensity=t.lightMapIntensity,this.aoMap=t.aoMap,this.aoMapIntensity=t.aoMapIntensity,this.emissive.copy(t.emissive),this.emissiveMap=t.emissiveMap,this.emissiveIntensity=t.emissiveIntensity,this.bumpMap=t.bumpMap,this.bumpScale=t.bumpScale,this.normalMap=t.normalMap,this.normalMapType=t.normalMapType,this.normalScale.copy(t.normalScale),this.displacementMap=t.displacementMap,this.displacementScale=t.displacementScale,this.displacementBias=t.displacementBias,this.roughnessMap=t.roughnessMap,this.metalnessMap=t.metalnessMap,this.alphaMap=t.alphaMap,this.envMap=t.envMap,this.envMapRotation.copy(t.envMapRotation),this.envMapIntensity=t.envMapIntensity,this.wireframe=t.wireframe,this.wireframeLinewidth=t.wireframeLinewidth,this.wireframeLinecap=t.wireframeLinecap,this.wireframeLinejoin=t.wireframeLinejoin,this.flatShading=t.flatShading,this.fog=t.fog,this}}class Qs extends jt{constructor(t,e=1){super(),this.isLight=!0,this.type="Light",this.color=new Ft(t),this.intensity=e}dispose(){}copy(t,e){return super.copy(t,e),this.color.copy(t.color),this.intensity=t.intensity,this}toJSON(t){const e=super.toJSON(t);return e.object.color=this.color.getHex(),e.object.intensity=this.intensity,this.groundColor!==void 0&&(e.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(e.object.distance=this.distance),this.angle!==void 0&&(e.object.angle=this.angle),this.decay!==void 0&&(e.object.decay=this.decay),this.penumbra!==void 0&&(e.object.penumbra=this.penumbra),this.shadow!==void 0&&(e.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(e.object.target=this.target.uuid),e}}class wm extends Qs{constructor(t,e,n){super(t,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(jt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Ft(e)}copy(t,e){return super.copy(t,e),this.groundColor.copy(t.groundColor),this}}const Lr=new Zt,rl=new R,al=new R;class Zl{constructor(t){this.camera=t,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Ct(512,512),this.map=null,this.mapPass=null,this.matrix=new Zt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Fa,this._frameExtents=new Ct(1,1),this._viewportCount=1,this._viewports=[new Qt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(t){const e=this.camera,n=this.matrix;rl.setFromMatrixPosition(t.matrixWorld),e.position.copy(rl),al.setFromMatrixPosition(t.target.matrixWorld),e.lookAt(al),e.updateMatrixWorld(),Lr.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Lr),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Lr)}getViewport(t){return this._viewports[t]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(t){return this.camera=t.camera.clone(),this.intensity=t.intensity,this.bias=t.bias,this.radius=t.radius,this.mapSize.copy(t.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const t={};return this.intensity!==1&&(t.intensity=this.intensity),this.bias!==0&&(t.bias=this.bias),this.normalBias!==0&&(t.normalBias=this.normalBias),this.radius!==1&&(t.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(t.mapSize=this.mapSize.toArray()),t.camera=this.camera.toJSON(!1).object,delete t.camera.matrix,t}}const ol=new Zt,qi=new R,Ir=new R;class bm extends Zl{constructor(){super(new Le(90,1,.5,500)),this.isPointLightShadow=!0,this._frameExtents=new Ct(4,2),this._viewportCount=6,this._viewports=[new Qt(2,1,1,1),new Qt(0,1,1,1),new Qt(3,1,1,1),new Qt(1,1,1,1),new Qt(3,0,1,1),new Qt(1,0,1,1)],this._cubeDirections=[new R(1,0,0),new R(-1,0,0),new R(0,0,1),new R(0,0,-1),new R(0,1,0),new R(0,-1,0)],this._cubeUps=[new R(0,1,0),new R(0,1,0),new R(0,1,0),new R(0,1,0),new R(0,0,1),new R(0,0,-1)]}updateMatrices(t,e=0){const n=this.camera,i=this.matrix,r=t.distance||n.far;r!==n.far&&(n.far=r,n.updateProjectionMatrix()),qi.setFromMatrixPosition(t.matrixWorld),n.position.copy(qi),Ir.copy(n.position),Ir.add(this._cubeDirections[e]),n.up.copy(this._cubeUps[e]),n.lookAt(Ir),n.updateMatrixWorld(),i.makeTranslation(-qi.x,-qi.y,-qi.z),ol.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(ol)}}class Va extends Qs{constructor(t,e,n=0,i=2){super(t,e),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=i,this.shadow=new bm}get power(){return this.intensity*4*Math.PI}set power(t){this.intensity=t/(4*Math.PI)}dispose(){this.shadow.dispose()}copy(t,e){return super.copy(t,e),this.distance=t.distance,this.decay=t.decay,this.shadow=t.shadow.clone(),this}}class Tm extends Zl{constructor(){super(new Vl(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class Am extends Qs{constructor(t,e){super(t,e),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(jt.DEFAULT_UP),this.updateMatrix(),this.target=new jt,this.shadow=new Tm}dispose(){this.shadow.dispose()}copy(t){return super.copy(t),this.target=t.target.clone(),this.shadow=t.shadow.clone(),this}}class Rm extends Qs{constructor(t,e){super(t,e),this.isAmbientLight=!0,this.type="AmbientLight"}}class Cm{constructor(t=!0){this.autoStart=t,this.startTime=0,this.oldTime=0,this.elapsedTime=0,this.running=!1}start(){this.startTime=ll(),this.oldTime=this.startTime,this.elapsedTime=0,this.running=!0}stop(){this.getElapsedTime(),this.running=!1,this.autoStart=!1}getElapsedTime(){return this.getDelta(),this.elapsedTime}getDelta(){let t=0;if(this.autoStart&&!this.running)return this.start(),0;if(this.running){const e=ll();t=(e-this.oldTime)/1e3,this.oldTime=e,this.elapsedTime+=t}return t}}function ll(){return performance.now()}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Ta}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Ta);const cl={mouseSens:1,volume:.6,invertY:!1,mute:!1},Ne={plasma:{id:"plasma",name:"PLASMA",damage:18,fireRate:6,projectileSpeed:220,splashRadius:0,ammo:-1,heatPerShot:0,selfDamageScale:0,color:61695,trailColor:6750207},rocket:{id:"rocket",name:"ROCKET",damage:72,fireRate:.55,projectileSpeed:78,splashRadius:16,ammo:4,heatPerShot:0,selfDamageScale:.45,color:16739115,trailColor:16755268},rail:{id:"rail",name:"RAIL",damage:95,fireRate:.55,projectileSpeed:0,splashRadius:0,ammo:8,heatPerShot:0,selfDamageScale:0,color:16722902,trailColor:16738030},laser:{id:"laser",name:"LASER",damage:9,fireRate:14,projectileSpeed:0,splashRadius:0,ammo:80,heatPerShot:0,selfDamageScale:0,color:3800968,trailColor:8978346},torpedo:{id:"torpedo",name:"TORPEDO",damage:110,fireRate:.45,projectileSpeed:55,splashRadius:22,ammo:4,heatPerShot:0,selfDamageScale:.7,color:16724753,trailColor:16746564},scatter:{id:"scatter",name:"SCATTER",damage:11,fireRate:2.2,projectileSpeed:160,splashRadius:0,ammo:24,heatPerShot:0,selfDamageScale:0,color:16770406,trailColor:16773290}},le={maxSpeed:95,afterburnerMax:155,accel:55,strafeAccel:42,verticalAccel:48,drag:1.8,afterburnerDrag:.9,mouseYaw:1.8,mousePitch:1.5,rollFromYaw:.35,energyMax:100,energyDrain:28,energyRegen:12,fovNormal:70,fovBoost:88,collisionDamage:25,bounceRestitution:.45},de={maxHealth:100,maxShield:100,shieldRegenDelay:3.2,shieldRegenRate:18,shieldDeployCost:100,shieldDeployDuration:3.5,shieldAbsorb:1,respawnDelay:2.5,hitMarkerMs:120,enemyHitRadius:2.85,enemyHitscanRadius:2.7,localHitRadius:2.35,projectileHitRadius:.55,aimAssist:.032,aimAssistRange:110,aimAssistCone:.12},Ds={acquireSec:1.15,decaySec:.45,maxRange:165,coneDot:.92},ba={"sky-city":{id:"sky-city",name:"SKY CITY",bounds:840,minAlt:8,maxAlt:220,fogColor:3803720,fogDensity:9e-4,ambient:3809888,sunColor:16742212,sunIntensity:1.35,skyTop:1311784,skyBottom:16726664,style:"open",hasGround:!0,spawnPoints:[[0,40,80],[60,50,-40],[-70,45,30],[40,60,100],[-50,55,-90],[100,40,20],[-90,70,60],[20,35,-120]]},"the-pit":{id:"the-pit",name:"THE PIT",bounds:400,minAlt:6,maxAlt:140,fogColor:2756672,fogDensity:.0018,ambient:2232627,sunColor:11167487,sunIntensity:.9,skyTop:656408,skyBottom:6689092,style:"pit",hasGround:!0,spawnPoints:[[0,30,40],[35,25,-30],[-40,35,10],[20,50,-50],[-25,40,55],[50,28,20]]},"cloud-sea":{id:"cloud-sea",name:"CLOUD SEA",bounds:960,minAlt:20,maxAlt:200,fogColor:9090264,fogDensity:.001,ambient:8956620,sunColor:16773320,sunIntensity:1.8,skyTop:5937872,skyBottom:15266047,style:"clouds",hasGround:!0,spawnPoints:[[0,70,60],[80,85,-50],[-90,75,40],[40,95,100],[-60,80,-80]]},"upper-atmo":{id:"upper-atmo",name:"UPPER ATMO",bounds:1e3,minAlt:10,maxAlt:280,fogColor:661560,fogDensity:4e-4,ambient:3359846,sunColor:16771276,sunIntensity:1.35,skyTop:132368,skyBottom:1720448,style:"atmo",hasGround:!1,spawnPoints:[[0,80,50],[100,100,-40],[-80,90,70],[50,120,-90]]},"deep-space":{id:"deep-space",name:"DEEP SPACE",bounds:1040,minAlt:-180,maxAlt:220,fogColor:328976,fogDensity:22e-5,ambient:1116194,sunColor:8939263,sunIntensity:.55,skyTop:131592,skyBottom:656408,style:"space",hasGround:!1,spawnPoints:[[0,20,40],[70,-20,-50],[-60,40,30],[30,10,-80]]}},Je={rounds:4,targetsPerRound:[3,4,5,6],roundTime:90,lives:3,killScore:100,timeBonusPerSec:2},Ys={botCount:6,matchTime:300,ffa:!0},Jl={rivalCount:5},Pn={collectRadius:5.5,mapCount:24,respawnSec:20,rocketPickupAmmo:2};class Pm{keys=new Set;mouseDX=0;mouseDY=0;mouseButtons=new Set;wheel=0;pointerLocked=!1;engaged=!1;lockError=null;canvas;lockRequestInFlight=!1;constructor(t){this.canvas=t,window.addEventListener("keydown",this.onKeyDown),window.addEventListener("keyup",this.onKeyUp),document.addEventListener("pointerlockchange",this.onLockChange),document.addEventListener("pointerlockerror",this.onLockError),t.addEventListener("mousedown",this.onMouseDown),window.addEventListener("mouseup",this.onMouseUp),window.addEventListener("mousemove",this.onMouseMove),t.addEventListener("wheel",this.onWheel,{passive:!0}),t.addEventListener("contextmenu",e=>e.preventDefault())}dispose(){window.removeEventListener("keydown",this.onKeyDown),window.removeEventListener("keyup",this.onKeyUp),document.removeEventListener("pointerlockchange",this.onLockChange),document.removeEventListener("pointerlockerror",this.onLockError),this.canvas.removeEventListener("mousedown",this.onMouseDown),window.removeEventListener("mouseup",this.onMouseUp),window.removeEventListener("mousemove",this.onMouseMove),this.canvas.removeEventListener("wheel",this.onWheel)}engage(){this.engaged=!0,this.requestLock()}disengage(){this.engaged=!1,this.releaseLock()}requestLock(){if(document.pointerLockElement!==this.canvas&&!this.lockRequestInFlight){if(typeof this.canvas.requestPointerLock!="function"){this.lockError="Pointer lock not supported — free-mouse mode";return}this.lockRequestInFlight=!0;try{const t=this.canvas.requestPointerLock();t&&typeof t.then=="function"?t.then(()=>{this.lockRequestInFlight=!1,this.lockError=null}).catch(e=>{this.lockRequestInFlight=!1;const n=e instanceof Error?e.message:"Pointer lock denied";this.lockError=`${n} — free-mouse mode (look still works)`,console.warn("[NEON VEIL] pointer lock failed, using free-mouse",e)}):window.setTimeout(()=>{this.lockRequestInFlight=!1,document.pointerLockElement!==this.canvas&&(this.lockError="Pointer lock unavailable — free-mouse mode")},120)}catch(t){this.lockRequestInFlight=!1,this.lockError="Pointer lock error — free-mouse mode",console.warn("[NEON VEIL] requestPointerLock threw",t)}}}releaseLock(){if(document.pointerLockElement===this.canvas)try{document.exitPointerLock()}catch{}}endFrame(){this.mouseDX=0,this.mouseDY=0,this.wheel=0}isDown(t){return this.keys.has(t)}isMouseDown(t){return this.mouseButtons.has(t)}isControlActive(){return this.engaged}onKeyDown=t=>{(t.code==="Tab"||t.code==="F3")&&t.preventDefault(),this.keys.add(t.code)};onKeyUp=t=>{this.keys.delete(t.code)};onLockChange=()=>{const t=document.pointerLockElement===this.canvas,e=this.pointerLocked;this.pointerLocked=t,this.lockRequestInFlight=!1,t?(this.engaged=!0,this.lockError=null):e&&(this.engaged=!1)};onLockError=()=>{this.lockRequestInFlight=!1,this.lockError="Pointer lock denied — free-mouse mode (look still works)",console.warn("[NEON VEIL] pointerlockerror — continuing without lock")};onMouseDown=t=>{this.mouseButtons.add(t.button),this.engaged&&!this.pointerLocked&&this.requestLock()};onMouseUp=t=>{this.mouseButtons.delete(t.button)};onMouseMove=t=>{this.engaged&&(this.mouseDX+=t.movementX,this.mouseDY+=t.movementY)};onWheel=t=>{this.wheel+=Math.sign(t.deltaY)}}const Lm={"sky-city":"music/biome-sky-city.mp3","the-pit":"music/biome-the-pit.mp3","cloud-sea":"music/biome-cloud-sea.mp3","upper-atmo":"music/biome-upper-atmo.mp3","deep-space":"music/biome-deep-space.mp3"},hl="music/biome-sky-city.mp3";class Im{ctx=null;master=null;sfx=null;musicGain=null;engineOsc=null;engineGain=null;engineFilter=null;boostNoise=null;boostGain=null;settings;unlocked=!1;lastBoost=!1;musicEl=null;musicStarted=!1;currentBiome=null;musicWired=!1;constructor(t){this.settings=t}async unlock(){if(this.unlocked)return;const t=window.AudioContext||window.webkitAudioContext;this.ctx=new t,this.master=this.ctx.createGain(),this.master.gain.value=this.settings.mute?0:this.settings.volume,this.master.connect(this.ctx.destination),this.sfx=this.ctx.createGain(),this.sfx.gain.value=.9,this.sfx.connect(this.master),this.musicGain=this.ctx.createGain(),this.musicGain.gain.value=this.settings.mute?0:.28,this.musicGain.connect(this.master),this.ctx.state==="suspended"&&await this.ctx.resume(),this.startEngine(),this.unlocked=!0;try{window.__AUDIO_CTX__=this.ctx}catch{}this.setBiomeMusic(this.currentBiome&&this.currentBiome!=="menu"?this.currentBiome:"sky-city")}applySettings(t){this.settings=t,this.master&&(this.master.gain.value=t.mute?0:t.volume),this.musicGain&&(this.musicGain.gain.value=t.mute?0:.28),this.musicEl&&(this.musicWired||(this.musicEl.volume=t.mute?0:.32*t.volume),t.mute?this.musicEl.pause():this.musicStarted&&this.musicEl.play().catch(()=>{}))}setBiomeMusic(t){if(this.currentBiome=t,!this.unlocked||this.settings.mute)return;const e=t==="menu"?hl:Lm[t]||hl;if(this.ensureMusicEl(),!!this.musicEl){if(this.musicStarted&&this.musicEl.src.includes(e.replace("music/",""))){this.musicEl.play().catch(()=>{});return}this.musicEl.loop=!0,this.musicEl.src=e,this.musicEl.play().catch(n=>{console.warn("[NEON VEIL] biome music failed",e,n)}),this.musicStarted=!0}}ensureMusicEl(){if(!this.musicEl&&(this.musicEl=new Audio,this.musicEl.preload="auto",this.musicEl.loop=!0,this.musicEl.volume=.32*this.settings.volume,this.ctx&&this.musicGain&&!this.musicWired))try{this.ctx.createMediaElementSource(this.musicEl).connect(this.musicGain),this.musicEl.volume=1,this.musicGain.gain.value=.28,this.musicWired=!0}catch{}}async startMusic(){this.setBiomeMusic(this.currentBiome&&this.currentBiome!=="menu"?this.currentBiome:"sky-city")}stopMusic(){this.musicEl&&(this.musicEl.pause(),this.musicStarted=!1)}setEngineThrust(t,e){if(!this.engineGain||!this.engineOsc||!this.ctx||!this.engineFilter)return;const n=this.ctx.currentTime,i=.018+t*.07;this.engineGain.gain.setTargetAtTime(i*(e?1.7:1),n,.05),this.engineOsc.frequency.setTargetAtTime(48+t*55+(e?40:0),n,.08),this.engineFilter.frequency.setTargetAtTime(220+t*400+(e?500:0),n,.08),e&&!this.lastBoost?(this.playBoost(),this.startBoostLoop()):!e&&this.lastBoost&&this.stopBoostLoop(),this.lastBoost=e}playUI(){this.beep(880,.05,"square",.04),this.beep(1320,.04,"sine",.025)}playPlasma(){this.noiseBurst(.05,.06,2200,.06),this.beep(380,.06,"sawtooth",.055),this.beep(760,.04,"square",.03),this.slide(500,180,.08,"sawtooth",.04)}playRocket(){this.noiseBurst(.22,.14,350,.18),this.slide(90,40,.25,"sawtooth",.1),this.beep(55,.15,"sine",.06)}playRail(){this.noiseBurst(.08,.08,4e3,.06),this.beep(1600,.1,"square",.07),this.beep(2400,.07,"sine",.05),this.slide(2800,400,.12,"sawtooth",.04)}playLaser(){this.beep(1900,.035,"square",.04),this.beep(2600,.03,"sine",.03),this.noiseBurst(.03,.03,5e3,.03)}playScatter(){this.noiseBurst(.09,.09,1600,.08),this.beep(280,.05,"sawtooth",.05),this.beep(420,.04,"square",.03)}playPickup(){this.beep(660,.05,"sine",.05),this.beep(990,.07,"sine",.045),this.beep(1320,.09,"sine",.035),this.beep(1760,.06,"triangle",.025)}playLockTick(t=.5){const e=620+t*900;this.beep(e,.045,"square",.04+t*.02)}playLockTone(){this.beep(1400,.08,"square",.06),this.beep(1800,.1,"sine",.05),this.beep(2200,.06,"triangle",.03)}playLockLost(){this.beep(400,.08,"sawtooth",.04),this.slide(500,180,.12,"square",.03)}playExplosion(){this.noiseBurst(.4,.28,180,.35),this.noiseBurst(.15,.12,800,.12),this.beep(70,.2,"sine",.08),this.slide(120,30,.25,"sawtooth",.06)}playHitConfirm(){this.beep(880,.04,"square",.05),this.beep(1320,.05,"sine",.04),this.noiseBurst(.03,.04,3e3,.03)}playHit(){this.noiseBurst(.1,.1,600,.09),this.beep(180,.08,"square",.07),this.beep(90,.1,"sawtooth",.05)}playCrit(){this.beep(1200,.06,"square",.06),this.beep(1800,.08,"sine",.05),this.beep(2400,.1,"triangle",.04),this.noiseBurst(.06,.06,2500,.05)}playShieldHit(){this.beep(520,.05,"triangle",.05),this.beep(780,.07,"sine",.04),this.noiseBurst(.05,.04,1800,.04)}playShieldUp(){this.slide(400,900,.18,"sine",.06),this.beep(900,.15,"triangle",.04)}playShieldDown(){this.slide(700,200,.15,"sine",.05),this.noiseBurst(.08,.05,500,.08)}playBoost(){this.noiseBurst(.12,.1,1100,.1),this.slide(200,500,.12,"sawtooth",.05)}playDeath(){this.slide(200,40,.45,"sawtooth",.1),this.noiseBurst(.5,.3,140,.4),this.beep(60,.35,"sine",.08)}playWarp(){this.slide(200,1400,.35,"sine",.07),this.noiseBurst(.25,.12,900,.2),this.beep(1100,.12,"triangle",.04)}playKill(){this.beep(660,.06,"square",.05),this.beep(990,.08,"sine",.05),this.beep(1480,.12,"triangle",.04)}startBoostLoop(){if(!this.ctx||!this.sfx||this.boostGain)return;const t=this.ctx.currentTime,e=this.ctx.createGain();e.gain.setValueAtTime(1e-4,t),e.gain.exponentialRampToValueAtTime(.05,t+.08),e.connect(this.sfx);const n=Math.floor(this.ctx.sampleRate*.4),i=this.ctx.createBuffer(1,n,this.ctx.sampleRate),r=i.getChannelData(0);for(let l=0;l<n;l++)r[l]=(Math.random()*2-1)*.6;const a=this.ctx.createBufferSource();a.buffer=i,a.loop=!0;const o=this.ctx.createBiquadFilter();o.type="bandpass",o.frequency.value=900,o.Q.value=.7,a.connect(o),o.connect(e),a.start(),this.boostNoise=a,this.boostGain=e}stopBoostLoop(){if(!this.ctx||!this.boostGain||!this.boostNoise)return;const t=this.ctx.currentTime;try{this.boostGain.gain.cancelScheduledValues(t),this.boostGain.gain.setValueAtTime(Math.max(1e-4,this.boostGain.gain.value),t),this.boostGain.gain.exponentialRampToValueAtTime(1e-4,t+.12)}catch{}const e=this.boostNoise,n=this.boostGain;this.boostNoise=null,this.boostGain=null,window.setTimeout(()=>{try{e.stop(),e.disconnect(),n.disconnect()}catch{}},150)}startEngine(){!this.ctx||!this.master||(this.engineOsc=this.ctx.createOscillator(),this.engineOsc.type="sawtooth",this.engineOsc.frequency.value=55,this.engineFilter=this.ctx.createBiquadFilter(),this.engineFilter.type="lowpass",this.engineFilter.frequency.value=260,this.engineGain=this.ctx.createGain(),this.engineGain.gain.value=.025,this.engineOsc.connect(this.engineFilter),this.engineFilter.connect(this.engineGain),this.engineGain.connect(this.master),this.engineOsc.start())}dest(){return this.sfx??this.master}beep(t,e,n,i){if(!this.ctx||!this.dest()||this.settings.mute)return;const r=this.ctx.currentTime,a=this.ctx.createOscillator(),o=this.ctx.createGain();a.type=n,a.frequency.value=t,o.gain.setValueAtTime(i,r),o.gain.exponentialRampToValueAtTime(.001,r+e),a.connect(o),o.connect(this.dest()),a.start(r),a.stop(r+e+.02)}slide(t,e,n,i,r){if(!this.ctx||!this.dest()||this.settings.mute)return;const a=this.ctx.currentTime,o=this.ctx.createOscillator(),l=this.ctx.createGain();o.type=i,o.frequency.setValueAtTime(t,a),o.frequency.exponentialRampToValueAtTime(Math.max(20,e),a+n),l.gain.setValueAtTime(r,a),l.gain.exponentialRampToValueAtTime(.001,a+n),o.connect(l),l.connect(this.dest()),o.start(a),o.stop(a+n+.02)}noiseBurst(t,e,n,i){if(!this.ctx||!this.dest()||this.settings.mute)return;const r=this.ctx.currentTime,a=Math.floor(this.ctx.sampleRate*t),o=this.ctx.createBuffer(1,a,this.ctx.sampleRate),l=o.getChannelData(0);for(let f=0;f<a;f++)l[f]=(Math.random()*2-1)*(1-f/a);const c=this.ctx.createBufferSource();c.buffer=o;const h=this.ctx.createBiquadFilter();h.type="lowpass",h.frequency.value=n;const d=this.ctx.createGain();d.gain.setValueAtTime(e,r),d.gain.exponentialRampToValueAtTime(.001,r+i),c.connect(h),h.connect(d),d.connect(this.dest()),c.start(r)}}class Dm{position=new R(0,40,0);velocity=new R;quaternion=new Nn;euler=new Be(0,0,0,"YXZ");energy=le.energyMax;boosting=!1;speed=0;lookBack=!1;zooming=!1;stunTimer=0;forward=new R;right=new R;up=new R;tmp=new R;desiredRoll=0;update(t,e,n,i,r,a){this.stunTimer=Math.max(0,this.stunTimer-t);const o=this.stunTimer>0,l=n.mouseSens*.0022,c=n.invertY?-1:1;e.isControlActive()&&!this.lookBack&&!o&&(this.euler.y-=e.mouseDX*l*le.mouseYaw,this.euler.x-=e.mouseDY*l*le.mousePitch*c,this.euler.x=ce.clamp(this.euler.x,-Math.PI*.45,Math.PI*.45)),this.lookBack=!o&&e.isDown("KeyE"),this.zooming=!o&&e.isMouseDown(1);const h=!o&&(e.isMouseDown(2)||e.isDown("KeyB"));this.boosting=h&&this.energy>1,this.boosting?(this.energy=Math.max(0,this.energy-le.energyDrain*t),this.energy<=0&&(this.boosting=!1)):this.energy=Math.min(le.energyMax,this.energy+le.energyRegen*t),this.quaternion.setFromEuler(this.euler),this.forward.set(0,0,-1).applyQuaternion(this.quaternion),this.right.set(1,0,0).applyQuaternion(this.quaternion),this.up.set(0,1,0).applyQuaternion(this.quaternion);let d=0,f=0,p=0;o||(e.isDown("KeyW")&&(d+=1),e.isDown("KeyS")&&(d-=.7),e.isDown("KeyD")&&(f+=1),e.isDown("KeyA")&&(f-=1),e.isDown("Space")&&(p+=1),(e.isDown("ShiftLeft")||e.isDown("ShiftRight"))&&(p-=1));const g=this.boosting?le.afterburnerMax:le.maxSpeed,_=this.boosting?le.afterburnerDrag:le.drag;this.tmp.copy(this.forward).multiplyScalar(d*le.accel*(this.boosting?1.6:1)),this.velocity.addScaledVector(this.tmp,t),this.tmp.copy(this.right).multiplyScalar(f*le.strafeAccel),this.velocity.addScaledVector(this.tmp,t),this.tmp.copy(this.up).multiplyScalar(p*le.verticalAccel),this.velocity.addScaledVector(this.tmp,t);const m=Math.exp(-_*t);this.velocity.multiplyScalar(m),this.speed=this.velocity.length(),this.speed>g&&(this.velocity.multiplyScalar(g/this.speed),this.speed=g),this.position.addScaledVector(this.velocity,t),this.clampWorld(i,r,a);const u=-e.mouseDX*l;this.desiredRoll=ce.clamp(f*.35+u*8,-.5,.5),this.euler.z=ce.lerp(this.euler.z,this.desiredRoll*le.rollFromYaw,1-Math.exp(-6*t)),this.quaternion.setFromEuler(this.euler)}bounce(t,e=1){const n=this.velocity.dot(t);n<0?this.velocity.addScaledVector(t,-n*(1+le.bounceRestitution)):this.velocity.addScaledVector(t,Math.min(8,n*.15)),this.position.addScaledVector(t,.35);const i=this.velocity.length();return i>le.maxSpeed*.85&&this.velocity.multiplyScalar(le.maxSpeed*.85/i),this.speed=this.velocity.length(),Math.min(le.collisionDamage*e,Math.abs(n)*.85+2)}integrateSubstep(t){this.position.addScaledVector(this.velocity,t)}clampWorld(t,e,n){this.position.y=ce.clamp(this.position.y,t,e);const i=n*.95;this.position.x=ce.clamp(this.position.x,-i,i),this.position.z=ce.clamp(this.position.z,-i,i)}getAimDirection(t){return t.set(0,0,-1).applyQuaternion(this.quaternion)}getCameraQuaternion(t){if(this.lookBack){const e=this.euler.clone();e.y+=Math.PI,e.z=-e.z,t.setFromEuler(e)}else t.copy(this.quaternion);return t}reset(t,e=0){this.position.copy(t),this.velocity.set(0,0,0),this.euler.set(0,e,0),this.quaternion.setFromEuler(this.euler),this.energy=le.energyMax,this.boosting=!1,this.speed=0,this.stunTimer=0}applyStun(t){this.stunTimer=Math.max(this.stunTimer,t),this.boosting=!1,this.velocity.multiplyScalar(.35)}}class Ql{group=new Te;body;shieldMesh;thrusterMats=[];constructor(t=61695,e=!1){this.body=new Te,this.group.add(this.body);const n=new me({color:1708072,metalness:.7,roughness:.35,emissive:t,emissiveIntensity:.15}),i=new St({color:t,transparent:!0,opacity:.95}),r=new me({color:2245734,metalness:.2,roughness:.1,transparent:!0,opacity:.45,emissive:1127253,emissiveIntensity:.3}),a=new it(new oe(2.2,.55,3.4),n);a.position.y=-.15,this.body.add(a);const o=new it(new Di(.55,1.4,6),n);o.rotation.x=-Math.PI/2,o.position.set(0,-.1,-2.1),this.body.add(o);const l=new it(new be(.55,8,6,0,Math.PI*2,0,Math.PI*.55),r);l.position.set(0,.25,-.3),l.scale.set(1.1,.7,1.4),this.body.add(l);const c=new oe(3.6,.08,1.1),h=new it(c,n);h.position.set(0,-.2,.4),this.body.add(h);const d=new oe(3.5,.04,.06),f=new it(d,i);f.position.set(0,-.15,.4),this.body.add(f);const p=new en(.18,.25,.4,8);for(const g of[-.55,.55]){const _=new St({color:16737826});this.thrusterMats.push(_);const m=new it(p,_);m.rotation.x=Math.PI/2,m.position.set(g,-.1,1.7),this.body.add(m)}if(e){const g=new it(new oe(1.6,.12,1.2),new me({color:1181724,metalness:.8,roughness:.3,emissive:t,emissiveIntensity:.2}));g.position.set(0,-.55,-.9),this.group.add(g);const _=new it(new oe(1.8,.08,.5),new St({color:43724}));_.position.set(0,-.48,-.5),this.group.add(_),this.body.visible=!1,g.visible=!0,_.visible=!0}this.shieldMesh=new it(new be(2.4,16,12),new St({color:61695,transparent:!0,opacity:.18,wireframe:!0,depthWrite:!1})),this.shieldMesh.visible=!1,this.group.add(this.shieldMesh)}setTransform(t,e){this.group.position.copy(t),this.group.quaternion.copy(e)}setBoost(t){for(const e of this.thrusterMats)e.color.setHSL(.08,1,.4+t*.4)}setShield(t){if(this.shieldMesh.visible=t,t){const e=this.shieldMesh.material;e.opacity=.22+Math.sin(performance.now()*.01)*.05}}setColor(t){this.body.traverse(e=>{if(e.isMesh){const n=e.material;n.emissive&&n.emissive.setHex(t)}})}dispose(){this.group.traverse(t=>{const e=t;if(e.geometry&&e.geometry.dispose(),e.material){const n=e.material;Array.isArray(n)?n.forEach(i=>i.dispose()):n.dispose()}})}}const Um=["plasma","rocket","rail","laser","torpedo","scatter"];class Nm{current="plasma";unlocked=new Set(["plasma"]);ammo={plasma:-1,rocket:Ne.rocket.ammo,rail:Ne.rail.ammo,laser:0,torpedo:0,scatter:0};cooldown=0;order=["plasma","rocket","rail","laser","torpedo","scatter"];pool=[];scene;trailGroup;railBeams=[];muzzleFlash=new Va(61695,0,12);constructor(t){this.scene=t,this.trailGroup=new Te,t.add(this.trailGroup),t.add(this.muzzleFlash);for(let e=0;e<64;e++){const n=new St({color:61695,transparent:!0,opacity:.95}),i=new it(new be(.25,6,6),n);i.visible=!1,this.trailGroup.add(i),this.pool.push({active:!1,position:new R,velocity:new R,weapon:"plasma",ownerId:"",life:0,damage:0,splash:0,mesh:i,selfDamageScale:0,targetId:null,homing:0,maxSpeed:220})}}get def(){return Ne[this.current]}select(t){t!=="plasma"&&!this.unlocked.has(t)&&this.ammo[t]<=0||(this.current=t)}unlock(t){this.unlocked.add(t)}grantWeapon(t,e){if(this.unlock(t),this.ammo[t]<0)return;const n=Math.max(Ne[t].ammo*2,e);this.ammo[t]=Math.min(n,Math.max(0,this.ammo[t])+e),this.current=t}grantAmmoAll(t=.5){for(const e of Um){if(e==="plasma"||!this.unlocked.has(e)&&this.ammo[e]<=0)continue;const n=Ne[e].ammo;n<0||(this.ammo[e]=Math.min(n*2,this.ammo[e]+Math.ceil(n*t)))}}cycle(t){const e=this.order.filter(r=>r==="plasma"||this.unlocked.has(r)||this.ammo[r]>0);if(e.length===0)return;const n=e.indexOf(this.current),i=(Math.max(0,n)+t+e.length)%e.length;this.current=e[i]}trySelectSlot(t){if(t>=1&&t<=this.order.length){const e=this.order[t-1];(e==="plasma"||this.unlocked.has(e)||this.ammo[e]>0)&&(this.current=e)}}update(t,e=[]){this.cooldown>0&&(this.cooldown-=t),this.muzzleFlash.intensity=Math.max(0,this.muzzleFlash.intensity-t*40);const n=new R;for(const i of this.pool)if(i.active){if(i.life-=t,i.homing>0&&i.targetId){const r=e.find(a=>a.id===i.targetId&&a.alive);if(r){n.copy(r.position).sub(i.position).normalize();const a=Math.max(i.maxSpeed*.55,i.velocity.length()),o=i.homing*t;i.velocity.lerp(n.multiplyScalar(a),Math.min(1,o));const l=i.velocity.length();l>i.maxSpeed?i.velocity.multiplyScalar(i.maxSpeed/l):l<i.maxSpeed*.7&&i.velocity.multiplyScalar(i.maxSpeed*.85/Math.max(l,.001))}else i.homing=0,i.targetId=null}i.weapon==="torpedo"&&i.homing<=0&&(i.velocity.y-=4*t),i.position.addScaledVector(i.velocity,t),i.mesh.position.copy(i.position),i.homing>0&&i.velocity.lengthSq()>1&&i.mesh.lookAt(i.position.x+i.velocity.x,i.position.y+i.velocity.y,i.position.z+i.velocity.z),i.life<=0&&this.deactivate(i)}for(let i=this.railBeams.length-1;i>=0;i--){const r=this.railBeams[i];r.life-=t;const a=r.line.material;a.opacity=Math.max(0,r.life*5),r.life<=0&&(this.scene.remove(r.line),r.line.geometry.dispose(),a.dispose(),this.railBeams.splice(i,1))}}canFire(){if(this.cooldown>0)return!1;const t=this.ammo[this.current];return t===-1||t>0}fire(t,e,n,i){if(!this.canFire())return null;const r=this.def;if(r.id==="rocket"&&i?.requireLock!==!1&&!i?.lockTargetId)return null;if(this.cooldown=1/r.fireRate,this.ammo[this.current]>0&&this.ammo[this.current]--,this.muzzleFlash.color.setHex(r.color),this.muzzleFlash.intensity=r.id==="laser"?5:8,this.muzzleFlash.position.copy(e),r.projectileSpeed<=0){const l=r.id==="laser"?280:400,c=e.clone().addScaledVector(n,l);return this.spawnRailBeam(e,c,r.trailColor,r.id==="laser"?.08:.25),{hitscan:[{weapon:r.id,ownerId:t,origin:e.clone(),direction:n.clone(),damage:r.damage,end:c}]}}if(r.id==="scatter"){const l=[];for(let c=0;c<5;c++){const h=n.clone();h.x+=(Math.random()-.5)*.18,h.y+=(Math.random()-.5)*.14,h.z+=(Math.random()-.5)*.18,h.normalize();const d=this.spawnProjectile(t,e,h,r,null);d&&l.push(d)}return l.length?{projectiles:l}:null}const a=i?.lockTargetId??null,o=this.spawnProjectile(t,e,n,r,a);return o?{projectiles:[o]}:null}spawnProjectile(t,e,n,i,r){const a=this.pool.find(l=>!l.active);if(!a)return null;a.active=!0,a.position.copy(e),a.velocity.copy(n).multiplyScalar(i.projectileSpeed),a.weapon=i.id,a.ownerId=t,a.life=i.id==="torpedo"?7:i.id==="rocket"?5.5:i.id==="scatter"?1.5:2.4,a.damage=i.damage,a.splash=i.splashRadius,a.selfDamageScale=i.selfDamageScale,a.targetId=r,a.maxSpeed=i.projectileSpeed*(i.id==="rocket"?1.15:1),i.id==="rocket"&&r?a.homing=3.6:i.id==="torpedo"&&r?a.homing=1.35:a.homing=0,a.mesh.visible=!0;const o=i.id==="torpedo"?1.9:i.id==="rocket"?1.55:i.id==="scatter"?.6:.9;return a.mesh.scale.setScalar(o),a.mesh.material.color.setHex(i.color),a.mesh.position.copy(a.position),a}deactivate(t){t.active=!1,t.mesh.visible=!1,t.targetId=null,t.homing=0}spawnRailBeam(t,e,n,i=.25){const r=new _e().setFromPoints([t.clone(),e.clone()]),a=new jl({color:n,transparent:!0,opacity:1,linewidth:2}),o=new Em(r,a);this.scene.add(o),this.railBeams.push({line:o,life:i})}refill(){this.ammo.plasma=-1,this.ammo.rocket=Ne.rocket.ammo,this.ammo.rail=Ne.rail.ammo,this.ammo.laser=this.unlocked.has("laser")?Ne.laser.ammo:0,this.ammo.torpedo=this.unlocked.has("torpedo")?Ne.torpedo.ammo:0,this.ammo.scatter=this.unlocked.has("scatter")?Ne.scatter.ammo:0,this.cooldown=0}dispose(){for(const t of this.pool)t.mesh.geometry.dispose(),t.mesh.material.dispose();this.scene.remove(this.trailGroup),this.scene.remove(this.muzzleFlash)}}class Fm{phase="off";progress=0;targetId=null;targetPos=new R;beepTimer=0;wasLocked=!1;get locked(){return this.phase==="locked"&&!!this.targetId}reset(){this.phase="off",this.progress=0,this.targetId=null,this.beepTimer=0,this.wasLocked=!1}update(t,e,n,i,r,a){if(!e){const h=this.progress>.05||this.wasLocked;return this.reset(),h?"lost":null}const o=this.pickTarget(n,i,r,a);let l=null;if(!o)return this.progress>0||this.phase==="locked"?(this.progress=Math.max(0,this.progress-t/Ds.decaySec),this.progress<=.001?((this.wasLocked||this.phase!=="off")&&(l="lost"),this.phase="off",this.targetId=null,this.wasLocked=!1,this.progress=0):this.phase="locking"):(this.phase="seeking",this.targetId=null),l;if(this.targetId&&this.targetId!==o.id&&(this.progress=0,this.wasLocked=!1,l="lost"),this.targetId=o.id,this.targetPos.copy(o.position),this.progress>=1)return this.phase="locked",this.progress=1,this.wasLocked?(this.beepTimer-=t,this.beepTimer<=0&&(this.beepTimer=.22,l="tick")):(this.wasLocked=!0,l="locked"),l;this.phase="locking",this.progress=Math.min(1,this.progress+t/Ds.acquireSec),this.beepTimer-=t;const c=.55-this.progress*.4;return this.beepTimer<=0&&(this.beepTimer=Math.max(.12,c),l="tick"),this.progress>=1&&(this.phase="locked",this.wasLocked=!0,l="locked"),l}pickTarget(t,e,n,i){let r=null,a=-1/0;const o=new R;for(const l of n){if(!l.alive)continue;o.copy(l.position).sub(t);const c=o.length();if(c<8||c>Ds.maxRange)continue;o.multiplyScalar(1/c);const h=e.dot(o);if(h<Ds.coneDot||!i(t,l.position))continue;const d=h*3-c*.01+(l.id===this.targetId?.4:0);d>a&&(a=d,r=l)}return r}}class Om{charge=de.maxShield;deployed=!1;deployTimer=0;timeSinceDamage=999;get fullyCharged(){return this.charge>=de.maxShield-.5&&!this.deployed}update(t,e){return this.deployed?(this.deployTimer-=t,this.deployTimer<=0?(this.deployed=!1,this.charge=0,"down"):null):e&&this.fullyCharged?(this.deployed=!0,this.deployTimer=de.shieldDeployDuration,"up"):(this.timeSinceDamage+=t,this.timeSinceDamage>=de.shieldRegenDelay&&(this.charge=Math.min(de.maxShield,this.charge+de.shieldRegenRate*t)),null)}absorb(t){if(this.timeSinceDamage=0,this.deployed)return t*(1-de.shieldAbsorb*.85);if(this.charge>0){const e=Math.min(this.charge,t);return this.charge-=e,t-e}return t}reset(){this.charge=de.maxShield,this.deployed=!1,this.deployTimer=0,this.timeSinceDamage=999}}class Bm{group=new Te;colliders=[];buildingCount=0;groundCollide=!0;ground=null;spatial=new Map;spatialCell=40;build(t){switch(this.clear(),this.groundCollide=t.hasGround!==!1&&t.style!=="space"&&t.style!=="atmo",t.style){case"pit":this.buildPit(t);break;case"clouds":this.buildCloudSea(t);break;case"atmo":this.buildUpperAtmo(t);break;case"space":this.buildDeepSpace(t);break;default:this.buildSkyCity(t);break}this.rebuildSpatial()}buildSkyCity(t){const e=t.bounds;this.addCityFloor(e),this.addSunset(t),this.addMountains(e,24);const n=15,i=Math.floor(e/n),r=[];for(let P=-i;P<=i;P++)for(let T=-i;T<=i;T++){if(P===0||T===0||Math.abs(P)%5===0||Math.abs(T)%5===0||Math.abs(P)<2&&Math.abs(T)<2)continue;const A=Tt(P,T),L=Math.hypot(P,T)/i,E=L>.85?.28:L>.55?.12:.04;A<E||r.push({gx:P,gz:T,roll:A})}const a=520;r.sort((P,T)=>P.roll-T.roll);const o=r.length>a?r.slice(0,a):r,l=new oe(1,1,1),c=new me({color:1708080,metalness:.45,roughness:.62,emissive:2228275,emissiveIntensity:.28}),h=new Ue(l,c,o.length);h.castShadow=!1,h.receiveShadow=!0,h.frustumCulled=!0;const d=new oe(1.02,.07,1.02),f=new St({color:16777215,toneMapped:!1}),p=new Ue(d,f,o.length*2);p.frustumCulled=!0;const g=new oe(1.01,.35,1.01),_=new St({color:61695,transparent:!0,opacity:.35,toneMapped:!1}),m=new Ue(g,_,o.length);m.frustumCulled=!0;const u=new jt,S=[61695,16722902,16770406,3800968,16739115,11167487];let w=0,v=0;for(const{gx:P,gz:T,roll:A}of o){const L=(A-.5)*5,E=P*n+L,M=T*n+(Tt(T,P)-.5)*5,C=Math.hypot(P,T)/i,k=C<.35?50+A*40:C<.65?15:0,O=7+A*12+(1-C)*4,W=7+Tt(P+3,T)*12+(1-C)*4,X=18+A*70+k+(Tt(P,T+9)<.12?55:0);u.position.set(E,X/2,M),u.scale.set(O,X,W),u.rotation.set(0,0,0),u.updateMatrix(),h.setMatrixAt(v,u.matrix);const H=S[v%S.length];for(let j=0;j<2;j++){const V=X*(.3+j*.35);u.position.set(E,V,M),u.scale.set(O,1,W),u.updateMatrix(),p.setMatrixAt(w,u.matrix),p.setColorAt(w,new Ft(H)),w++}u.position.set(E,X*.55,M),u.scale.set(O,1,W),u.updateMatrix(),m.setMatrixAt(v,u.matrix),this.colliders.push(this.makeCollider(E,X/2,M,O/2,X/2,W/2)),v++}h.count=v,p.count=w,m.count=v,h.instanceMatrix.needsUpdate=!0,p.instanceMatrix.needsUpdate=!0,m.instanceMatrix.needsUpdate=!0,p.instanceColor&&(p.instanceColor.needsUpdate=!0),this.group.add(h),this.group.add(p),this.group.add(m),this.buildingCount=v,this.addPads(18,e*.42,28,95),this.addStreetLightsInstanced(e),this.addBillboards(o.length>80?40:20,e*.7)}buildPit(t){const e=t.bounds;this.addGround(e,787988);const n=48,i=55,r=new oe(1,1,1),a=new me({color:1577e3,metalness:.5,roughness:.55,emissive:3346756,emissiveIntensity:.3}),o=new Ue(r,a,n+i),l=new Ue(new oe(1.05,.12,1.05),new St({color:16722902,toneMapped:!1}),n),c=new jt,h=e*.72;for(let p=0;p<n;p++){const g=p/n*Math.PI*2,_=Math.cos(g)*h,m=Math.sin(g)*h,u=50+Tt(p,1)*40,S=14+Tt(p,2)*10;c.position.set(_,u/2,m),c.scale.set(S,u,S),c.lookAt(0,u/2,0),c.updateMatrix(),o.setMatrixAt(p,c.matrix),c.position.set(_,u*.6,m),c.scale.set(S,1,S),c.updateMatrix(),l.setMatrixAt(p,c.matrix),this.colliders.push(this.makeCollider(_,u/2,m,S/2,u/2,S/2))}let d=0;for(let p=0;p<i*2&&d<i;p++){const g=Tt(p,7)*Math.PI*2,_=Tt(p,8)*h*.55,m=Math.cos(g)*_,u=Math.sin(g)*_;if(Math.hypot(m,u)<25)continue;const S=15+Tt(p,9)*45,w=6+Tt(p,10)*10;c.position.set(m,S/2,u),c.scale.set(w,S,w),c.rotation.set(0,0,0),c.updateMatrix(),o.setMatrixAt(n+d,c.matrix),this.colliders.push(this.makeCollider(m,S/2,u,w/2,S/2,w/2)),d++}o.count=n+d,l.count=n,o.instanceMatrix.needsUpdate=!0,l.instanceMatrix.needsUpdate=!0,this.group.add(o),this.group.add(l),this.buildingCount=n+d;const f=new it(new en(22,24,3,12),new me({color:2232627,emissive:61695,emissiveIntensity:.2,metalness:.6,roughness:.4}));f.position.y=1.5,this.group.add(f),this.colliders.push(this.makeCollider(0,1.5,0,22,1.5,22)),this.addPitFloor(e),this.addSunset(t)}buildCloudSea(t){const e=t.bounds;this.addCloudSeaFloor(e),this.addCloudLayer(e,40,8,22,12114168,.5);const n=180,i=new be(1,8,6),r=new me({color:14544639,emissive:4482730,emissiveIntensity:.35,transparent:!0,opacity:.72,roughness:1,metalness:0}),a=new Ue(i,r,n),o=new jt;for(let f=0;f<n;f++){const p=Tt(f,1)*Math.PI*2,g=Tt(f,2)*e*.95,_=Math.cos(p)*g,m=Math.sin(p)*g,u=25+Tt(f,3)*90,S=8+Tt(f,4)*22;o.position.set(_,u,m),o.scale.set(S*1.6,S*.55,S*1.2),o.updateMatrix(),a.setMatrixAt(f,o.matrix)}a.instanceMatrix.needsUpdate=!0,this.group.add(a),this.addPads(28,e*.55,40,110);const l=40,c=new en(.8,1.2,1,6),h=new St({color:6745855,toneMapped:!1}),d=new Ue(c,h,l);for(let f=0;f<l;f++){const p=f/l*Math.PI*2,g=40+f%5*35,_=30+Tt(f,5)*50;o.position.set(Math.cos(p)*g,_/2,Math.sin(p)*g),o.scale.set(1,_,1),o.updateMatrix(),d.setMatrixAt(f,o.matrix),this.colliders.push(this.makeCollider(Math.cos(p)*g,_/2,Math.sin(p)*g,1.2,_/2,1.2))}d.instanceMatrix.needsUpdate=!0,this.group.add(d),this.buildingCount=n+l,this.addCloudLayer(e,70,40,100,16777215,.4),this.addSunset(t)}buildUpperAtmo(t){const e=t.bounds,n=new it(new Fe(e*1.35,64),new St({color:1718896,transparent:!0,opacity:.22,side:he,fog:!1,depthWrite:!1}));n.rotation.x=-Math.PI/2,n.position.y=-35,this.group.add(n);const i=new it(new Fe(e*.85,48),new St({color:4491468,transparent:!0,opacity:.12,side:he,fog:!1,depthWrite:!1}));i.rotation.x=-Math.PI/2,i.position.y=-28,this.group.add(i);const r=new Zn(e*.35,3,8,48),a=new me({color:4478310,metalness:.7,roughness:.35,emissive:2241348,emissiveIntensity:.4}),o=new it(r,a);o.rotation.x=Math.PI/2,o.position.y=60,this.group.add(o);const l=70,c=new oe(1,1,1),h=new me({color:3359846,metalness:.7,roughness:.35,emissive:1122884,emissiveIntensity:.4}),d=new Ue(c,h,l),f=new Ue(new oe(1.05,.1,1.05),new St({color:8956671,toneMapped:!1}),l),p=new jt;for(let g=0;g<l;g++){const _=Tt(g,1)*Math.PI*2,m=30+Tt(g,2)*e*.7,u=Math.cos(_)*m,S=Math.sin(_)*m,w=20+Tt(g,3)*140,v=4+Tt(g,4)*14,P=3+Tt(g,5)*10,T=4+Tt(g,6)*14;p.position.set(u,w,S),p.scale.set(v,P,T),p.rotation.set(Tt(g,7)*.4,Tt(g,8)*Math.PI,0),p.updateMatrix(),d.setMatrixAt(g,p.matrix),p.scale.set(v,1,T),p.updateMatrix(),f.setMatrixAt(g,p.matrix),this.colliders.push(this.makeCollider(u,w,S,v/2,P/2,T/2))}d.instanceMatrix.needsUpdate=!0,f.instanceMatrix.needsUpdate=!0,this.group.add(d),this.group.add(f),this.buildingCount=l,this.addPads(20,e*.55,40,140),this.addStarfield(1200,e*2.8,.55)}buildDeepSpace(t){const e=t.bounds;this.addStarfield(2200,e*3.2,1);const n=180,i=new Js(1,0),r=new me({color:5588070,metalness:.25,roughness:.85,emissive:1114146,emissiveIntensity:.15}),a=new Ue(i,r,n),o=new jt;for(let c=0;c<n;c++){const h=Tt(c,1)*Math.PI*2,d=25+Tt(c,2)*e*.85,f=Math.cos(h)*d,p=Math.sin(h)*d,g=(Tt(c,3)-.5)*e*.6,_=2+Tt(c,4)*12;o.position.set(f,g,p),o.scale.set(_,_*(.6+Tt(c,5)*.8),_),o.rotation.set(Tt(c,6)*6,Tt(c,7)*6,Tt(c,8)*6),o.updateMatrix(),a.setMatrixAt(c,o.matrix),this.colliders.push(this.makeCollider(f,g,p,_,_,_))}a.instanceMatrix.needsUpdate=!0,this.group.add(a),this.buildingCount=n,this.addPads(14,e*.45,-50,90);const l=new it(new Zn(28,2.2,10,40),new St({color:11167487,toneMapped:!1}));l.position.set(0,20,-80),this.group.add(l),this.colliders.push(this.makeCollider(0,20,-80,30,4,4))}addCloudLayer(t,e,n,i,r,a){const o=new be(1,7,5),l=new me({color:r,emissive:r,emissiveIntensity:.15,transparent:!0,opacity:a,roughness:1,metalness:0,depthWrite:!1}),c=new Ue(o,l,e),h=new jt;for(let d=0;d<e;d++){const f=Tt(d,50)*Math.PI*2,p=Tt(d,51)*t*.9;h.position.set(Math.cos(f)*p,n+Tt(d,52)*(i-n),Math.sin(f)*p);const g=10+Tt(d,53)*28;h.scale.set(g*1.8,g*.45,g*1.4),h.updateMatrix(),c.setMatrixAt(d,h.matrix)}c.instanceMatrix.needsUpdate=!0,this.group.add(c)}addStarfield(t,e,n){const i=new Float32Array(t*3);for(let o=0;o<t;o++){const l=Tt(o,11),c=Tt(o,12),h=l*Math.PI*2,d=Math.acos(2*c-1),f=e*(.55+Tt(o,13)*.45);i[o*3]=f*Math.sin(d)*Math.cos(h),i[o*3+1]=f*Math.cos(d)*.6,i[o*3+2]=f*Math.sin(d)*Math.sin(h)}const r=new _e;r.setAttribute("position",new Ie(i,3));const a=new qs({color:16777215,size:1.2,sizeAttenuation:!0,transparent:!0,opacity:n,depthWrite:!1,fog:!1});this.group.add(new wa(r,a))}addBillboards(t,e){const n=new mn(8,4),r=[61695,16722902,16770406].map(a=>new St({color:a,transparent:!0,opacity:.55,side:he,toneMapped:!1}));for(let a=0;a<t;a++){const o=new it(n,r[a%r.length]),l=Tt(a,20)*Math.PI*2,c=40+Tt(a,21)*e;o.position.set(Math.cos(l)*c,25+Tt(a,22)*60,Math.sin(l)*c),o.rotation.y=l+Math.PI/2,this.group.add(o)}}addGround(t,e,n){const i=n?.scale??2.4;this.ground=new it(new mn(t*i,t*i,1,1),new me({color:e,metalness:n?.metalness??.15,roughness:n?.roughness??.92,emissive:n?.emissive??0,emissiveIntensity:n?.emissiveIntensity??0})),this.ground.rotation.x=-Math.PI/2,this.ground.position.y=n?.y??0,this.ground.receiveShadow=!0,this.group.add(this.ground)}addCityFloor(t){this.addGround(t,920088,{metalness:.35,roughness:.88,emissive:1706032,emissiveIntensity:.12,scale:2.5});const e=new it(new Fe(t*.55,48),new St({color:16722902,transparent:!0,opacity:.06,depthWrite:!1,toneMapped:!1}));e.rotation.x=-Math.PI/2,e.position.y=.04,this.group.add(e);const n=t*.95,i=14,r=new me({color:656916,metalness:.4,roughness:.75,emissive:1312800,emissiveIntensity:.15}),a=new St({color:61695,transparent:!0,opacity:.55,toneMapped:!1}),o=h=>{const d=new it(new mn(h?n*2:i,h?i:n*2),r);d.rotation.x=-Math.PI/2,d.position.y=.06,this.group.add(d);for(const f of[-1,1]){const p=new it(new mn(h?n*2:.35,h?.35:n*2),a);p.rotation.x=-Math.PI/2,p.position.y=.08,h?p.position.z=f*(i*.48):p.position.x=f*(i*.48),this.group.add(p)}};o(!0),o(!1);const l=new it(new Ji(t*.38,t*.38+10,64),new St({color:16722902,transparent:!0,opacity:.12,side:he,depthWrite:!1,toneMapped:!1}));l.rotation.x=-Math.PI/2,l.position.y=.07,this.group.add(l);const c=new it(new Fe(22,32),new me({color:1708080,metalness:.55,roughness:.45,emissive:61695,emissiveIntensity:.18}));c.rotation.x=-Math.PI/2,c.position.y=.09,this.group.add(c)}addPitFloor(t){const e=new it(new Fe(t*.78,48),new me({color:1181720,metalness:.55,roughness:.55,emissive:2754624,emissiveIntensity:.22}));e.rotation.x=-Math.PI/2,e.position.y=.05,this.group.add(e);for(let n=0;n<3;n++){const i=28+n*32,r=i+1.4,a=new it(new Ji(i,r,48),new St({color:n%2===0?16722902:61695,transparent:!0,opacity:.28-n*.06,side:he,depthWrite:!1,toneMapped:!1}));a.rotation.x=-Math.PI/2,a.position.y=.08+n*.01,this.group.add(a)}}addCloudSeaFloor(t){this.addGround(t,796744,{metalness:.72,roughness:.22,emissive:663608,emissiveIntensity:.2,scale:2.8});const e=new it(new mn(t*2.6,t*2.6),new St({color:13164792,transparent:!0,opacity:.18,depthWrite:!1,side:he}));e.rotation.x=-Math.PI/2,e.position.y=1.2,this.group.add(e);const n=new it(new Ji(t*.9,t*1.05,64),new St({color:11063536,transparent:!0,opacity:.2,side:he,depthWrite:!1,fog:!1}));n.rotation.x=-Math.PI/2,n.position.y=.4,this.group.add(n);const i=new it(new Fe(t*.25,40),new St({color:15267071,transparent:!0,opacity:.12,depthWrite:!1}));i.rotation.x=-Math.PI/2,i.position.y=.15,this.group.add(i)}addSunset(t){const e=t.bounds,n=new it(new Fe(48,32),new St({color:t.sunColor,fog:!1,transparent:!0,opacity:.95}));n.position.set(-180,40,-e*.9),this.group.add(n);const i=new it(new Fe(70,32),new St({color:16729224,fog:!1,transparent:!0,opacity:.25}));i.position.copy(n.position),i.position.z+=1,this.group.add(i)}addMountains(t,e){const n=new St({color:2756672,transparent:!0,opacity:.75}),i=new Di(1,1,5),r=new Ue(i,n,e),a=new jt;for(let o=0;o<e;o++){const l=o/e*Math.PI*2,c=t*1.12,h=45+Tt(o,30)*90,d=28+Tt(o,31)*40;a.position.set(Math.cos(l)*c,h*.35,Math.sin(l)*c),a.scale.set(d,h,d),a.updateMatrix(),r.setMatrixAt(o,a.matrix)}r.instanceMatrix.needsUpdate=!0,this.group.add(r)}addPads(t,e,n,i){const r=new me({color:1712176,emissive:61695,emissiveIntensity:.35,metalness:.5,roughness:.4}),a=new en(6,7,1.2,8),o=new Ue(a,r,t),l=new jt;for(let c=0;c<t;c++){const h=(Tt(c,40)-.5)*e*2,d=(Tt(c,41)-.5)*e*2,f=n+Tt(c,42)*(i-n);l.position.set(h,f,d),l.scale.set(1,1,1),l.updateMatrix(),o.setMatrixAt(c,l.matrix),this.colliders.push(this.makeCollider(h,f,d,6,.6,6))}o.instanceMatrix.needsUpdate=!0,this.group.add(o)}addStreetLightsInstanced(t){const e=[];for(let o=-t;o<=t;o+=36)for(const l of[-14,14])e.push([l,8,o],[o,8,l]);const n=new be(.55,5,5),i=new St({color:16770406,toneMapped:!1}),r=new Ue(n,i,e.length),a=new jt;for(let o=0;o<e.length;o++)a.position.set(e[o][0],e[o][1],e[o][2]),a.scale.set(1,1,1),a.updateMatrix(),r.setMatrixAt(o,a.matrix);r.instanceMatrix.needsUpdate=!0,this.group.add(r)}makeCollider(t,e,n,i,r,a){const o=new R(t,e,n),l=new R(i,r,a);return{center:o,half:l,min:new R(t-i,e-r,n-a),max:new R(t+i,e+r,n+a)}}rebuildSpatial(){this.spatial.clear();const t=this.spatialCell;for(let e=0;e<this.colliders.length;e++){const n=this.colliders[e],i=Math.floor(n.min.x/t),r=Math.floor(n.max.x/t),a=Math.floor(n.min.z/t),o=Math.floor(n.max.z/t);for(let l=i;l<=r;l++)for(let c=a;c<=o;c++){const h=`${l},${c}`;let d=this.spatial.get(h);d||(d=[],this.spatial.set(h,d)),d.push(e)}}}collideSphere(t,e,n){const i=this.spatialCell,r=Math.floor((t.x-e)/i)-1,a=Math.floor((t.x+e)/i)+1,o=Math.floor((t.z-e)/i)-1,l=Math.floor((t.z+e)/i)+1,c=new Set;let h=!1;for(let d=r;d<=a;d++)for(let f=o;f<=l;f++){const p=this.spatial.get(`${d},${f}`);if(p)for(const g of p){if(c.has(g))continue;c.add(g);const _=this.colliders[g],m=ce.clamp(t.x,_.min.x,_.max.x),u=ce.clamp(t.y,_.min.y,_.max.y),S=ce.clamp(t.z,_.min.z,_.max.z),w=t.x-m,v=t.y-u,P=t.z-S,T=w*w+v*v+P*P;if(t.x>=_.min.x&&t.x<=_.max.x&&t.y>=_.min.y&&t.y<=_.max.y&&t.z>=_.min.z&&t.z<=_.max.z){const L=t.x-_.min.x,E=_.max.x-t.x,M=t.y-_.min.y,C=_.max.y-t.y,k=t.z-_.min.z,O=_.max.z-t.z;let W=0,X=1,H=L;E<H&&(H=E,X=-1),M<H&&(H=M,W=1,X=1),C<H&&(H=C,W=1,X=-1),k<H&&(H=k,W=2,X=1),O<H&&(H=O,W=2,X=-1),n.set(0,0,0),W===0?n.x=-X:W===1?n.y=-X:n.z=-X;const j=H+e+.08;t.addScaledVector(n,j),h=!0;continue}if(T<e*e&&T>1e-10){const L=Math.sqrt(T);n.set(w/L,v/L,P/L);const E=e-L+.06;t.addScaledVector(n,E),h=!0}}}return this.groundCollide&&t.y-e<0&&(n.set(0,1,0),t.y=e,h=!0),h}resolveSolid(t,e,n,i=6){let r=!1;for(let a=0;a<i&&this.collideSphere(t,e,n);a++)r=!0;return r}lineOfSight(t,e){const n=e.x-t.x,i=e.y-t.y,r=e.z-t.z,a=Math.hypot(n,i,r);if(a<2)return!0;const o=Math.min(28,Math.max(6,Math.ceil(a/10))),l=this.spatialCell,c=new Set;for(let h=2;h<=o-2;h++){const d=h/o,f=t.x+n*d,p=t.y+i*d,g=t.z+r*d,_=Math.floor(f/l),m=Math.floor(g/l);for(let u=-1;u<=1;u++)for(let S=-1;S<=1;S++){const w=this.spatial.get(`${_+u},${m+S}`);if(w)for(const v of w){if(c.has(v))continue;c.add(v);const P=this.colliders[v];if(!(P.half.y<4)&&f>=P.min.x&&f<=P.max.x&&p>=P.min.y&&p<=P.max.y&&g>=P.min.z&&g<=P.max.z)return!1}}}return!0}clear(){for(;this.group.children.length;)this.group.children.pop().traverse(e=>{const n=e;if(n.geometry&&n.geometry.dispose(),n.material){const i=n.material;Array.isArray(i)?i.forEach(r=>r.dispose()):i.dispose()}});this.colliders=[],this.spatial.clear(),this.buildingCount=0,this.ground=null}}function Tt(s,t){let e=s*374761393+t*668265263|0;return e=(e^e>>>13)*1274126177,e=e^e>>>16,(e>>>0)/4294967295}class km{group=new Te;portals=[];rings=[];labels=[];spin=0;buildForMap(t,e){this.clear();const n=this.pickTargets(t),i=n.length;if(i===0)return;const r=new Zn(10,.55,10,40),a=new Fe(9,32),o=new en(.35,.5,18,6);for(let l=0;l<i;l++){const c=n[l],h=ba[c],d=l/i*Math.PI*2+.4,f=e*.38+l%2*e*.08,p=28+l%3*12,g=new R(Math.cos(d)*f,p,Math.sin(d)*f),_=zm(c),m={id:`portal-${c}`,label:h?.name??c,target:c,position:g,color:_,radius:11};this.portals.push(m);const u=new Te;u.position.copy(g),u.lookAt(0,p,0);const S=new St({color:_,transparent:!0,opacity:.95,toneMapped:!1}),w=new it(r,S);w.rotation.x=Math.PI/2,u.add(w),this.rings.push(w);const v=new it(r,new St({color:16777215,transparent:!0,opacity:.35,toneMapped:!1}));v.rotation.x=Math.PI/2,v.scale.setScalar(.88),u.add(v),this.rings.push(v);const P=new it(a,new St({color:_,transparent:!0,opacity:.22,side:he,toneMapped:!1,depthWrite:!1}));P.rotation.x=Math.PI/2,u.add(P);const T=new me({color:1708080,emissive:_,emissiveIntensity:.55,metalness:.4,roughness:.5});for(const E of[-11,11]){const M=new it(o,T);M.position.set(E,0,0),u.add(M)}const A=Hm(m.label,_);A.position.set(0,14,0),u.add(A),this.labels.push(A);const L=new Va(_,1.4,60,2);L.position.set(0,0,0),u.add(L),this.group.add(u)}}pickTargets(t){return["sky-city","cloud-sea","upper-atmo","deep-space","the-pit"].filter(n=>n!==t)}update(t){this.spin+=t;for(let e=0;e<this.rings.length;e++){const n=this.rings[e];n.rotation.z=this.spin*(e%2===0?.7:-1.1)}}checkEnter(t){for(const e of this.portals)if(t.distanceTo(e.position)<e.radius)return e;return null}blips(){return this.portals.map(t=>({x:t.position.x,z:t.position.z}))}clear(){for(;this.group.children.length;)this.group.children.pop().traverse(e=>{const n=e;if(n.geometry&&n.geometry.dispose(),n.material){const i=n.material;Array.isArray(i)?i.forEach(r=>r.dispose()):i.dispose()}});this.portals=[],this.rings=[],this.labels=[]}}function zm(s){switch(s){case"sky-city":return 16722902;case"cloud-sea":return 6741503;case"upper-atmo":return 8956671;case"deep-space":return 11167487;case"the-pit":return 16739115;default:return 61695}}function Hm(s,t){const e=document.createElement("canvas");e.width=256,e.height=64;const n=e.getContext("2d");n.clearRect(0,0,256,64),n.fillStyle="rgba(0,0,0,0.45)",n.fillRect(8,12,240,40),n.font="bold 22px monospace",n.textAlign="center",n.textBaseline="middle",n.fillStyle="#"+t.toString(16).padStart(6,"0"),n.fillText(s,128,32);const i=new za(e);i.needsUpdate=!0;const r=new ka({map:i,transparent:!0,depthWrite:!1}),a=new Kl(r);return a.scale.set(18,4.5,1),a}class Vm{group=new Te;scene;mapId="sky-city";sky=null;planet=null;flashLight=null;stormTimer=0;nextStorm=18;rain=null;rainVel=null;meteors=[];meteorSpawn=0;satellites=null;satAngle=0;aurora=null;time=0;tmp=new R;hazards=[];constructor(t){this.scene=t}build(t){switch(this.clear(),this.mapId=t.id,this.time=0,this.stormTimer=0,this.nextStorm=12+Math.random()*20,this.meteorSpawn=0,this.sky=Gm(t.skyTop,t.skyBottom,t.bounds*2.8),this.group.add(this.sky),t.style){case"open":this.buildSkyCityWeather(t);break;case"clouds":this.buildCloudWeather(t);break;case"atmo":this.buildAtmoSky(t);break;case"space":this.buildSpaceHazards(t);break;case"pit":this.buildPitAmbience(t);break}this.scene.add(this.group)}buildSkyCityWeather(t){this.flashLight=new Va(11193599,0,t.bounds*2,2),this.flashLight.position.set(0,180,0),this.group.add(this.flashLight);const e=900,n=new Float32Array(e*3);this.rainVel=new Float32Array(e);const i=t.bounds;for(let a=0;a<e;a++)n[a*3]=(Math.random()-.5)*i*2,n[a*3+1]=Math.random()*160+20,n[a*3+2]=(Math.random()-.5)*i*2,this.rainVel[a]=40+Math.random()*55;const r=new _e;r.setAttribute("position",new Ie(n,3)),this.rain=new wa(r,new qs({color:8956671,size:.55,transparent:!0,opacity:.35,depthWrite:!1,fog:!1})),this.rain.visible=!1,this.group.add(this.rain);for(let a=0;a<6;a++){const o=a/6*Math.PI*2,l=new it(new be(1,8,6),new St({color:2756672,transparent:!0,opacity:.35,fog:!1,depthWrite:!1}));l.scale.set(50+Math.random()*40,12+Math.random()*10,40+Math.random()*30),l.position.set(Math.cos(o)*t.bounds*.95,90+Math.random()*40,Math.sin(o)*t.bounds*.95),this.group.add(l)}}buildCloudWeather(t){const e=new it(new Fe(55,32),new St({color:16771242,fog:!1,transparent:!0,opacity:.85,side:he}));e.position.set(-120,80,-t.bounds*.85),this.group.add(e);const n=new it(new en(t.bounds*1.15,t.bounds*1.2,35,48,1,!0),new St({color:12113136,transparent:!0,opacity:.22,side:he,fog:!1,depthWrite:!1}));n.position.y=15,this.group.add(n);for(let i=0;i<5;i++){const r=new it(new Di(18,90,8,1,!0),new St({color:16773320,transparent:!0,opacity:.06,side:he,depthWrite:!1,fog:!1})),a=i/5*Math.PI*2;r.position.set(Math.cos(a)*80,70,Math.sin(a)*80),r.rotation.x=Math.PI,this.group.add(r)}}buildAtmoSky(t){this.planet=new it(new be(t.bounds*1.4,48,32),new me({color:1716320,emissive:661568,emissiveIntensity:.4,metalness:.1,roughness:.9,fog:!1})),this.planet.position.set(0,-t.bounds*1.55,0),this.group.add(this.planet);const e=new it(new be(t.bounds*1.42,48,24),new St({color:4491519,transparent:!0,opacity:.12,side:ye,fog:!1,depthWrite:!1}));e.position.copy(this.planet.position),this.group.add(e);const n=new it(new be(t.bounds*1.405,32,24),new St({color:11193599,transparent:!0,opacity:.15,fog:!1,depthWrite:!1}));n.position.copy(this.planet.position),this.group.add(n),this.aurora=new it(new Zn(t.bounds*.55,8,8,64),new St({color:4521898,transparent:!0,opacity:.22,fog:!1,depthWrite:!1,side:he})),this.aurora.rotation.x=Math.PI*.4,this.aurora.position.y=40,this.group.add(this.aurora);const i=new it(new Fe(40,28),new St({color:16773341,fog:!1,side:he}));i.position.set(-200,120,-t.bounds),this.group.add(i)}buildSpaceHazards(t){const e=[11149960,2245802,6693546,2263142];for(let r=0;r<4;r++){const a=new it(new Fe(t.bounds*(.5+Math.random()*.4),28),new St({color:e[r],transparent:!0,opacity:.12+Math.random()*.08,fog:!1,side:he,depthWrite:!1})),o=r/4*Math.PI*2;a.position.set(Math.cos(o)*t.bounds*1.2,(Math.random()-.5)*80,Math.sin(o)*t.bounds*1.2),a.lookAt(0,0,0),this.group.add(a)}this.satellites=new Te;for(let r=0;r<8;r++){const a=new Te,o=new it(new oe(3,1.2,1.2),new me({color:8952234,metalness:.8,roughness:.3,emissive:1122867,emissiveIntensity:.4}));a.add(o);const l=new it(new oe(8,.08,2.2),new St({color:2245802,toneMapped:!1}));l.position.y=.2,a.add(l);const c=r/8*Math.PI*2,h=90+r%3*40;a.position.set(Math.cos(c)*h,-20+r%4*25,Math.sin(c)*h),a.userData.orbitR=h,a.userData.orbitA=c,a.userData.orbitY=a.position.y,this.satellites.add(a)}this.group.add(this.satellites);const n=new Js(1,0),i=new me({color:8939093,emissive:16729088,emissiveIntensity:.35,roughness:.9,metalness:.15});for(let r=0;r<24;r++){const a=new it(n,i.clone());a.visible=!1,this.group.add(a),this.meteors.push({mesh:a,vel:new R,alive:!1,life:0,radius:2})}}buildPitAmbience(t){const e=new it(new be(t.bounds*1.1,24,12,0,Math.PI*2,0,Math.PI*.45),new St({color:1706016,transparent:!0,opacity:.55,side:ye,fog:!1,depthWrite:!1}));e.position.y=20,this.group.add(e);const n=200,i=new Float32Array(n*3);for(let a=0;a<n;a++){const o=Math.random()*Math.PI*2,l=Math.random()*t.bounds*.7;i[a*3]=Math.cos(o)*l,i[a*3+1]=5+Math.random()*80,i[a*3+2]=Math.sin(o)*l}const r=new _e;r.setAttribute("position",new Ie(i,3)),this.rain=new wa(r,new qs({color:16737826,size:.8,transparent:!0,opacity:.5,depthWrite:!1})),this.group.add(this.rain)}update(t,e){if(this.time+=t,this.hazards=[],this.sky&&(this.sky.rotation.y=this.time*.008),this.mapId==="sky-city"&&this.updateStorm(t,e),this.mapId==="cloud-sea"&&this.sky&&this.sky.material.map,this.mapId==="upper-atmo"&&(this.planet&&(this.planet.rotation.y=this.time*.02),this.aurora&&(this.aurora.rotation.z=this.time*.15,this.aurora.material.opacity=.15+Math.sin(this.time*1.2)*.08)),this.mapId==="deep-space"&&this.updateSpace(t,e),this.mapId==="the-pit"&&this.rain){const n=this.rain.geometry.attributes.position.array;for(let i=0;i<n.length;i+=3)n[i+1]+=t*(8+i%5),n[i+1]>90&&(n[i+1]=5);this.rain.geometry.attributes.position.needsUpdate=!0}return this.hazards}updateStorm(t,e){if(this.stormTimer+=t,this.stormTimer>=this.nextStorm&&(this.stormTimer=0,this.nextStorm=14+Math.random()*28,this.flashLightning(e)),this.rain&&this.flashLight){const n=this.flashLight.intensity>.5||this.stormTimer<4;if(this.rain.visible=n,n&&this.rainVel){const i=this.rain.geometry.attributes.position.array,r=this.rainVel.length;for(let a=0;a<r;a++)i[a*3+1]-=this.rainVel[a]*t,i[a*3+1]<0&&(i[a*3+1]=140+Math.random()*40,i[a*3]=(Math.random()-.5)*800,i[a*3+2]=(Math.random()-.5)*800);this.rain.geometry.attributes.position.needsUpdate=!0}}this.flashLight&&this.flashLight.intensity>0&&(this.flashLight.intensity=Math.max(0,this.flashLight.intensity-t*25))}flashLightning(t){this.flashLight&&(this.flashLight.intensity=40,this.flashLight.position.set((Math.random()-.5)*200,100+Math.random()*80,(Math.random()-.5)*200));const e=new it(new en(.4,.15,80,4),new St({color:14544639,toneMapped:!1,transparent:!0,opacity:.95})),n=(Math.random()-.5)*180,i=(Math.random()-.5)*180;if(e.position.set(n,70,i),this.group.add(e),window.setTimeout(()=>{this.group.remove(e),e.geometry.dispose(),e.material.dispose()},120),Math.random()<.12&&t.length){const r=t[Math.floor(Math.random()*t.length)];e.position.set(r.pos.x,r.pos.y+40,r.pos.z),this.flashLight&&(this.flashLight.position.copy(r.pos).y+=30),this.hazards.push({kind:"lightning",position:r.pos.clone(),damage:8+Math.random()*10,stun:.55+Math.random()*.35})}}updateSpace(t,e){if(this.satellites){this.satAngle+=t*.12;for(const n of this.satellites.children){const i=n.userData.orbitR,r=n.userData.orbitA,a=n.userData.orbitY,o=r+this.satAngle;n.position.set(Math.cos(o)*i,a+Math.sin(this.time+r)*4,Math.sin(o)*i),n.lookAt(0,a,0)}}this.meteorSpawn-=t,this.meteorSpawn<=0&&(this.meteorSpawn=.8+Math.random()*1.8,this.spawnMeteor());for(const n of this.meteors)if(n.alive){if(n.life-=t,n.mesh.position.addScaledVector(n.vel,t),n.mesh.rotation.x+=t*2,n.mesh.rotation.y+=t*1.5,n.life<=0){n.alive=!1,n.mesh.visible=!1;continue}for(const i of e)if(i.pos.distanceTo(n.mesh.position)<n.radius+2.2){this.hazards.push({kind:"meteor",position:n.mesh.position.clone(),damage:18+Math.random()*22,stun:.25}),n.alive=!1,n.mesh.visible=!1;break}}}spawnMeteor(){const t=this.meteors.find(r=>!r.alive);if(!t)return;const e=Math.random()*Math.PI*2,n=180+Math.random()*120;t.mesh.position.set(Math.cos(e)*n,80+Math.random()*100,Math.sin(e)*n),this.tmp.set((Math.random()-.5)*60,-40+(Math.random()-.5)*40,(Math.random()-.5)*60),t.vel.copy(this.tmp).sub(t.mesh.position).normalize().multiplyScalar(45+Math.random()*50);const i=1.5+Math.random()*4;t.mesh.scale.setScalar(i),t.radius=i*1.1,t.life=8,t.alive=!0,t.mesh.visible=!0}getSolidSpheres(){const t=[];if(this.satellites)for(const e of this.satellites.children)t.push({pos:e.position,radius:4});for(const e of this.meteors)e.alive&&t.push({pos:e.mesh.position,radius:e.radius});return t}clear(){for(this.group.parent&&this.scene.remove(this.group);this.group.children.length;)this.group.children.pop().traverse(e=>{const n=e;if(n.geometry&&n.geometry.dispose(),n.material){const i=n.material;if(Array.isArray(i))i.forEach(r=>r.dispose());else{const r=i.map;r&&r.dispose(),i.dispose()}}});this.sky=null,this.planet=null,this.flashLight=null,this.rain=null,this.rainVel=null,this.meteors=[],this.satellites=null,this.aurora=null}}function Gm(s,t,e){const n=document.createElement("canvas");n.width=4,n.height=64;const i=n.getContext("2d"),r=i.createLinearGradient(0,0,0,64),a="#"+s.toString(16).padStart(6,"0"),o="#"+t.toString(16).padStart(6,"0");r.addColorStop(0,a),r.addColorStop(.45,a),r.addColorStop(1,o),i.fillStyle=r,i.fillRect(0,0,4,64);const l=new za(n);l.colorSpace=Oe;const c=new St({map:l,side:ye,fog:!1,depthWrite:!1}),h=new it(new be(e,40,24),c);return h.renderOrder=-10,h}class Wm{def;city=new Bm;portals=new km;atmosphere;scene;hemi=null;sun=null;ambient=null;constructor(t,e="sky-city"){this.scene=t,this.def=ba[e],this.atmosphere=new Vm(t)}load(t){this.def=ba[t],this.clearLights(),this.city.clear(),this.portals.clear(),this.atmosphere.clear(),this.city.group.parent&&this.scene.remove(this.city.group),this.portals.group.parent&&this.scene.remove(this.portals.group),this.scene.background=new Ft(this.def.skyTop),this.scene.fog=new Ba(this.def.fogColor,this.def.fogDensity),this.hemi=new wm(this.def.skyTop,this.def.skyBottom,.65),this.ambient=new Rm(this.def.ambient,.7),this.sun=new Am(this.def.sunColor,this.def.sunIntensity),this.sun.position.set(-80,60,-100),this.scene.add(this.hemi,this.ambient,this.sun),this.atmosphere.build(this.def),this.city.build(this.def),this.scene.add(this.city.group),this.portals.buildForMap(t,this.def.bounds),this.scene.add(this.portals.group)}update(t,e){return this.portals.update(t),this.atmosphere.update(t,e)}checkPortal(t){return this.portals.checkEnter(t)}getSpawn(t){const e=this.def.spawnPoints,n=e[t%e.length];return new R(n[0],n[1],n[2])}randomSpawn(){const t=Math.floor(Math.random()*this.def.spawnPoints.length),e=this.getSpawn(t);return e.x+=(Math.random()-.5)*8,e.z+=(Math.random()-.5)*8,e}clearLights(){for(const t of[this.hemi,this.sun,this.ambient])t&&this.scene.remove(t);this.hemi=this.sun=this.ambient=null}dispose(){this.clearLights(),this.city.clear(),this.portals.clear(),this.atmosphere.clear(),this.scene.remove(this.city.group),this.scene.remove(this.portals.group)}}const ul=[{kind:"weapon",weapon:"laser",amount:1,label:"LASER",color:3800968},{kind:"weapon",weapon:"torpedo",amount:4,label:"TORPEDO",color:16737826},{kind:"weapon",weapon:"rail",amount:6,label:"RAIL",color:16722902},{kind:"weapon",weapon:"rocket",amount:2,label:"ROCKET ×2",color:16755268},{kind:"weapon",weapon:"scatter",amount:12,label:"SCATTER",color:16770406}],Xm=[{kind:"health",amount:40,label:"HULL+",color:16729190},{kind:"shield",amount:50,label:"SHIELD+",color:61695},{kind:"ammo",amount:1,label:"RELOAD",color:11193599}];class qm{group=new Te;pickups=[];nextId=1;time=0;spawnForMap(t,e=22){this.clear();const n=[...ul,...ul,...Xm];for(let i=0;i<e;i++){const r=n[i%n.length],a=i/e*Math.PI*2+Us(i)*.8,o=50+Us(i+3)*t*.55,l=18+Us(i+7)*90,c=new R(Math.cos(a)*o,l,Math.sin(a)*o);this.spawnOne(r,c)}}spawnOne(t,e){const n=new Te;n.position.copy(e);const i=new me({color:1709096,metalness:.45,roughness:.55,emissive:t.color,emissiveIntensity:.35}),r=new St({color:t.color,toneMapped:!1,transparent:!0,opacity:.95}),a=new it(new oe(2.4,2,2.4),i);n.add(a);const o=new it(new oe(2.5,.2,2.5),r);o.position.y=1.05,n.add(o);for(const[d,f]of[[-1.1,-1.1],[1.1,-1.1],[-1.1,1.1],[1.1,1.1]]){const p=new it(new oe(.18,2.1,.18),r);p.position.set(d,0,f),n.add(p)}const l=new it(new en(.12,.35,10,6),new St({color:t.color,transparent:!0,opacity:.35,depthWrite:!1,toneMapped:!1}));l.position.y=6,n.add(l);const c=new it(new be(.55,8,8),new St({color:t.color,toneMapped:!1}));c.position.y=11.2,n.add(c);const h=Ym(`▣ ${t.label}`,t.color);h.position.y=3.6,n.add(h),this.group.add(n),this.pickups.push({id:this.nextId++,def:t,mesh:n,position:e.clone(),alive:!0,respawnAt:0,bob:Us(this.nextId)*Math.PI*2})}update(t){this.time+=t;for(const e of this.pickups){if(!e.alive){this.time>=e.respawnAt&&(e.alive=!0,e.mesh.visible=!0);continue}e.mesh.rotation.y+=t*.7,e.mesh.position.y=e.position.y+Math.sin(this.time*2.2+e.bob)*.55;const n=e.mesh.children[6];if(n){const i=.9+Math.sin(this.time*3+e.bob)*.12;n.scale.set(i,1,i)}}}tryCollect(t,e=Pn.collectRadius){for(const n of this.pickups)if(n.alive&&t.distanceTo(n.mesh.position)<e)return n.alive=!1,n.mesh.visible=!1,n.respawnAt=this.time+Pn.respawnSec,n.def;return null}respawnDelaySec(){return Pn.respawnSec}blips(){return this.pickups.filter(t=>t.alive).map(t=>({x:t.position.x,z:t.position.z}))}exportState(){return{time:this.time,items:this.pickups.map(t=>({alive:t.alive,respawnAt:t.respawnAt}))}}importState(t){if(!(!t||t.items.length!==this.pickups.length)){this.time=t.time;for(let e=0;e<this.pickups.length;e++){const n=this.pickups[e],i=t.items[e];n.alive=i.alive,n.respawnAt=i.respawnAt,n.mesh.visible=n.alive}}}clear(){for(;this.group.children.length;)this.group.children.pop().traverse(e=>{const n=e;if(n.geometry&&n.geometry.dispose(),n.material){const i=n.material;Array.isArray(i)?i.forEach(r=>r.dispose()):i.dispose()}});this.pickups=[]}}function Us(s){let t=s*374761393|0;return t=(t^t>>>13)*1274126177,((t^t>>>16)>>>0)/4294967295}function Ym(s,t){const e=document.createElement("canvas");e.width=128,e.height=40;const n=e.getContext("2d");n.fillStyle="rgba(0,0,0,0.5)",n.fillRect(4,6,120,28),n.font="bold 16px monospace",n.textAlign="center",n.textBaseline="middle",n.fillStyle="#"+t.toString(16).padStart(6,"0"),n.fillText(s,64,20);const i=new za(e),r=new ka({map:i,transparent:!0,depthWrite:!1}),a=new Kl(r);return a.scale.set(8,2.5,1),a}const dl=[{type:"hunter",aggression:.85,accuracy:.74,courage:.55,preferredRange:70,speedMul:1.08},{type:"skirmisher",aggression:.55,accuracy:.68,courage:.45,preferredRange:95,speedMul:1.18},{type:"sniper",aggression:.4,accuracy:.86,courage:.35,preferredRange:140,speedMul:.95},{type:"guardian",aggression:.5,accuracy:.72,courage:.7,preferredRange:55,speedMul:1},{type:"berserker",aggression:1,accuracy:.62,courage:.9,preferredRange:35,speedMul:1.22}];class fl{state;pawn;marker;persona;mood="hunt";velocity=new R;targetId=null;fireCd=0;thinkTimer=0;moodTimer=0;hidePoint=new R;orbitAngle=0;strafeSign=1;jukeTimer=0;tmp=new R;tmp2=new R;tmp3=new R;quat=new Nn;euler=new Be(0,0,0,"YXZ");lastDamaged=0;constructor(t,e=16722902,n=0){this.state=t,this.pawn=new Ql(e,!1),this.marker=this.makeMarker(e),this.pawn.group.add(this.marker),this.persona=dl[n%dl.length],this.orbitAngle=Math.random()*Math.PI*2,this.strafeSign=Math.random()<.5?-1:1,this.syncFromState()}makeMarker(t){const e=new Te,n=16722506,i=new St({color:n,transparent:!0,opacity:.95,depthTest:!0,depthWrite:!1,side:he,toneMapped:!1}),r=new St({color:t,transparent:!0,opacity:.85,depthTest:!0,depthWrite:!1,toneMapped:!1}),a=new it(new Ha(1.1,0),i);a.position.y=-.9,a.scale.set(1.4,.25,1.4),e.add(a);const o=new it(new Di(.55,1.2,3),i);o.position.y=2.8,o.rotation.x=Math.PI,e.add(o);const l=new it(new Zn(1.8,.06,6,20),r);l.rotation.x=Math.PI/2,l.position.y=.15,e.add(l);const c=new it(new oe(.12,.7,.12),i);c.position.y=2,e.add(c);const h=new it(new oe(.14,.14,.14),i);return h.position.y=1.45,e.add(h),e.position.y=.2,e}setTrackerVisible(t){this.marker.visible=t&&this.state.alive}deflect(t){const e=this.velocity.dot(t);e<0&&this.velocity.addScaledVector(t,-e*1.35),this.velocity.addScaledVector(t,6),this.pawn.group.position.addScaledVector(t,.4);const n=this.velocity.length();n>90&&this.velocity.multiplyScalar(90/n)}syncFromState(){this.pawn.group.position.fromArray(this.state.position),this.quat.fromArray(this.state.rotation),this.pawn.group.quaternion.copy(this.quat),this.velocity.fromArray(this.state.velocity)}writeState(){this.pawn.group.position.toArray(this.state.position),this.pawn.group.quaternion.toArray(this.state.rotation),this.velocity.toArray(this.state.velocity)}update(t,e,n,i,r,a){if(!this.state.alive){this.pawn.group.visible=!1;return}this.pawn.group.visible=!0,this.marker.rotation.y+=t*1.5,this.lastDamaged=Math.max(0,this.lastDamaged-t),this.jukeTimer=Math.max(0,this.jukeTimer-t),this.fireCd=Math.max(0,this.fireCd-t),this.moodTimer-=t,this.thinkTimer-=t,this.thinkTimer<=0&&(this.thinkTimer=.25+Math.random()*.35,this.pickTarget(e),this.reassessMood(n,i,r));const o=this.pawn.group.position,l=this.targetId?e.find(P=>P.id===this.targetId&&P.alive):null,c=l?this.tmp2.fromArray(l.position):null,h=c?o.distanceTo(c):1/0,d=this.tmp3;switch(this.mood){case"flee":this.computeFlee(d,c,o,n,i,r);break;case"hide":d.copy(this.hidePoint),o.distanceTo(this.hidePoint)<18&&(d.x+=Math.sin(performance.now()*.001+this.orbitAngle)*12,d.z+=Math.cos(performance.now()*.001+this.orbitAngle)*12,d.y+=Math.sin(performance.now()*.0015)*8);break;case"defend":this.computeDefend(d,c,o);break;case"engage":this.computeEngage(d,c,o,h);break;case"hunt":default:this.computeHunt(d,c,o,n,i,r);break}this.tmp.copy(d).sub(o),this.tmp.length()>.5&&this.tmp.normalize();const p=Math.atan2(-this.tmp.x,-this.tmp.z),g=Math.asin(ce.clamp(this.tmp.y,-.85,.85));this.euler.setFromQuaternion(this.pawn.group.quaternion,"YXZ");const _=this.mood==="flee"?3.4:this.mood==="engage"?2.85:2.2;this.euler.y=ce.lerp(this.euler.y,p,1-Math.exp(-_*t)),this.euler.x=ce.lerp(this.euler.x,-g*.75,1-Math.exp(-2.4*t));const m=ce.euclideanModulo(p-this.euler.y+Math.PI,Math.PI*2)-Math.PI;this.euler.z=ce.lerp(this.euler.z,ce.clamp(-m*.85,-.6,.6),1-Math.exp(-3.5*t)),this.quat.setFromEuler(this.euler),this.pawn.group.quaternion.copy(this.quat);let u=44*this.persona.speedMul;this.mood==="flee"?u=100*this.persona.speedMul:this.mood==="engage"?u=74*this.persona.speedMul:this.mood==="hunt"?u=60*this.persona.speedMul:this.mood==="hide"?u=38:this.mood==="defend"&&(u=52);const S=this.tmp.set(0,0,-1).applyQuaternion(this.quat);if(this.mood==="engage"||this.mood==="defend"){const P=this.tmp2.set(1,0,0).applyQuaternion(this.quat);S.addScaledVector(P,this.strafeSign*.38*this.persona.aggression),this.jukeTimer<=0&&(this.strafeSign*=-1,this.jukeTimer=.55+Math.random()*.95),S.normalize()}const w=this.mood==="flee"?2.6:1.75;this.velocity.lerp(S.multiplyScalar(u),1-Math.exp(-w*t)),(this.mood==="hunt"||this.mood==="engage")&&(this.velocity.y+=Math.sin(performance.now()*.0022+this.orbitAngle*3)*14*t),o.addScaledVector(this.velocity,t),o.y=ce.clamp(o.y,i+4,r-8);const v=n*.88;if(o.x=ce.clamp(o.x,-v,v),o.z=ce.clamp(o.z,-v,v),(this.mood==="defend"||this.mood==="hide")&&this.state.shield>20&&this.state.health<55?this.state.shieldDeployed=!0:this.state.health>70&&(this.state.shieldDeployed=!1),this.pawn.setBoost(this.mood==="flee"||this.mood==="engage"?.85:.35),this.pawn.setShield(this.state.shieldDeployed),c&&(this.mood==="engage"||this.mood==="defend"||this.mood==="hunt")){const P=this.persona.type==="sniper"?200:150;h<P&&this.fireCd<=0&&this.hasRoughLos(o,c)&&this.tryShot(o,c,h,a)}this.mood==="hide"&&c&&h<100&&this.fireCd<=0&&Math.random()<.15&&this.tryShot(o,c,h,a),this.writeState()}reassessMood(t,e,n){const i=this.state.health/100,r=this.targetId?1:0,a=.28+(1-this.persona.courage)*.35;if(i<a||i<.4&&this.lastDamaged>0){this.persona.type==="guardian"||Math.random()<.55?(this.mood="hide",this.pickHidePoint(t,e,n)):this.mood="flee",this.moodTimer=2.5+Math.random()*2;return}if(!(this.moodTimer>0&&(this.mood==="flee"||this.mood==="hide")&&!(i>a+.15))){if(!this.targetId){this.mood="hunt";return}this.persona.aggression>.75&&i>.45?this.mood="engage":this.persona.type==="guardian"||this.persona.type==="sniper"?this.mood=Math.random()<.4?"defend":"engage":this.persona.aggression<.5&&i<.6?this.mood=Math.random()<.5?"defend":"engage":this.mood=r?"engage":"hunt",this.moodTimer=1.2+Math.random()*1.5}}pickHidePoint(t,e,n){const r=Math.floor((Math.random()-.5)*(t/30)*.7),a=Math.floor((Math.random()-.5)*(t/30)*.7);this.hidePoint.set(r*30+8,e+12+Math.random()*(n-e)*.35,a*30+8)}computeFlee(t,e,n,i,r,a){e?t.copy(n).sub(e).normalize():t.set(Math.sin(this.orbitAngle),.3,Math.cos(this.orbitAngle));const o=this.persona.type==="skirmisher"||Math.random()<.5?1:-.6;t.y=o,t.normalize(),t.multiplyScalar(80).add(n),t.x+=Math.sign(n.x||1)*40,t.z+=Math.sign(n.z||1)*40,t.y=ce.clamp(t.y,r+10,a-15),t.x=ce.clamp(t.x,-i*.8,i*.8),t.z=ce.clamp(t.z,-i*.8,i*.8)}computeDefend(t,e,n){this.orbitAngle+=.02;const i=e||this.tmp.set(0,n.y,0),r=this.persona.preferredRange*.7;t.set(i.x+Math.cos(this.orbitAngle)*r,(e?e.y:n.y)+Math.sin(this.orbitAngle*2)*18,i.z+Math.sin(this.orbitAngle)*r)}computeEngage(t,e,n,i){if(!e){t.copy(n);return}const r=this.persona.preferredRange,a=this.tmp.copy(n).sub(e);if(a.lengthSq()<1&&a.set(1,0,0),a.normalize(),i>r+25)t.copy(e),t.y+=(Math.random()-.4)*30,t.addScaledVector(a,-12);else if(i<r-20)t.copy(n).addScaledVector(a,40),t.y+=this.strafeSign*25;else{const o=this.tmp.set(a.z,0,-a.x).normalize();t.copy(e).addScaledVector(o,this.strafeSign*r*.5),t.y=e.y+Math.sin(performance.now()*.0015+this.orbitAngle)*20}}computeHunt(t,e,n,i,r,a){if(e){t.copy(e),t.y+=10,t.x+=Math.sin(performance.now()*8e-4+this.orbitAngle)*25,t.z+=Math.cos(performance.now()*8e-4+this.orbitAngle)*25;return}this.orbitAngle+=.01,t.set(Math.sin(this.orbitAngle*.7)*i*.45,r+30+Math.abs(Math.sin(this.orbitAngle))*(a-r)*.4,Math.cos(this.orbitAngle*.55)*i*.45)}hasRoughLos(t,e){return!0}tryShot(t,e,n,i){const r=this.tmp.copy(e).sub(t).normalize(),a=n/155,o=(1-this.persona.accuracy)*.2;r.x+=(Math.random()-.5)*o,r.y+=(Math.random()-.5)*o*.7+a*.025,r.z+=(Math.random()-.5)*o,r.normalize();let l="plasma";this.persona.type==="sniper"&&n>80?l=Math.random()<.5?"rail":"laser":this.persona.type==="berserker"&&n<50?l=Math.random()<.4?"scatter":"plasma":n>100?l=Math.random()<.45?"rail":"laser":n>55?l=Math.random()<.35?"rocket":n>70?"torpedo":"plasma":l=Math.random()<.3?"scatter":"plasma";const c=t.clone().addScaledVector(r,2.5);i(c,r,l),this.fireCd=l==="plasma"?.24:l==="laser"?.11:l==="scatter"?.48:l==="rocket"?1.15:l==="torpedo"?1.85:1.55}pickTarget(t){let e=null,n=-1/0;const i=this.pawn.group.position;for(const r of t){if(r.id===this.state.id||!r.alive||this.state.team!==0&&r.team===this.state.team)continue;let o=1e3-Math.sqrt(i.distanceToSquared(this.tmp.fromArray(r.position)));o+=(100-r.health)*.35,r.shieldDeployed&&(o-=40),r.id===this.targetId&&(o+=90),o+=(Math.random()-.5)*55,o>n&&(n=o,e=r)}this.targetId=e?.id??null}takeDamage(t){if(!this.state.alive)return!1;if(this.lastDamaged=1.5,this.state.shieldDeployed)t*=.2;else if(this.state.shield>0){const e=Math.min(this.state.shield,t);this.state.shield-=e,t-=e}return this.state.health-=t,this.state.health<40*(1.2-this.persona.courage)&&(this.mood=Math.random()<.5?"flee":"hide",this.moodTimer=2,this.thinkTimer=0),this.state.health<=0?(this.state.health=0,this.state.alive=!1,this.state.deaths++,!0):!1}respawn(t){this.state.alive=!0,this.state.health=100,this.state.shield=100,this.state.shieldDeployed=!1,t.toArray(this.state.position),this.velocity.set(0,0,0),this.mood="hunt",this.targetId=null,this.syncFromState(),this.pawn.group.visible=!0}dispose(){this.pawn.dispose()}}class $m{scene;pool=[];active=[];sparks=[];sparkPool=[];constructor(t){this.scene=t;for(let e=0;e<28;e++){const n=new it(new be(1,8,8),new St({color:16737826,transparent:!0,opacity:.9,depthWrite:!1}));n.visible=!1,t.add(n),this.pool.push({mesh:n,life:0,maxLife:.4})}for(let e=0;e<64;e++){const n=new it(new oe(.25,.25,.25),new St({color:16770406,transparent:!0,opacity:1,depthWrite:!1}));n.visible=!1,t.add(n),this.sparkPool.push({mesh:n,vel:new R,life:0})}}explode(t,e=1,n=16737826){const i=this.pool.pop()||this.active.shift();i&&(i.mesh.visible=!0,i.mesh.position.copy(t),i.mesh.scale.setScalar(.5*e),i.mesh.material.color.setHex(n),i.mesh.material.opacity=.95,i.life=.45,i.maxLife=.45,this.active.push(i),this.burstSparks(t,n,Math.min(14,6+Math.floor(e*4))))}hitSpark(t,e=61695){this.burstSparks(t,e,6);const n=this.pool.pop();n&&(n.mesh.visible=!0,n.mesh.position.copy(t),n.mesh.scale.setScalar(.35),n.mesh.material.color.setHex(e),n.mesh.material.opacity=.9,n.life=.18,n.maxLife=.18,this.active.push(n))}burstSparks(t,e,n){for(let i=0;i<n;i++){const r=this.sparkPool.pop();if(!r)break;r.mesh.visible=!0,r.mesh.position.copy(t),r.mesh.material.color.setHex(e),r.mesh.material.opacity=1,r.vel.set(Math.random()-.5,Math.random()-.2,Math.random()-.5).normalize().multiplyScalar(12+Math.random()*28),r.life=.25+Math.random()*.25,this.sparks.push(r)}}update(t){for(let e=this.active.length-1;e>=0;e--){const n=this.active[e];n.life-=t;const i=1-n.life/n.maxLife;n.mesh.scale.setScalar((.5+i*4)*(n.maxLife<.25?.6:1)),n.mesh.material.opacity=Math.max(0,1-i),n.life<=0&&(n.mesh.visible=!1,this.active.splice(e,1),this.pool.push(n))}for(let e=this.sparks.length-1;e>=0;e--){const n=this.sparks[e];n.life-=t,n.mesh.position.addScaledVector(n.vel,t),n.vel.y-=18*t,n.mesh.scale.setScalar(Math.max(.1,n.life*3)),n.mesh.material.opacity=Math.max(0,n.life*3),n.life<=0&&(n.mesh.visible=!1,this.sparks.splice(e,1),this.sparkPool.push(n))}}dispose(){for(const t of[...this.pool,...this.active])this.scene.remove(t.mesh),t.mesh.geometry.dispose(),t.mesh.material.dispose();for(const t of[...this.sparkPool,...this.sparks])this.scene.remove(t.mesh),t.mesh.geometry.dispose(),t.mesh.material.dispose()}}class Km{layer;pool=[];active=[];tmp=new R;constructor(t="dmg-floats"){let e=document.getElementById(t);if(!e){e=document.createElement("div"),e.id=t;const n=document.getElementById("hud");n?n.appendChild(e):document.body.appendChild(e)}this.layer=e;for(let n=0;n<40;n++){const i=document.createElement("div");i.className="dmg-float hidden",this.layer.appendChild(i),this.pool.push(i)}}spawn(t,e,n="deal"){const i=Math.max(1,Math.round(e));if(i<=0&&n!=="kill")return;const r=this.acquireEl();r&&(r.className=`dmg-float dmg-${n}`,n==="kill"?r.textContent="DOWNED":n==="heal"?r.textContent=`+${i}`:r.textContent=`−${i}`,r.classList.remove("hidden"),this.active.push({el:r,world:t.clone(),life:n==="kill"?1.1:.85,maxLife:n==="kill"?1.1:.85,vy:28+Math.random()*18,jitterX:(Math.random()-.5)*24}))}acquireEl(){const t=this.pool.pop();if(t)return t;const e=this.active.shift();return e?(e.el.className="dmg-float hidden",e.el.style.opacity="0",e.el):null}update(t,e,n,i){for(let r=this.active.length-1;r>=0;r--){const a=this.active[r];if(a.life-=t,a.world.y+=a.vy*t*.02,this.tmp.copy(a.world).project(e),!(this.tmp.z>-1&&this.tmp.z<1&&Math.abs(this.tmp.x)<1.2&&Math.abs(this.tmp.y)<1.2)||a.life<=0){this.active.splice(r,1),a.el.className="dmg-float hidden",a.el.style.opacity="0",this.pool.push(a.el);continue}const l=(this.tmp.x*.5+.5)*n+a.jitterX,c=(-this.tmp.y*.5+.5)*i,h=1-a.life/a.maxLife,d=h*36,f=a.el.classList.contains("dmg-crit")||a.el.classList.contains("dmg-kill"),p=(f?1.25:1)*(1+(f?.12*(1-h):0)),g=h<.15?h/.15:Math.max(0,1-(h-.15)/.85);a.el.style.transform=`translate(-50%, -50%) translate(${l}px, ${c-d}px) scale(${p})`,a.el.style.opacity=String(g)}}clear(){for(;this.active.length;){const t=this.active.pop();t.el.className="dmg-float hidden",t.el.style.opacity="0",this.pool.push(t.el)}}}class jm{els={hud:document.getElementById("hud"),alt:document.getElementById("hud-alt"),speed:document.getElementById("hud-speed"),time:document.getElementById("hud-time"),weapon:document.getElementById("hud-weapon"),ammo:document.getElementById("hud-ammo"),leaders:document.getElementById("hud-leaders"),health:document.getElementById("bar-health"),healthN:document.getElementById("bar-health-n"),shield:document.getElementById("bar-shield"),shieldN:document.getElementById("bar-shield-n"),burn:document.getElementById("bar-burn"),burnN:document.getElementById("bar-burn-n"),shieldPrompt:document.getElementById("shield-prompt"),hitMarker:document.getElementById("hit-marker"),killFeed:document.getElementById("kill-feed"),modeBanner:document.getElementById("mode-banner"),help:document.getElementById("help-card"),scoreboard:document.getElementById("scoreboard"),sbBody:document.getElementById("sb-body"),death:document.getElementById("death"),deathSub:document.getElementById("death-sub"),damageVignette:document.getElementById("damage-vignette"),clickToPlay:document.getElementById("click-to-play"),ctpTitle:document.getElementById("ctp-title"),ctpSub:document.getElementById("ctp-sub"),ctpHint:document.getElementById("ctp-hint"),radar:document.getElementById("radar-canvas"),debug:document.getElementById("debug-panel"),debugText:document.getElementById("debug-text"),biomeToast:document.getElementById("biome-toast"),lockBox:document.getElementById("missile-lock"),lockLabel:document.getElementById("missile-lock-label"),lockFill:document.getElementById("missile-lock-fill")};radarCtx;helpVisible=!0;debugVisible=!1;constructor(){this.radarCtx=this.els.radar.getContext("2d")}show(t){this.els.hud.classList.toggle("hidden",!t),t&&this.els.help.classList.toggle("hidden",!this.helpVisible)}setClickToPlay(t,e="pause"){this.els.clickToPlay.classList.toggle("hidden",!t),this.els.clickToPlay.classList.toggle("mode-engage",e==="engage"),this.els.clickToPlay.classList.toggle("mode-pause",e==="pause");const n=document.getElementById("btn-resume"),i=document.getElementById("ctp-keys");if(this.els.ctpTitle&&(this.els.ctpTitle.textContent=e==="engage"?"CLICK TO ENGAGE":"PAUSED"),this.els.ctpSub&&(this.els.ctpSub.textContent=e==="engage"?"Click or Enter to take the stick":"Esc resume · Settings · Main Menu"),n&&(n.textContent=e==="engage"?"CLICK TO FLY":"RESUME"),i&&(i.textContent=e==="engage"?"Enter / Click · WASD fly · LMB fire · Esc pause · M mute":"Enter / Click Resume · Esc resume · M mute · Settings / Menu below"),t)try{n?.focus({preventScroll:!0})}catch{try{this.els.clickToPlay.focus({preventScroll:!0})}catch{}}}isPauseOpen(){return!this.els.clickToPlay.classList.contains("hidden")}setEngageHint(t){this.els.ctpHint&&(this.els.ctpHint.textContent=t??"",this.els.ctpHint.classList.toggle("hidden",!t))}setModeBanner(t){this.els.modeBanner.textContent=t}toggleHelp(){this.helpVisible=!this.helpVisible,this.els.help.classList.toggle("hidden",!this.helpVisible)}toggleDebug(){return this.debugVisible=!this.debugVisible,this.els.debug?.classList.toggle("hidden",!this.debugVisible),this.debugVisible}setDebugVisible(t){this.debugVisible=t,this.els.debug?.classList.toggle("hidden",!t)}isDebugVisible(){return this.debugVisible}updateDebug(t){!this.els.debugText||!this.debugVisible||(this.els.debugText.textContent=t.join(`
`))}showBiomeToast(t){this.flashToast(`ENTERING  ${t}`,this.els.biomeToast)}showPickupToast(t){this.flashToast(t,this.els.biomeToast)}flashToast(t,e){e&&(e.textContent=t,e.classList.remove("hidden","fade"),e.offsetWidth,e.classList.add("show"),window.setTimeout(()=>{e.classList.add("fade"),window.setTimeout(()=>e.classList.add("hidden"),600)},1600))}showScoreboard(t,e,n){if(this.els.scoreboard.classList.toggle("hidden",!t),!t)return;const i=[...e].sort((r,a)=>a.score-r.score||a.kills-r.kills);this.els.sbBody.innerHTML=i.map((r,a)=>`<tr${r.id===n?' class="me"':""}><td>${a+1}</td><td>${ml(r.callsign)}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.score}</td><td>${r.ping}</td></tr>`).join("")}showDeath(t,e="Respawning…"){this.els.death.classList.toggle("hidden",!t),this.els.deathSub.textContent=e}flashHit(){this.els.hitMarker.classList.remove("hidden","show"),this.els.hitMarker.offsetWidth,this.els.hitMarker.classList.add("show"),setTimeout(()=>this.els.hitMarker.classList.add("hidden"),180)}flashDamage(){this.els.damageVignette.classList.add("flash"),setTimeout(()=>this.els.damageVignette.classList.remove("flash"),160)}pushKill(t,e,n){const i=document.createElement("div");for(i.className="kill-line",i.textContent=`${t}  [${n}]  ${e}`,this.els.killFeed.prepend(i);this.els.killFeed.children.length>5;)this.els.killFeed.lastChild?.remove();setTimeout(()=>i.remove(),5e3)}updateFlight(t,e,n,i,r,a,o){this.els.alt.innerHTML=`${pl(Math.round(t))}<span class="unit">m</span>`;const l=Math.round(e*3.6);this.els.speed.innerHTML=`${pl(l)}<span class="unit">km/h</span>`,this.els.time.textContent=Zm(n),this.els.health.style.width=`${Dr(r/100)*100}%`,this.els.healthN.textContent=String(Math.round(r)),this.els.shield.style.width=`${Dr(a/100)*100}%`,this.els.shieldN.textContent=String(Math.round(a)),this.els.burn.style.width=`${Dr(i/100)*100}%`,this.els.burnN.textContent=String(Math.round(i)),this.els.shieldPrompt.classList.toggle("hidden",!o)}updateWeapon(t,e){const n=Ne[t];this.els.weapon.textContent=n.name,this.els.ammo.textContent=e<0?"∞":String(e)}updateMissileLock(t,e,n,i){const r=this.els.lockBox;if(r){if(!t||e==="off"){r.classList.add("hidden"),r.classList.remove("locking","locked","seeking");return}if(r.classList.remove("hidden"),r.classList.toggle("seeking",e==="seeking"),r.classList.toggle("locking",e==="locking"),r.classList.toggle("locked",e==="locked"),this.els.lockFill){const a=Math.round(Math.max(0,Math.min(1,n))*100);this.els.lockFill.style.width=`${a}%`}this.els.lockLabel&&(this.els.lockLabel.textContent=e==="locked"?"LOCK":e==="locking"?"LOCKING…":"SEEK"),i?(r.style.left=`${i.x}px`,r.style.top=`${i.y}px`,r.style.transform="translate(-50%, -50%)"):(r.style.left="50%",r.style.top="48%",r.style.transform="translate(-50%, -50%)")}}updateLeaders(t,e){const n=[...t].sort((i,r)=>r.score-i.score||r.kills-i.kills).slice(0,4);this.els.leaders.innerHTML=n.map((i,r)=>`<div class="${i.id===e?"me":""}">${r+1}. ${ml(i.callsign)}  ${i.score}</div>`).join("")}drawRadar(t,e,n,i){const r=this.radarCtx,a=this.els.radar.width,o=this.els.radar.height,l=a/2,c=o/2,h=a/2-4;r.clearRect(0,0,a,o),r.fillStyle="rgba(0, 20, 40, 0.75)",r.beginPath(),r.arc(l,c,h,0,Math.PI*2),r.fill(),r.strokeStyle="rgba(0, 240, 255, 0.45)",r.lineWidth=1.5,r.stroke(),r.strokeStyle="rgba(0, 240, 255, 0.15)";for(const p of[.33,.66])r.beginPath(),r.arc(l,c,h*p,0,Math.PI*2),r.stroke();r.strokeStyle="rgba(0, 240, 255, 0.35)",r.beginPath(),r.moveTo(l,c),r.lineTo(l,c-h),r.stroke();const d=Math.cos(-e),f=Math.sin(-e);for(const p of n){let g=p.x-t.x,_=p.z-t.z;const m=g*d-_*f,u=g*f+_*d;let S=m/i*h,w=-u/i*h;const v=Math.hypot(S,w);v>h-3&&(S=S/v*(h-3),w=w/v*(h-3)),r.fillStyle=p.isPlayer?"#00f0ff":p.friendly?"#39ff88":"#ff2bd6",r.beginPath(),r.arc(l+S,c+w,p.isPlayer?3.5:2.5,0,Math.PI*2),r.fill()}}}function pl(s){return String(Math.max(0,s)).padStart(3,"0")}function Zm(s){const t=Math.max(0,Math.floor(s)),e=Math.floor(t/60),n=t%60;return`${String(e).padStart(2,"0")}:${String(n).padStart(2,"0")}`}function Dr(s){return Math.max(0,Math.min(1,s))}function ml(s){return s.replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}const Ur=["VEX-9","NULLSTAR","KITE","PHANTOM","RYU-0","GHOSTLINE","HEXA","ORBIT","SAKURA","DRIFT","NOVA","REDLINE","ASH-7","VECTOR","MIRAGE","ION","WRAITH","PULSE"];class Jm{localId="local";players=new Map;pilotBase=12;async connect(t){this.players.clear(),this.players.set(this.localId,this.makePlayer(this.localId,t||"PILOT",!1,0)),this.pilotBase=10+Math.floor(Math.random()*18)}disconnect(){this.players.clear()}spawnBots(t,e){for(const[n,i]of this.players)i.isBot&&this.players.delete(n);for(let n=0;n<t;n++){const i=`bot-${n}`,r=e?n%2+1:0,a=Ur[n%Ur.length]+(n>=Ur.length?`-${n}`:"");this.players.set(i,this.makePlayer(i,a,!0,r))}}getPlayers(){return[...this.players.values()]}getLocal(){return this.players.get(this.localId)}getPlayer(t){return this.players.get(t)}pushLocal(t){const e=this.players.get(this.localId);e&&Object.assign(e,t)}updatePlayer(t,e){const n=this.players.get(t);n&&Object.assign(n,e)}onKill(t){const e=this.players.get(t.killerId),n=this.players.get(t.victimId);e&&(e.kills++,e.score+=100),n&&(n.deaths++,n.alive=!1,n.health=0)}getPilotCount(){return this.pilotBase+this.players.size}tick(t){for(const e of this.players.values())e.isBot?e.ping=20+Math.floor(Math.random()*40):e.ping=12+Math.floor(Math.random()*8)}makePlayer(t,e,n,i){return{id:t,callsign:e,team:i,position:[0,40,0],rotation:[0,0,0,1],velocity:[0,0,0],health:100,shield:100,shieldDeployed:!1,weapon:"plasma",kills:0,deaths:0,score:0,alive:!0,isBot:n,ping:n?30:15}}}class Qm{root=document.getElementById("menu");callsign=document.getElementById("callsign");pilotCount=document.getElementById("pilot-count");status=document.getElementById("menu-status");mapId="sky-city";onStart=null;onSettings=null;starting=!1;constructor(){const t=localStorage.getItem("neonveil_callsign");t&&(this.callsign.value=t),document.querySelectorAll(".mode-btn[data-mode]").forEach(i=>{i.addEventListener("click",()=>{const r=i.dataset.mode;this.start(r)})}),document.querySelectorAll(".map-pill").forEach(i=>{i.addEventListener("click",()=>{document.querySelectorAll(".map-pill").forEach(r=>r.classList.remove("active")),i.classList.add("active"),this.mapId=i.dataset.map})}),document.getElementById("btn-settings-menu")?.addEventListener("click",()=>{this.onSettings?.()});const e=1+Ys.botCount,n=()=>{const i=e+Math.floor(Math.random()*3)-1;this.pilotCount.textContent=String(Math.max(e-1,i))};setInterval(n,4e3),n(),this.setStatus(`SELECT A MODE · FFA ${1+Ys.botCount}/SECTOR · ROAM ${1+Jl.rivalCount}/SECTOR · 2× ARENAS · RINGS = TRAVEL`)}onStartGame(t){this.onStart=t}onOpenSettings(t){this.onSettings=t}show(t){this.root.classList.toggle("hidden",!t),t&&(this.starting=!1)}setStatus(t){this.status&&(this.status.textContent=t)}start(t){if(this.starting)return;if(!this.onStart){this.setStatus("ENGINE NOT READY — REFRESH PAGE");return}this.starting=!0;const e=(this.callsign.value.trim()||"PILOT").slice(0,16).toUpperCase();localStorage.setItem("neonveil_callsign",e),this.setStatus(`LAUNCHING ${t.toUpperCase()}…`),this.onStart({callsign:e,mode:t,mapId:this.mapId})}}class tg{root=document.getElementById("settings");sens=document.getElementById("set-sens");vol=document.getElementById("set-vol");invert=document.getElementById("set-invert");mute=document.getElementById("set-mute");onChange=null;constructor(t){this.sens.value=String(t.mouseSens),this.vol.value=String(t.volume),this.invert.checked=t.invertY,this.mute.checked=t.mute;const e=()=>{this.onChange?.(this.read())};this.sens.addEventListener("input",e),this.vol.addEventListener("input",e),this.invert.addEventListener("change",e),this.mute.addEventListener("change",e),document.getElementById("btn-settings-close")?.addEventListener("click",()=>this.show(!1))}onSettingsChange(t){this.onChange=t}read(){return{mouseSens:parseFloat(this.sens.value)||1,volume:parseFloat(this.vol.value)||0,invertY:this.invert.checked,mute:this.mute.checked}}setMute(t){this.mute.checked=t}show(t){this.root.classList.toggle("hidden",!t)}toggle(){this.show(this.root.classList.contains("hidden"))}}class eg{root=document.getElementById("results");title=document.getElementById("results-title");stats=document.getElementById("results-stats");onMenu=null;constructor(){document.getElementById("btn-results-menu")?.addEventListener("click",()=>{this.show(!1),this.onMenu?.()})}onReturn(t){this.onMenu=t}showResults(t,e){this.title.textContent=t,this.stats.innerHTML=e.map(n=>`<div>${n}</div>`).join(""),this.show(!0)}show(t){this.root.classList.toggle("hidden",!t)}}class ng{root=document.getElementById("loading");fill=document.getElementById("loading-fill");text=document.getElementById("loading-text");show(t){this.root.classList.toggle("hidden",!t)}set(t,e){this.fill.style.width=`${Math.round(t*100)}%`,this.text.textContent=e}}class ig{canvas;renderer;scene=new xm;camera;clock=new Cm;input;settings={...cl};menu=new Qm;settingsUI;results=new eg;loading=new ng;hud=new jm;audio;net=new Jm;map;flight=new Dm;localPawn;weapons;missileLock=new Fm;shield=new Om;effects;dmgFloats=new Km;bots=[];pickups=new qm;biomeInstances=new Map;mode="freeroam";mapId="sky-city";playing=!1;matchTime=0;matchLimit=0;lives=Je.lives;outlawRound=0;outlawKillsNeeded=0;outlawKills=0;respawnTimer=-1;dead=!1;scoreboardOpen=!1;tmpV=new R;tmpV2=new R;tmpQ=new Nn;aimOrigin=new R;aimDir=new R;collNormal=new R;prevWeaponKeys=new Set;frame=0;portalCooldown=0;traveling=!1;fpsAccum=0;fpsFrames=0;fps=0;_f3Latch=!1;_hLatch=!1;_escLatch=!1;_mLatch=!1;pauseMode="engage";mirrorLeftCam;mirrorRightCam;mirrorLeftRT;mirrorRightRT;mirrorLeftCanvas;mirrorRightCanvas;mirrorLeftCtx;mirrorRightCtx;mirrorBuf=new Uint8Array(128*96*4);constructor(){if(this.canvas=document.getElementById("game-canvas"),!this.canvas)throw new Error("Missing #game-canvas");try{this.renderer=new vm({canvas:this.canvas,antialias:!0,powerPreference:"high-performance"})}catch(n){throw new Error(`WebGL init failed: ${n instanceof Error?n.message:String(n)}`)}this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75)),this.renderer.setSize(window.innerWidth,window.innerHeight),this.renderer.outputColorSpace=Oe,this.renderer.toneMapping=vl,this.renderer.toneMappingExposure=1.05,this.camera=new Le(le.fovNormal,window.innerWidth/window.innerHeight,.1,2e3),this.input=new Pm(this.canvas),this.audio=new Im(this.settings),this.settingsUI=new tg(this.settings),this.map=new Wm(this.scene,"sky-city"),this.localPawn=new Ql(61695,!0),this.scene.add(this.localPawn.group),this.weapons=new Nm(this.scene),this.effects=new $m(this.scene),this.scene.add(this.pickups.group),this.mirrorLeftCam=new Le(50,4/3,.5,400),this.mirrorRightCam=new Le(50,4/3,.5,400),this.mirrorLeftRT=new Mn(128,96),this.mirrorRightRT=new Mn(128,96),this.mirrorLeftCanvas=document.createElement("canvas"),this.mirrorLeftCanvas.width=128,this.mirrorLeftCanvas.height=96,this.mirrorRightCanvas=document.createElement("canvas"),this.mirrorRightCanvas.width=128,this.mirrorRightCanvas.height=96;const t=document.getElementById("mirror-left"),e=document.getElementById("mirror-right");t&&t.appendChild(this.mirrorLeftCanvas),e&&e.appendChild(this.mirrorRightCanvas),this.mirrorLeftCtx=this.mirrorLeftCanvas.getContext("2d"),this.mirrorRightCtx=this.mirrorRightCanvas.getContext("2d"),this.bindUI(),window.addEventListener("resize",this.onResize),this.menu.show(!0),this.menu.setStatus("SELECT A MODE TO LAUNCH"),this.animate(),requestAnimationFrame(()=>{requestAnimationFrame(()=>{try{this.map.load("sky-city")}catch(n){console.warn("[NEON VEIL] warmup map load failed",n)}})})}bindUI(){this.menu.onStartGame(i=>void this.startSession(i)),this.menu.onOpenSettings(()=>this.settingsUI.show(!0)),this.settingsUI.onSettingsChange(i=>{this.settings=i,this.audio.applySettings(i),localStorage.setItem("neonveil_settings",JSON.stringify(i))}),this.results.onReturn(()=>this.returnToMenu());const t=localStorage.getItem("neonveil_settings");if(t)try{this.settings={...cl,...JSON.parse(t)},this.audio.applySettings(this.settings)}catch{}const e=()=>this.resumeFromPause();document.getElementById("btn-resume")?.addEventListener("click",i=>{i.preventDefault(),i.stopPropagation(),e()}),document.getElementById("btn-pause-settings")?.addEventListener("click",i=>{i.preventDefault(),i.stopPropagation(),this.settingsUI.show(!0)}),document.getElementById("btn-pause-menu")?.addEventListener("click",i=>{i.preventDefault(),i.stopPropagation(),this.hud.setClickToPlay(!1),this.returnToMenu()}),document.getElementById("click-to-play")?.addEventListener("keydown",i=>{(i.code==="Enter"||i.code==="Space")&&(i.preventDefault(),e())}),this.wireForgeFlowShell()}wireForgeFlowShell(){const t=window;t.__PAUSE__={toggle:()=>{this.playing&&(this.hud.isPauseOpen()?this.resumeFromPause():this.openPauseMenu("pause"))},pause:()=>{this.playing&&!this.hud.isPauseOpen()&&this.openPauseMenu("pause")},resume:()=>{this.playing&&this.hud.isPauseOpen()&&this.resumeFromPause()}},window.addEventListener("mutechange",e=>{const n=!!(e.detail&&e.detail.muted);this.settings={...this.settings,mute:n},this.settingsUI.setMute(n),this.audio.applySettings(this.settings);try{localStorage.setItem("neonveil_settings",JSON.stringify(this.settings))}catch{}});try{window.__CONTROLS__?.isMuted?.()&&(this.settings={...this.settings,mute:!0},this.settingsUI.setMute(!0),this.audio.applySettings(this.settings))}catch{}}resumeFromPause(){this.audio.unlock(),this.input.engage(),this.hud.setClickToPlay(!1),this.hud.setEngageHint(this.input.lockError),this.settingsUI.show(!1)}openPauseMenu(t="pause"){this.pauseMode=t,this.input.disengage(),this.settingsUI.show(!1),this.hud.setClickToPlay(!0,t)}async startSession(t){this.mode=t.mode,this.mapId=t.mapId,this.menu.show(!1),this.results.show(!1),this.loading.show(!0),this.loading.set(.08,"Linking thrusters…");try{await Yi(),await this.net.connect(t.callsign),this.loading.set(.25,"Building neon skyline…"),await Yi(),this.biomeInstances.clear(),this.clearBots(),this.map.load(t.mapId),this.audio.setBiomeMusic(t.mapId),this.pickups.spawnForMap(this.map.def.bounds,Pn.mapCount),this.loading.set(.65,"Calibrating weapons…"),await Yi(),this.populateBiomeInstance(t.mapId,!0);const e=this.map.randomSpawn();this.flight.reset(e,Math.random()*Math.PI*2),this.shield.reset(),this.weapons.unlocked=new Set(["plasma"]),this.weapons.ammo.laser=0,this.weapons.ammo.torpedo=0,this.weapons.ammo.scatter=0,this.weapons.refill(),this.weapons.select("plasma"),this.dead=!1,this.respawnTimer=-1,this.matchTime=0,this.lives=Je.lives,this.outlawRound=0,this.outlawKills=0,t.mode==="multiplayer"?(this.matchLimit=Ys.matchTime,this.hud.setModeBanner(`FFA · ${this.alivePilotCount()} IN THIS SECTOR · RINGS = OTHER SECTORS`)):t.mode==="outlaw"?(this.matchLimit=Je.roundTime,this.outlawKillsNeeded=Je.targetsPerRound[0],this.hud.setModeBanner(`OUTLAW HUNT · ROUND 1/${Je.rounds}`)):(this.matchLimit=0,this.hud.setModeBanner(`FREE ROAM · ${this.alivePilotCount()} HERE · RINGS TRAVEL TO OTHER SECTORS`)),this.net.pushLocal({callsign:t.callsign,alive:!0,health:de.maxHealth,shield:de.maxShield,kills:0,deaths:0,score:0}),this.loading.set(1,"Ready"),await Nr(200),this.loading.show(!1),this.playing=!0,this.input.disengage(),this.hud.show(!0),this.openPauseMenu("engage"),this.hud.setEngageHint(null),this.clock.start()}catch(e){console.error("[NEON VEIL] startSession failed",e),this.loading.set(0,"Launch fault — returning to menu"),await Nr(900),this.loading.show(!1),this.playing=!1,this.hud.show(!1),this.menu.show(!0);const n=e instanceof Error?e.message:String(e);this.menu.setStatus(`LAUNCH FAILED: ${n}`)}}returnToMenu(){this.playing=!1,this.hud.show(!1),this.hud.showDeath(!1),this.hud.setClickToPlay(!1),this.input.disengage(),this.stashCurrentBiome(),this.clearBots(),this.biomeInstances.clear(),this.menu.show(!0)}clearBots(){for(const t of this.bots)this.scene.remove(t.pawn.group),t.dispose();this.bots=[]}desiredRivalCount(){return this.mode==="multiplayer"?Ys.botCount:this.mode==="outlaw"?this.outlawKillsNeeded||Je.targetsPerRound[0]:Jl.rivalCount}alivePilotCount(){return 1+this.bots.filter(t=>t.state.alive).length}spawnBotPawns(){this.clearBots();const t=[16722902,16739115,3800968,16770406,11167487,43775,16746700,6750156];let e=0;for(const n of this.net.getPlayers()){if(!n.isBot)continue;const i=new fl(n,t[e%t.length],e),r=this.map.randomSpawn();i.respawn(r),this.scene.add(i.pawn.group),this.bots.push(i),e++}}stashCurrentBiome(){if(!this.mapId)return;const t=[16722902,16739115,3800968,16770406,11167487,43775,16746700,6750156],e=this.bots.map((n,i)=>{let r=t[i%t.length];const a=n.marker.children[0]?.material;return a?.color&&(r=a.color.getHex()),{callsign:n.state.callsign,color:r,personaIndex:i,position:[n.state.position[0],n.state.position[1],n.state.position[2]],health:n.state.health,shield:n.state.shield,kills:n.state.kills,deaths:n.state.deaths,score:n.state.score,alive:n.state.alive}});this.biomeInstances.set(this.mapId,{rivals:e,pickups:this.pickups.exportState()})}populateBiomeInstance(t,e){const n=e?void 0:this.biomeInstances.get(t),i=this.desiredRivalCount(),r=[16722902,16739115,3800968,16770406,11167487,43775,16746700,6750156];if(!n||n.rivals.length===0){this.net.spawnBots(i,!1),this.spawnBotPawns(),this.stashCurrentBiome();return}this.net.spawnBots(n.rivals.length,!1);const a=this.net.getPlayers().filter(o=>o.isBot);this.clearBots();for(let o=0;o<a.length;o++){const l=n.rivals[o],c=a[o];if(!l||!c)continue;c.callsign=l.callsign,c.health=l.health,c.shield=l.shield,c.kills=l.kills,c.deaths=l.deaths,c.score=l.score,c.alive=l.alive,c.position=[...l.position];const h=new fl(c,l.color||r[o%r.length],l.personaIndex);l.alive?(h.respawn(new R(...l.position)),h.state.health=l.health,h.state.shield=l.shield,h.state.kills=l.kills,h.state.deaths=l.deaths,h.state.score=l.score):(h.state.alive=!1,h.pawn.group.visible=!1),this.scene.add(h.pawn.group),this.bots.push(h)}if(this.bots.length<i&&this.mode!=="outlaw")this.net.spawnBots(i,!1),this.spawnBotPawns();else if(this.mode!=="outlaw")for(const o of this.bots)o.state.alive||o.respawn(this.map.randomSpawn());this.pickups.importState(n.pickups)}ensureRivalPopulation(){const t=this.desiredRivalCount();if(this.mode!=="outlaw"){for(const e of this.bots)e.state.alive||e.respawn(this.map.randomSpawn());this.bots.length<t&&(this.net.spawnBots(t,!1),this.spawnBotPawns())}}animate=()=>{requestAnimationFrame(this.animate);const t=Math.min(this.clock.getDelta(),.05);this.fpsAccum+=t,this.fpsFrames++,this.fpsAccum>=.4&&(this.fps=this.fpsFrames/this.fpsAccum,this.fpsAccum=0,this.fpsFrames=0),this.playing&&this.update(t),this.render()};update(t){if(this.handleUIKeys(),!this.dead&&!this.input.isControlActive()&&!this.hud.isPauseOpen()&&!this.traveling&&this.openPauseMenu(this.pauseMode==="engage"?"engage":"pause"),!this.dead&&this.input.isControlActive()&&this.input.lockError&&this.hud.setEngageHint(this.input.lockError),this.dead){this.respawnTimer-=t,this.hud.showDeath(!0,`Respawning in ${Math.ceil(Math.max(0,this.respawnTimer))}…`),this.respawnTimer<=0&&this.doRespawn(),this.weapons.update(t),this.effects.update(t),this.dmgFloats.update(t,this.camera,window.innerWidth,window.innerHeight),this.updateBots(t),this.syncLocalState(),this.updateHud(t),this.input.endFrame();return}const e=this.tmpV2.copy(this.flight.position);this.flight.update(t,this.input,this.settings,this.map.def.minAlt,this.map.def.maxAlt,this.map.def.bounds);const n=this.tmpV.copy(this.flight.position);this.flight.position.copy(e);const i=e.distanceTo(n),r=Math.max(1,Math.min(12,Math.ceil(i/1.25))),a=t/r;let o=0;for(let g=0;g<r;g++)this.flight.integrateSubstep(a),this.map.city.resolveSolid(this.flight.position,1.55,this.collNormal,5)&&(o=Math.max(o,this.flight.bounce(this.collNormal)));this.map.city.resolveSolid(this.flight.position,1.55,this.collNormal,4)&&(o=Math.max(o,this.flight.bounce(this.collNormal))),this.flight.clampWorld(this.map.def.minAlt,this.map.def.maxAlt,this.map.def.bounds),o>4&&(this.applyDamageToLocal(o,"world"),this.audio.playHit());const l=this.shield.update(t,this.input.isDown("KeyF"));l==="up"&&this.audio.playShieldUp(),l==="down"&&this.audio.playShieldDown(),this.localPawn.setShield(this.shield.deployed),this.input.wheel&&this.weapons.cycle(this.input.wheel>0?1:-1);for(const[g,_]of[["Digit1",1],["Digit2",2],["Digit3",3],["Digit4",4],["Digit5",5],["Digit6",6]])this.input.isDown(g)&&!this.prevWeaponKeys.has(g)&&this.weapons.trySelectSlot(_);this.prevWeaponKeys=new Set([...this.input.keys].filter(g=>g.startsWith("Digit")));const c=[...this.bots.map(g=>({id:g.state.id,position:g.pawn.group.position,alive:g.state.alive})),{id:this.net.localId,position:this.flight.position,alive:!this.dead&&this.net.getLocal().alive}];this.weapons.update(t,c),this.updateMissileLock(t),this.input.isMouseDown(0)&&this.input.isControlActive()&&this.tryPlayerFire(),this.pickups.update(t);const h=this.pickups.tryCollect(this.flight.position,Pn.collectRadius);h&&this.applyPickup(h),this.resolveProjectiles(),this.localPawn.setTransform(this.flight.position,this.flight.quaternion),this.localPawn.setBoost(this.flight.boosting?1:this.flight.speed/le.maxSpeed),this.localPawn.group.visible=!0;const d=this.flight.zooming?45:this.flight.boosting?le.fovBoost:le.fovNormal;this.camera.fov=ce.lerp(this.camera.fov,d,1-Math.exp(-8*t)),this.camera.updateProjectionMatrix(),this.camera.position.copy(this.flight.position),this.flight.getCameraQuaternion(this.tmpQ),this.camera.quaternion.copy(this.tmpQ),this.camera.position.addScaledVector(this.tmpV.set(0,.15,.1).applyQuaternion(this.camera.quaternion),1),this.audio.setEngineThrust(ce.clamp(this.flight.speed/le.maxSpeed,0,1),this.flight.boosting),this.syncLocalState(),this.updateBots(t),this.effects.update(t),this.dmgFloats.update(t,this.camera,window.innerWidth,window.innerHeight);const f=[{pos:this.flight.position,id:this.net.localId},...this.bots.filter(g=>g.state.alive).map(g=>({pos:g.pawn.group.position,id:g.state.id}))],p=this.map.update(t,f);for(const g of p)if(g.kind==="lightning"){let _=this.net.localId,m=this.flight.position.distanceToSquared(g.position);for(const u of this.bots){if(!u.state.alive)continue;const S=u.pawn.group.position.distanceToSquared(g.position);S<m&&(m=S,_=u.state.id)}if(_===this.net.localId&&m<400)this.applyDamageToLocal(g.damage,"world"),this.flight.applyStun(g.stun),this.hud.showPickupToast("LIGHTNING STRIKE!"),this.audio.playHit(),this.effects.hitSpark(this.flight.position,11193599);else{const u=this.bots.find(S=>S.state.id===_);u&&m<400&&(u.takeDamage(g.damage),this.effects.hitSpark(u.pawn.group.position,11193599))}}else if(g.kind==="meteor"){if(this.flight.position.distanceTo(g.position)<8)this.applyDamageToLocal(g.damage,"world"),this.flight.applyStun(g.stun),this.audio.playExplosion(),this.effects.explode(g.position,2,16737826);else for(const _ of this.bots)if(_.state.alive&&_.pawn.group.position.distanceTo(g.position)<8){const m=_.takeDamage(g.damage);this.effects.explode(g.position,2,16737826),m&&this.onKill("world",_.state.id,"rocket",_.pawn.group.position);break}}for(const g of this.map.atmosphere.getSolidSpheres())this.flight.position.distanceTo(g.pos)<g.radius+1.5&&(this.tmpV.copy(this.flight.position).sub(g.pos).normalize(),this.tmpV.lengthSq()<.01&&this.tmpV.set(0,1,0),this.collNormal.copy(this.tmpV),this.flight.position.addScaledVector(this.collNormal,g.radius+1.6-this.flight.position.distanceTo(g.pos)),this.flight.bounce(this.collNormal,.6));if(this.net.tick(t),this.portalCooldown=Math.max(0,this.portalCooldown-t),!this.traveling&&this.portalCooldown<=0&&!this.dead){const g=this.map.checkPortal(this.flight.position);g&&this.travelPortal(g.target,g.label)}this.matchTime+=t,this.updateModeLogic(),this.updateHud(t),this.input.endFrame()}async travelPortal(t,e){if(!(this.traveling||t===this.mapId)){this.traveling=!0,this.portalCooldown=3;try{this.hud.showBiomeToast(e),this.audio.playWarp(),this.loading.show(!0),this.loading.set(.15,"Leaving sector…"),await Yi(),this.stashCurrentBiome(),this.clearBots(),this.mapId=t,this.map.load(t),this.audio.setBiomeMusic(t),this.pickups.spawnForMap(this.map.def.bounds,Pn.mapCount),this.loading.set(.55,`Entering ${e} instance…`),await Yi(),this.populateBiomeInstance(t,!1);const n=this.map.randomSpawn();this.flight.reset(n,Math.random()*Math.PI*2),this.hud.setModeBanner(`${e} · ${this.alivePilotCount()} PILOTS IN THIS SECTOR`),this.loading.set(1,"Ready"),await Nr(180),this.loading.show(!1)}catch(n){console.error("[NEON VEIL] portal travel failed",n),this.loading.show(!1)}finally{this.traveling=!1,this.portalCooldown=2.5}}}handleUIKeys(){const t=e=>this.input.isDown(e);if(t("KeyH")&&!this._hLatch?(this.hud.toggleHelp(),this._hLatch=!0):t("KeyH")||(this._hLatch=!1),t("F3")&&!this._f3Latch?(this.hud.toggleDebug(),this._f3Latch=!0):t("F3")||(this._f3Latch=!1),this.scoreboardOpen=t("Tab")&&this.input.isControlActive(),this.hud.showScoreboard(this.scoreboardOpen&&this.playing,this.net.getPlayers(),this.net.localId),t("Escape")&&this.playing?this._escLatch||(this._escLatch=!0,!document.getElementById("settings")?.classList.contains("hidden")?this.settingsUI.show(!1):this.input.isControlActive()?this.openPauseMenu("pause"):this.hud.isPauseOpen()?this.pauseMode==="pause"?this.resumeFromPause():this.resumeFromPause():this.openPauseMenu("pause")):t("Escape")||(this._escLatch=!1),t("KeyM")&&!this._mLatch){this._mLatch=!0;const e=document.activeElement?.tagName;!!!window.__CONTROLS__?.toggleMute&&e!=="INPUT"&&e!=="TEXTAREA"&&this.toggleMuteLocal()}else t("KeyM")||(this._mLatch=!1)}toggleMuteLocal(){const t=!this.settings.mute;this.settings={...this.settings,mute:t},this.settingsUI.setMute(t),this.audio.applySettings(this.settings);try{localStorage.setItem("neonveil_settings",JSON.stringify(this.settings))}catch{}}updateMissileLock(t){const e=this.weapons.current==="rocket";this.flight.getAimDirection(this.aimDir),this.aimOrigin.copy(this.flight.position);const n=this.missileLock.update(t,e&&this.input.isControlActive()&&!this.dead,this.aimOrigin,this.aimDir,this.bots.map(r=>({id:r.state.id,position:r.pawn.group.position,alive:r.state.alive})),(r,a)=>this.map.city.lineOfSight(r,a));n==="tick"?this.audio.playLockTick(this.missileLock.progress):n==="locked"?this.audio.playLockTone():n==="lost"&&this.audio.playLockLost();let i=null;e&&this.missileLock.targetId&&(this.missileLock.phase==="locking"||this.missileLock.phase==="locked")&&(this.tmpV.copy(this.missileLock.targetPos).project(this.camera),this.tmpV.z>-1&&this.tmpV.z<1&&(i={x:(this.tmpV.x*.5+.5)*window.innerWidth,y:(-this.tmpV.y*.5+.5)*window.innerHeight})),this.hud.updateMissileLock(e&&this.input.isControlActive(),e?this.missileLock.phase:"off",this.missileLock.progress,i)}tryPlayerFire(){this.flight.getAimDirection(this.aimDir),this.applyAimAssist(this.aimDir),this.aimOrigin.copy(this.flight.position).addScaledVector(this.aimDir,2.2),this.aimOrigin.y-=.1;const t=this.weapons.current;if(t==="rocket"&&!this.missileLock.locked)return;const e=this.weapons.fire(this.net.localId,this.aimOrigin,this.aimDir,{lockTargetId:t==="rocket"||t==="torpedo"?this.missileLock.targetId:null,requireLock:t==="rocket"});if(e&&(t==="plasma"?this.audio.playPlasma():t==="rocket"||t==="torpedo"?this.audio.playRocket():t==="laser"?this.audio.playLaser():t==="scatter"?this.audio.playScatter():this.audio.playRail(),t==="rocket"&&(this.missileLock.reset(),this.hud.updateMissileLock(!0,"seeking",0,null)),e.hitscan))for(const n of e.hitscan)this.resolveHitscan(n.ownerId,n.origin,n.direction,n.damage,n.weapon)}applyPickup(t){const e=this.net.getLocal(),n=this.flight.position.clone();n.y+=2;const i=Pn.respawnSec;if(t.kind==="weapon"&&t.weapon){const r=t.weapon==="rocket"?Pn.rocketPickupAmmo:t.amount>1?t.amount:Ne[t.weapon].ammo;this.weapons.grantWeapon(t.weapon,r),this.hud.showPickupToast(`${t.label} · crate back in ${i}s`),this.audio.playPickup()}else t.kind==="health"?(e.health=Math.min(de.maxHealth,e.health+t.amount),this.hud.showPickupToast(`HULL +${t.amount} · crate ${i}s`),this.dmgFloats.spawn(n,t.amount,"heal"),this.audio.playPickup()):t.kind==="shield"?(this.shield.charge=Math.min(de.maxShield,this.shield.charge+t.amount),e.shield=this.shield.charge,this.hud.showPickupToast(`SHIELD +${t.amount} · crate ${i}s`),this.dmgFloats.spawn(n,t.amount,"heal"),this.audio.playPickup()):t.kind==="ammo"&&(this.weapons.grantAmmoAll(.6),this.hud.showPickupToast(`AMMO RELOAD · crate ${i}s`),this.audio.playPickup())}applyAimAssist(t){const e=de.aimAssistCone,n=de.aimAssistRange,i=de.aimAssist;let r=Math.cos(e),a=null;for(const o of this.bots){if(!o.state.alive)continue;this.tmpV.copy(o.pawn.group.position).sub(this.flight.position);const l=this.tmpV.length();if(l<4||l>n)continue;this.tmpV.multiplyScalar(1/l);const c=t.dot(this.tmpV);c>r&&(r=c,a=this.tmpV2.copy(this.tmpV))}a&&t.lerp(a,i).normalize()}resolveHitscan(t,e,n,i,r){let a=r==="laser"?280:400,o=null;for(const l of this.bots){if(!l.state.alive||l.state.id===t)continue;const c=this.rayHitSphere(e,n,l.pawn.group.position,de.enemyHitscanRadius);c>=0&&c<a&&(a=c,o=l)}if(t!==this.net.localId&&this.net.getLocal().alive){const l=this.rayHitSphere(e,n,this.flight.position,de.localHitRadius);l>=0&&l<a&&(a=l,o="local")}if(o==="local")this.applyDamageToLocal(i,t,r);else if(o){const l=o.pawn.group.position.clone();l.y+=1.5;const c=o.takeDamage(i);this.reportEnemyHit(t,i,l,r,c,o.state.id)}}reportEnemyHit(t,e,n,i,r,a){const o=e>=70||i==="rail"||i==="torpedo";t===this.net.localId&&(this.hud.flashHit(),this.dmgFloats.spawn(n,e,o?"crit":"deal"),this.effects.hitSpark(n,o?16770406:61695),o?this.audio.playCrit():this.audio.playHitConfirm()),r&&this.onKill(t,a,i,n)}rayHitSphere(t,e,n,i){const r=this.tmpV.copy(t).sub(n),a=r.dot(e),o=r.dot(r)-i*i,l=a*a-o;if(l<0)return-1;const c=-a-Math.sqrt(l);return c>=0?c:-1}resolveProjectiles(){for(const t of this.weapons.pool){if(!t.active)continue;if(this.map.city.collideSphere(t.position,.4,this.collNormal)||t.position.y<.5){this.detonateProjectile(t);continue}const e=de.enemyHitRadius+(t.weapon==="rocket"||t.weapon==="torpedo"?.35:0);for(const n of this.bots)if(!(!n.state.alive||n.state.id===t.ownerId)&&n.pawn.group.position.distanceTo(t.position)<e){this.detonateProjectile(t,n);break}t.active&&t.ownerId!==this.net.localId&&this.net.getLocal().alive&&this.flight.position.distanceTo(t.position)<de.localHitRadius&&this.detonateProjectile(t,"local")}}detonateProjectile(t,e){const n=t.position.clone(),i=t.weapon,r=t.ownerId,a=t.splash,o=t.damage,l=t.selfDamageScale;this.weapons.deactivate(t);const c=i==="rocket"||i==="torpedo"?16737826:i==="scatter"?16770406:61695;this.effects.explode(n,a>0?2.2:1.1,c),this.audio.playExplosion();const h=(d,f)=>{let p=o;if(a>0){const g=1-ce.clamp(f/a,0,1);p=o*g}if(!(p<1))if(d==="local")r===this.net.localId&&(p*=l),p>0&&this.applyDamageToLocal(p,r,i);else{if(r===d.state.id&&(p*=l),p<=0)return;const g=d.pawn.group.position.clone();g.y+=1.5;const _=d.takeDamage(p);this.reportEnemyHit(r,p,g,i,_,d.state.id)}};if(e&&h(e,0),a>0){for(const d of this.bots){if(!d.state.alive||e&&e!=="local"&&d===e)continue;const f=d.pawn.group.position.distanceTo(n);f<a&&h(d,f)}if(this.net.getLocal().alive&&e!=="local"){const d=this.flight.position.distanceTo(n);d<a&&h("local",d)}}}applyDamageToLocal(t,e,n="plasma"){if(this.dead)return;const i=this.shield.charge,r=this.shield.deployed,a=this.shield.absorb(t),o=t-a,l=this.net.getLocal();l.health=Math.max(0,l.health-a),l.shield=this.shield.charge,l.shieldDeployed=this.shield.deployed,this.hud.flashDamage();const c=this.flight.position.clone();c.y+=1.2,c.x+=(Math.random()-.5)*2,a>.5?(this.dmgFloats.spawn(c,a,"take"),this.audio.playHit(),this.effects.hitSpark(c,16722902)):(o>.5||r||i>this.shield.charge)&&(this.dmgFloats.spawn(c,Math.max(o,t*.3),"shield"),this.audio.playShieldHit()),l.health<=0&&this.onLocalDeath(e,n)}onLocalDeath(t,e){const n=this.net.getLocal();n.alive=!1,n.deaths++,this.dead=!0,this.respawnTimer=de.respawnDelay,this.effects.explode(this.flight.position.clone(),3,16722902),this.audio.playDeath(),this.localPawn.group.visible=!1;const i=this.net.getPlayers().find(a=>a.id===t),r=i?.callsign??(t==="world"?"CITY":"UNKNOWN");this.hud.pushKill(r,n.callsign,Ne[e]?.name??e),i&&t!==this.net.localId&&(i.kills++,i.score+=100),this.mode==="outlaw"&&(this.lives--,this.lives<=0&&this.endOutlaw(!1))}onKill(t,e,n,i){this.effects.explode(i.clone(),2.5,16722902),this.audio.playExplosion();const r=this.net.getPlayers().find(l=>l.id===t),a=this.net.getPlayers().find(l=>l.id===e);if(this.hud.pushKill(r?.callsign??"???",a?.callsign??"???",Ne[n]?.name??n),t===this.net.localId){this.dmgFloats.spawn(i.clone().add(new R(0,2,0)),0,"kill"),this.audio.playKill();const l=this.net.getLocal();l.kills++,l.score+=100,this.mode==="outlaw"&&this.outlawKills++}const o=this.bots.find(l=>l.state.id===e);o&&setTimeout(()=>{this.playing&&(this.mode==="outlaw"?this.bots.filter(c=>c.state.alive).length===0&&this.outlawKills>=this.outlawKillsNeeded&&this.nextOutlawRound():(o.respawn(this.map.randomSpawn()),this.ensureRivalPopulation()))},de.respawnDelay*1e3)}doRespawn(){if(this.mode==="outlaw"&&this.lives<=0)return;const t=this.map.randomSpawn();this.flight.reset(t),this.shield.reset(),this.weapons.refill(),this.dead=!1,this.respawnTimer=-1,this.hud.showDeath(!1),this.localPawn.group.visible=!0,this.net.pushLocal({alive:!0,health:de.maxHealth,shield:de.maxShield,shieldDeployed:!1})}updateBots(t){const e=this.net.getPlayers();for(const n of this.bots){n.update(t,e,this.map.def.bounds,this.map.def.minAlt,this.map.def.maxAlt,(r,a,o)=>{const l=this.weapons.current;this.weapons.unlocked.add(o),this.weapons.select(o);const c=this.weapons.ammo[o];this.weapons.ammo[o]=o==="plasma"?-1:99;const h=this.weapons.cooldown;this.weapons.cooldown=0;const d=this.weapons.fire(n.state.id,r,a,{lockTargetId:o==="rocket"||o==="torpedo"?n.targetId:null,requireLock:!1});if(this.weapons.cooldown=h,this.weapons.ammo[o]=c,this.weapons.select(l),d?.hitscan)for(const f of d.hitscan)this.resolveHitscan(n.state.id,r,a,f.damage,o)});const i=n.pawn.group.position;for(let r=0;r<5&&this.map.city.resolveSolid(i,1.7,this.collNormal,3);r++)n.deflect(this.collNormal);if(n.writeState(),n.state.alive){const r=this.map.city.lineOfSight(this.camera.position,n.pawn.group.position);n.setTrackerVisible(r),n.pawn.group.visible=!0,n.pawn.body.visible=r,n.pawn.shieldMesh.visible=r&&n.state.shieldDeployed}else n.setTrackerVisible(!1)}}syncLocalState(){const t=this.flight.quaternion;this.net.pushLocal({position:this.flight.position.toArray(),rotation:[t.x,t.y,t.z,t.w],velocity:this.flight.velocity.toArray(),health:this.net.getLocal().health,shield:this.shield.charge,shieldDeployed:this.shield.deployed,weapon:this.weapons.current,alive:!this.dead})}updateModeLogic(){this.mode==="multiplayer"&&this.matchLimit>0&&this.matchTime>=this.matchLimit&&this.endMultiplayer(),this.mode==="outlaw"&&this.matchLimit>0&&this.matchTime>=this.matchLimit&&(this.outlawKills>=this.outlawKillsNeeded?this.nextOutlawRound():this.endOutlaw(!1))}nextOutlawRound(){if(this.outlawRound++,this.outlawRound>=Je.rounds){this.endOutlaw(!0);return}this.outlawKills=0,this.outlawKillsNeeded=Je.targetsPerRound[this.outlawRound]??6,this.matchTime=0,this.matchLimit=Je.roundTime,this.net.spawnBots(this.outlawKillsNeeded,!1),this.spawnBotPawns(),this.hud.setModeBanner(`OUTLAW HUNT · ROUND ${this.outlawRound+1}/${Je.rounds}`),this.weapons.refill()}endOutlaw(t){this.playing=!1,this.input.disengage(),this.hud.show(!1);const e=this.net.getLocal(),n=Math.floor(Math.max(0,this.matchLimit-this.matchTime)*Je.timeBonusPerSec);this.results.showResults(t?"BOUNTY COMPLETE":"HUNT FAILED",[`CALLSIGN  ${e.callsign}`,`KILLS  ${e.kills}`,`DEATHS  ${e.deaths}`,`SCORE  ${e.score+(t?n:0)}`,`LIVES LEFT  ${Math.max(0,this.lives)}`,t?`TIME BONUS  +${n}`:"OUT OF TIME OR LIVES"])}endMultiplayer(){this.playing=!1,this.input.disengage(),this.hud.show(!1);const t=[...this.net.getPlayers()].sort((i,r)=>r.score-i.score),e=this.net.getLocal(),n=t.findIndex(i=>i.id===e.id)+1;this.results.showResults("MATCH OVER",[`RANK  #${n}`,`CALLSIGN  ${e.callsign}`,`KILLS  ${e.kills}`,`DEATHS  ${e.deaths}`,`SCORE  ${e.score}`])}updateHud(t){const e=this.net.getLocal(),n=this.matchLimit>0?Math.max(0,this.matchLimit-this.matchTime):this.matchTime;this.hud.updateFlight(this.flight.position.y,this.flight.speed,n,this.flight.energy,e.health,this.shield.charge,this.shield.fullyCharged),this.hud.updateWeapon(this.weapons.current,this.weapons.ammo[this.weapons.current]),this.hud.updateLeaders(this.net.getPlayers(),this.net.localId);const i=[];for(const r of this.net.getPlayers()){if(r.id===e.id){i.push({x:r.position[0],z:r.position[2],friendly:!0,isPlayer:!0});continue}r.alive&&(this.tmpV.set(r.position[0],r.position[1],r.position[2]),this.map.city.lineOfSight(this.camera.position,this.tmpV)&&i.push({x:r.position[0],z:r.position[2],friendly:r.team!==0&&r.team===e.team,isPlayer:!1}))}for(const r of this.map.portals.blips())i.push({x:r.x,z:r.z,friendly:!0,isPlayer:!1});for(const r of this.pickups.blips())i.push({x:r.x,z:r.z,friendly:!0,isPlayer:!1});if(this.hud.drawRadar({x:this.flight.position.x,z:this.flight.position.z},this.flight.euler.y,i,this.map.def.bounds*.6),this.hud.isDebugVisible()){const r=this.renderer.info,a=this.flight.position,o=this.bots.filter(l=>l.state.alive).map(l=>l.mood[0]).join("");this.hud.updateDebug(["Neon Veil  DEBUG  [F3]",`FPS        ${this.fps.toFixed(1)}`,`BIOME      ${this.map.def.name} (${this.mapId})`,`POS        ${a.x.toFixed(1)}  ${a.y.toFixed(1)}  ${a.z.toFixed(1)}`,`SPEED      ${this.flight.speed.toFixed(1)} m/s`,`WEAPON     ${this.weapons.current}  ammo=${this.weapons.ammo[this.weapons.current]}`,`M-LOCK     ${this.missileLock.phase}  ${(this.missileLock.progress*100).toFixed(0)}%  tgt=${this.missileLock.targetId??"-"}`,`BUILDINGS  ${this.map.city.buildingCount}`,`COLLIDERS  ${this.map.city.colliders.length}`,`PORTALS    ${this.map.portals.portals.length}`,`CRATES     ${this.pickups.pickups.filter(l=>l.alive).length}`,`DRAW CALLS ${r.render.calls}`,`TRIANGLES  ${r.render.triangles}`,`SECTOR     ${this.mapId}  instances=${this.biomeInstances.size+1}`,`RIVALS     ${this.bots.filter(l=>l.state.alive).length}  moods=${o||"-"}`,`ENGAGED    ${this.input.engaged?"yes":"no"}  lock=${this.input.pointerLocked?"yes":"no"}`,`PIXEL RATIO ${this.renderer.getPixelRatio().toFixed(2)}`])}}render(){this.renderer.setRenderTarget(null),this.renderer.render(this.scene,this.camera),this.playing&&(this.frame++,this.frame%2===0&&this.renderMirrors())}renderMirrors(){const t=this.flight.position,e=this.flight.euler;this.mirrorLeftCam.position.copy(t),this.mirrorLeftCam.position.y+=.3,this.mirrorLeftCam.quaternion.setFromEuler(new Be(0,e.y+Math.PI*.75,0,"YXZ")),this.mirrorRightCam.position.copy(t),this.mirrorRightCam.position.y+=.3,this.mirrorRightCam.quaternion.setFromEuler(new Be(0,e.y-Math.PI*.75,0,"YXZ")),this.renderer.setRenderTarget(this.mirrorLeftRT),this.renderer.render(this.scene,this.mirrorLeftCam),this.renderer.setRenderTarget(this.mirrorRightRT),this.renderer.render(this.scene,this.mirrorRightCam),this.renderer.setRenderTarget(null),this.blitRT(this.mirrorLeftRT,this.mirrorLeftCtx),this.blitRT(this.mirrorRightRT,this.mirrorRightCtx)}blitRT(t,e){try{this.renderer.readRenderTargetPixels(t,0,0,128,96,this.mirrorBuf);const n=e.createImageData(128,96);for(let i=0;i<96;i++)for(let r=0;r<128;r++){const a=((95-i)*128+r)*4,o=(i*128+r)*4;n.data[o]=this.mirrorBuf[a],n.data[o+1]=this.mirrorBuf[a+1],n.data[o+2]=this.mirrorBuf[a+2],n.data[o+3]=255}e.putImageData(n,0,0)}catch{}}onResize=()=>{const t=window.innerWidth,e=window.innerHeight;this.camera.aspect=t/e,this.camera.updateProjectionMatrix(),this.renderer.setSize(t,e)}}function Nr(s){return new Promise(t=>setTimeout(t,s))}function Yi(){return new Promise(s=>requestAnimationFrame(()=>s()))}function sg(s){const t=s instanceof Error?`${s.message}
${s.stack??""}`:String(s);console.error("[Neon Veil] boot failed",s);const e=document.createElement("div");e.id="boot-error",e.style.cssText="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#0a0614;color:#ff8ad8;font:14px/1.5 ui-monospace,monospace;padding:2rem;text-align:left",e.innerHTML=`<div style="max-width:640px;border:1px solid #00f0ff;padding:1.5rem;border-radius:10px;background:rgba(8,4,20,0.92)"><div style="color:#00f0ff;letter-spacing:0.12em;margin-bottom:0.75rem">Neon Veil · BOOT FAULT</div><pre style="white-space:pre-wrap;word-break:break-word;color:#e8f7ff;font-size:12px">${t.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</pre><p style="margin-top:1rem;color:#aab;font-size:12px">Open DevTools (F12) → Console. Serve via Vite, not file://.</p></div>`,document.body.appendChild(e)}try{const s=new ig;console.info("%cNeon Veil","color:#00f0ff;font-size:16px;font-weight:bold","— Outlaw skies. Zero voice.")}catch(s){sg(s)}
//# sourceMappingURL=index-BEaLdKyu.js.map
