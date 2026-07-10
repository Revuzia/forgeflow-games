(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))n(i);new MutationObserver(i=>{for(const s of i)if(s.type==="childList")for(const a of s.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&n(a)}).observe(document,{childList:!0,subtree:!0});function t(i){const s={};return i.integrity&&(s.integrity=i.integrity),i.referrerPolicy&&(s.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?s.credentials="include":i.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function n(i){if(i.ep)return;i.ep=!0;const s=t(i);fetch(i.href,s)}})();/**
 * @license
 * Copyright 2010-2024 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const Oo="172",hu=0,yl=1,uu=2,th=1,nh=2,Fn=3,Vn=0,Gt=1,rn=2,ti=0,Hi=1,gn=2,Ml=3,wl=4,du=5,pi=100,fu=101,pu=102,mu=103,gu=104,_u=200,xu=201,vu=202,yu=203,Ha=204,Va=205,Mu=206,wu=207,bu=208,Su=209,Eu=210,Tu=211,Au=212,Ru=213,Cu=214,Ga=0,Wa=1,Xa=2,qi=3,qa=4,Ya=5,$a=6,ja=7,ih=0,Pu=1,Iu=2,ni=0,Lu=1,Du=2,Nu=3,sh=4,Uu=5,ku=6,Fu=7,bl="attached",Bu="detached",rh=300,Yi=301,$i=302,Ka=303,Ja=304,qr=306,ji=1e3,yn=1001,Nr=1002,Wt=1003,ah=1004,Ss=1005,Dt=1006,Sr=1007,On=1008,Gn=1009,oh=1010,lh=1011,Ns=1012,zo=1013,gi=1014,mn=1015,Os=1016,Ho=1017,Vo=1018,Ki=1020,ch=35902,hh=1021,uh=1022,an=1023,dh=1024,fh=1025,Vi=1026,Ji=1027,Go=1028,Wo=1029,ph=1030,Xo=1031,qo=1033,Er=33776,Tr=33777,Ar=33778,Rr=33779,Za=35840,Qa=35841,eo=35842,to=35843,no=36196,io=37492,so=37496,ro=37808,ao=37809,oo=37810,lo=37811,co=37812,ho=37813,uo=37814,fo=37815,po=37816,mo=37817,go=37818,_o=37819,xo=37820,vo=37821,Cr=36492,yo=36494,Mo=36495,mh=36283,wo=36284,bo=36285,So=36286,gh=2200,Ou=2201,zu=2202,Us=2300,ks=2301,Jr=2302,Bi=2400,Oi=2401,Ur=2402,Yo=2500,Hu=2501,Vu=0,_h=1,Eo=2,Gu=3200,Wu=3201,xh=0,Xu=1,Zn="",Mt="srgb",qt="srgb-linear",kr="linear",lt="srgb",wi=7680,Sl=519,qu=512,Yu=513,$u=514,vh=515,ju=516,Ku=517,Ju=518,Zu=519,To=35044,El="300 es",zn=2e3,Fr=2001;class vi{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;const n=this._listeners;return n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;const i=this._listeners[e];if(i!==void 0){const s=i.indexOf(t);s!==-1&&i.splice(s,1)}}dispatchEvent(e){if(this._listeners===void 0)return;const n=this._listeners[e.type];if(n!==void 0){e.target=this;const i=n.slice(0);for(let s=0,a=i.length;s<a;s++)i[s].call(this,e);e.target=null}}}const kt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];let Tl=1234567;const As=Math.PI/180,Zi=180/Math.PI;function _n(){const r=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(kt[r&255]+kt[r>>8&255]+kt[r>>16&255]+kt[r>>24&255]+"-"+kt[e&255]+kt[e>>8&255]+"-"+kt[e>>16&15|64]+kt[e>>24&255]+"-"+kt[t&63|128]+kt[t>>8&255]+"-"+kt[t>>16&255]+kt[t>>24&255]+kt[n&255]+kt[n>>8&255]+kt[n>>16&255]+kt[n>>24&255]).toLowerCase()}function Ve(r,e,t){return Math.max(e,Math.min(t,r))}function $o(r,e){return(r%e+e)%e}function Qu(r,e,t,n,i){return n+(r-e)*(i-n)/(t-e)}function ed(r,e,t){return r!==e?(t-r)/(e-r):0}function Rs(r,e,t){return(1-t)*r+t*e}function td(r,e,t,n){return Rs(r,e,1-Math.exp(-t*n))}function nd(r,e=1){return e-Math.abs($o(r,e*2)-e)}function id(r,e,t){return r<=e?0:r>=t?1:(r=(r-e)/(t-e),r*r*(3-2*r))}function sd(r,e,t){return r<=e?0:r>=t?1:(r=(r-e)/(t-e),r*r*r*(r*(r*6-15)+10))}function rd(r,e){return r+Math.floor(Math.random()*(e-r+1))}function ad(r,e){return r+Math.random()*(e-r)}function od(r){return r*(.5-Math.random())}function ld(r){r!==void 0&&(Tl=r);let e=Tl+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function cd(r){return r*As}function hd(r){return r*Zi}function ud(r){return(r&r-1)===0&&r!==0}function dd(r){return Math.pow(2,Math.ceil(Math.log(r)/Math.LN2))}function fd(r){return Math.pow(2,Math.floor(Math.log(r)/Math.LN2))}function pd(r,e,t,n,i){const s=Math.cos,a=Math.sin,o=s(t/2),l=a(t/2),c=s((e+n)/2),h=a((e+n)/2),u=s((e-n)/2),d=a((e-n)/2),f=s((n-e)/2),m=a((n-e)/2);switch(i){case"XYX":r.set(o*h,l*u,l*d,o*c);break;case"YZY":r.set(l*d,o*h,l*u,o*c);break;case"ZXZ":r.set(l*u,l*d,o*h,o*c);break;case"XZX":r.set(o*h,l*m,l*f,o*c);break;case"YXY":r.set(l*f,o*h,l*m,o*c);break;case"ZYZ":r.set(l*m,l*f,o*h,o*c);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+i)}}function fn(r,e){switch(e.constructor){case Float32Array:return r;case Uint32Array:return r/4294967295;case Uint16Array:return r/65535;case Uint8Array:return r/255;case Int32Array:return Math.max(r/2147483647,-1);case Int16Array:return Math.max(r/32767,-1);case Int8Array:return Math.max(r/127,-1);default:throw new Error("Invalid component type.")}}function ot(r,e){switch(e.constructor){case Float32Array:return r;case Uint32Array:return Math.round(r*4294967295);case Uint16Array:return Math.round(r*65535);case Uint8Array:return Math.round(r*255);case Int32Array:return Math.round(r*2147483647);case Int16Array:return Math.round(r*32767);case Int8Array:return Math.round(r*127);default:throw new Error("Invalid component type.")}}const md={DEG2RAD:As,RAD2DEG:Zi,generateUUID:_n,clamp:Ve,euclideanModulo:$o,mapLinear:Qu,inverseLerp:ed,lerp:Rs,damp:td,pingpong:nd,smoothstep:id,smootherstep:sd,randInt:rd,randFloat:ad,randFloatSpread:od,seededRandom:ld,degToRad:cd,radToDeg:hd,isPowerOfTwo:ud,ceilPowerOfTwo:dd,floorPowerOfTwo:fd,setQuaternionFromProperEuler:pd,normalize:ot,denormalize:fn};class pe{constructor(e=0,t=0){pe.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){const t=this.x,n=this.y,i=e.elements;return this.x=i[0]*t+i[3]*n+i[6],this.y=i[1]*t+i[4]*n+i[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Ve(this.x,e.x,t.x),this.y=Ve(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=Ve(this.x,e,t),this.y=Ve(this.y,e,t),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Ve(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Ve(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){const n=Math.cos(t),i=Math.sin(t),s=this.x-e.x,a=this.y-e.y;return this.x=s*n-a*i+e.x,this.y=s*i+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class Oe{constructor(e,t,n,i,s,a,o,l,c){Oe.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,i,s,a,o,l,c)}set(e,t,n,i,s,a,o,l,c){const h=this.elements;return h[0]=e,h[1]=i,h[2]=o,h[3]=t,h[4]=s,h[5]=l,h[6]=n,h[7]=a,h[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){const t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,i=t.elements,s=this.elements,a=n[0],o=n[3],l=n[6],c=n[1],h=n[4],u=n[7],d=n[2],f=n[5],m=n[8],_=i[0],g=i[3],p=i[6],x=i[1],y=i[4],v=i[7],A=i[2],E=i[5],T=i[8];return s[0]=a*_+o*x+l*A,s[3]=a*g+o*y+l*E,s[6]=a*p+o*v+l*T,s[1]=c*_+h*x+u*A,s[4]=c*g+h*y+u*E,s[7]=c*p+h*v+u*T,s[2]=d*_+f*x+m*A,s[5]=d*g+f*y+m*E,s[8]=d*p+f*v+m*T,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[1],i=e[2],s=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8];return t*a*h-t*o*c-n*s*h+n*o*l+i*s*c-i*a*l}invert(){const e=this.elements,t=e[0],n=e[1],i=e[2],s=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8],u=h*a-o*c,d=o*l-h*s,f=c*s-a*l,m=t*u+n*d+i*f;if(m===0)return this.set(0,0,0,0,0,0,0,0,0);const _=1/m;return e[0]=u*_,e[1]=(i*c-h*n)*_,e[2]=(o*n-i*a)*_,e[3]=d*_,e[4]=(h*t-i*l)*_,e[5]=(i*s-o*t)*_,e[6]=f*_,e[7]=(n*l-c*t)*_,e[8]=(a*t-n*s)*_,this}transpose(){let e;const t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){const t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,i,s,a,o){const l=Math.cos(s),c=Math.sin(s);return this.set(n*l,n*c,-n*(l*a+c*o)+a+e,-i*c,i*l,-i*(-c*a+l*o)+o+t,0,0,1),this}scale(e,t){return this.premultiply(Zr.makeScale(e,t)),this}rotate(e){return this.premultiply(Zr.makeRotation(-e)),this}translate(e,t){return this.premultiply(Zr.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){const t=this.elements,n=e.elements;for(let i=0;i<9;i++)if(t[i]!==n[i])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}}const Zr=new Oe;function yh(r){for(let e=r.length-1;e>=0;--e)if(r[e]>=65535)return!0;return!1}function Fs(r){return document.createElementNS("http://www.w3.org/1999/xhtml",r)}function gd(){const r=Fs("canvas");return r.style.display="block",r}const Al={};function Fi(r){r in Al||(Al[r]=!0,console.warn(r))}function _d(r,e,t){return new Promise(function(n,i){function s(){switch(r.clientWaitSync(e,r.SYNC_FLUSH_COMMANDS_BIT,0)){case r.WAIT_FAILED:i();break;case r.TIMEOUT_EXPIRED:setTimeout(s,t);break;default:n()}}setTimeout(s,t)})}function xd(r){const e=r.elements;e[2]=.5*e[2]+.5*e[3],e[6]=.5*e[6]+.5*e[7],e[10]=.5*e[10]+.5*e[11],e[14]=.5*e[14]+.5*e[15]}function vd(r){const e=r.elements;e[11]===-1?(e[10]=-e[10]-1,e[14]=-e[14]):(e[10]=-e[10],e[14]=-e[14]+1)}const Rl=new Oe().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),Cl=new Oe().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function yd(){const r={enabled:!0,workingColorSpace:qt,spaces:{},convert:function(i,s,a){return this.enabled===!1||s===a||!s||!a||(this.spaces[s].transfer===lt&&(i.r=Hn(i.r),i.g=Hn(i.g),i.b=Hn(i.b)),this.spaces[s].primaries!==this.spaces[a].primaries&&(i.applyMatrix3(this.spaces[s].toXYZ),i.applyMatrix3(this.spaces[a].fromXYZ)),this.spaces[a].transfer===lt&&(i.r=Gi(i.r),i.g=Gi(i.g),i.b=Gi(i.b))),i},fromWorkingColorSpace:function(i,s){return this.convert(i,this.workingColorSpace,s)},toWorkingColorSpace:function(i,s){return this.convert(i,s,this.workingColorSpace)},getPrimaries:function(i){return this.spaces[i].primaries},getTransfer:function(i){return i===Zn?kr:this.spaces[i].transfer},getLuminanceCoefficients:function(i,s=this.workingColorSpace){return i.fromArray(this.spaces[s].luminanceCoefficients)},define:function(i){Object.assign(this.spaces,i)},_getMatrix:function(i,s,a){return i.copy(this.spaces[s].toXYZ).multiply(this.spaces[a].fromXYZ)},_getDrawingBufferColorSpace:function(i){return this.spaces[i].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(i=this.workingColorSpace){return this.spaces[i].workingColorSpaceConfig.unpackColorSpace}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],n=[.3127,.329];return r.define({[qt]:{primaries:e,whitePoint:n,transfer:kr,toXYZ:Rl,fromXYZ:Cl,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:Mt},outputColorSpaceConfig:{drawingBufferColorSpace:Mt}},[Mt]:{primaries:e,whitePoint:n,transfer:lt,toXYZ:Rl,fromXYZ:Cl,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:Mt}}}),r}const Je=yd();function Hn(r){return r<.04045?r*.0773993808:Math.pow(r*.9478672986+.0521327014,2.4)}function Gi(r){return r<.0031308?r*12.92:1.055*Math.pow(r,.41666)-.055}let bi;class Md{static getDataURL(e){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let t;if(e instanceof HTMLCanvasElement)t=e;else{bi===void 0&&(bi=Fs("canvas")),bi.width=e.width,bi.height=e.height;const n=bi.getContext("2d");e instanceof ImageData?n.putImageData(e,0,0):n.drawImage(e,0,0,e.width,e.height),t=bi}return t.width>2048||t.height>2048?(console.warn("THREE.ImageUtils.getDataURL: Image converted to jpg for performance reasons",e),t.toDataURL("image/jpeg",.6)):t.toDataURL("image/png")}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){const t=Fs("canvas");t.width=e.width,t.height=e.height;const n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);const i=n.getImageData(0,0,e.width,e.height),s=i.data;for(let a=0;a<s.length;a++)s[a]=Hn(s[a]/255)*255;return n.putImageData(i,0,0),t}else if(e.data){const t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(Hn(t[n]/255)*255):t[n]=Hn(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}}let wd=0;class Mh{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:wd++}),this.uuid=_n(),this.data=e,this.dataReady=!0,this.version=0}set needsUpdate(e){e===!0&&this.version++}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];const n={uuid:this.uuid,url:""},i=this.data;if(i!==null){let s;if(Array.isArray(i)){s=[];for(let a=0,o=i.length;a<o;a++)i[a].isDataTexture?s.push(Qr(i[a].image)):s.push(Qr(i[a]))}else s=Qr(i);n.url=s}return t||(e.images[this.uuid]=n),n}}function Qr(r){return typeof HTMLImageElement<"u"&&r instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&r instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&r instanceof ImageBitmap?Md.getDataURL(r):r.data?{data:Array.from(r.data),width:r.width,height:r.height,type:r.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let bd=0;class bt extends vi{constructor(e=bt.DEFAULT_IMAGE,t=bt.DEFAULT_MAPPING,n=yn,i=yn,s=Dt,a=On,o=an,l=Gn,c=bt.DEFAULT_ANISOTROPY,h=Zn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:bd++}),this.uuid=_n(),this.name="",this.source=new Mh(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=i,this.magFilter=s,this.minFilter=a,this.anisotropy=c,this.format=o,this.internalFormat=null,this.type=l,this.offset=new pe(0,0),this.repeat=new pe(1,1),this.center=new pe(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Oe,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=h,this.userData={},this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.pmremVersion=0}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];const n={metadata:{version:4.6,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==rh)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case ji:e.x=e.x-Math.floor(e.x);break;case yn:e.x=e.x<0?0:1;break;case Nr:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case ji:e.y=e.y-Math.floor(e.y);break;case yn:e.y=e.y<0?0:1;break;case Nr:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}}bt.DEFAULT_IMAGE=null;bt.DEFAULT_MAPPING=rh;bt.DEFAULT_ANISOTROPY=1;class tt{constructor(e=0,t=0,n=0,i=1){tt.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=i}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,i){return this.x=e,this.y=t,this.z=n,this.w=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){const t=this.x,n=this.y,i=this.z,s=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*i+a[12]*s,this.y=a[1]*t+a[5]*n+a[9]*i+a[13]*s,this.z=a[2]*t+a[6]*n+a[10]*i+a[14]*s,this.w=a[3]*t+a[7]*n+a[11]*i+a[15]*s,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);const t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,i,s;const l=e.elements,c=l[0],h=l[4],u=l[8],d=l[1],f=l[5],m=l[9],_=l[2],g=l[6],p=l[10];if(Math.abs(h-d)<.01&&Math.abs(u-_)<.01&&Math.abs(m-g)<.01){if(Math.abs(h+d)<.1&&Math.abs(u+_)<.1&&Math.abs(m+g)<.1&&Math.abs(c+f+p-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;const y=(c+1)/2,v=(f+1)/2,A=(p+1)/2,E=(h+d)/4,T=(u+_)/4,P=(m+g)/4;return y>v&&y>A?y<.01?(n=0,i=.707106781,s=.707106781):(n=Math.sqrt(y),i=E/n,s=T/n):v>A?v<.01?(n=.707106781,i=0,s=.707106781):(i=Math.sqrt(v),n=E/i,s=P/i):A<.01?(n=.707106781,i=.707106781,s=0):(s=Math.sqrt(A),n=T/s,i=P/s),this.set(n,i,s,t),this}let x=Math.sqrt((g-m)*(g-m)+(u-_)*(u-_)+(d-h)*(d-h));return Math.abs(x)<.001&&(x=1),this.x=(g-m)/x,this.y=(u-_)/x,this.z=(d-h)/x,this.w=Math.acos((c+f+p-1)/2),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Ve(this.x,e.x,t.x),this.y=Ve(this.y,e.y,t.y),this.z=Ve(this.z,e.z,t.z),this.w=Ve(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=Ve(this.x,e,t),this.y=Ve(this.y,e,t),this.z=Ve(this.z,e,t),this.w=Ve(this.w,e,t),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Ve(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class Sd extends vi{constructor(e=1,t=1,n={}){super(),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=1,this.scissor=new tt(0,0,e,t),this.scissorTest=!1,this.viewport=new tt(0,0,e,t);const i={width:e,height:t,depth:1};n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Dt,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1},n);const s=new bt(i,n.mapping,n.wrapS,n.wrapT,n.magFilter,n.minFilter,n.format,n.type,n.anisotropy,n.colorSpace);s.flipY=!1,s.generateMipmaps=n.generateMipmaps,s.internalFormat=n.internalFormat,this.textures=[];const a=n.count;for(let o=0;o<a;o++)this.textures[o]=s.clone(),this.textures[o].isRenderTargetTexture=!0,this.textures[o].renderTarget=this;this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let i=0,s=this.textures.length;i<s;i++)this.textures[i].image.width=e,this.textures[i].image.height=t,this.textures[i].image.depth=n;this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let n=0,i=e.textures.length;n<i;n++)this.textures[n]=e.textures[n].clone(),this.textures[n].isRenderTargetTexture=!0,this.textures[n].renderTarget=this;const t=Object.assign({},e.texture.image);return this.texture.source=new Mh(t),this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class _i extends Sd{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}}class wh extends bt{constructor(e=null,t=1,n=1,i=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:i},this.magFilter=Wt,this.minFilter=Wt,this.wrapR=yn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}}class Ed extends bt{constructor(e=null,t=1,n=1,i=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:i},this.magFilter=Wt,this.minFilter=Wt,this.wrapR=yn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class Ct{constructor(e=0,t=0,n=0,i=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=i}static slerpFlat(e,t,n,i,s,a,o){let l=n[i+0],c=n[i+1],h=n[i+2],u=n[i+3];const d=s[a+0],f=s[a+1],m=s[a+2],_=s[a+3];if(o===0){e[t+0]=l,e[t+1]=c,e[t+2]=h,e[t+3]=u;return}if(o===1){e[t+0]=d,e[t+1]=f,e[t+2]=m,e[t+3]=_;return}if(u!==_||l!==d||c!==f||h!==m){let g=1-o;const p=l*d+c*f+h*m+u*_,x=p>=0?1:-1,y=1-p*p;if(y>Number.EPSILON){const A=Math.sqrt(y),E=Math.atan2(A,p*x);g=Math.sin(g*E)/A,o=Math.sin(o*E)/A}const v=o*x;if(l=l*g+d*v,c=c*g+f*v,h=h*g+m*v,u=u*g+_*v,g===1-o){const A=1/Math.sqrt(l*l+c*c+h*h+u*u);l*=A,c*=A,h*=A,u*=A}}e[t]=l,e[t+1]=c,e[t+2]=h,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,i,s,a){const o=n[i],l=n[i+1],c=n[i+2],h=n[i+3],u=s[a],d=s[a+1],f=s[a+2],m=s[a+3];return e[t]=o*m+h*u+l*f-c*d,e[t+1]=l*m+h*d+c*u-o*f,e[t+2]=c*m+h*f+o*d-l*u,e[t+3]=h*m-o*u-l*d-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,i){return this._x=e,this._y=t,this._z=n,this._w=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){const n=e._x,i=e._y,s=e._z,a=e._order,o=Math.cos,l=Math.sin,c=o(n/2),h=o(i/2),u=o(s/2),d=l(n/2),f=l(i/2),m=l(s/2);switch(a){case"XYZ":this._x=d*h*u+c*f*m,this._y=c*f*u-d*h*m,this._z=c*h*m+d*f*u,this._w=c*h*u-d*f*m;break;case"YXZ":this._x=d*h*u+c*f*m,this._y=c*f*u-d*h*m,this._z=c*h*m-d*f*u,this._w=c*h*u+d*f*m;break;case"ZXY":this._x=d*h*u-c*f*m,this._y=c*f*u+d*h*m,this._z=c*h*m+d*f*u,this._w=c*h*u-d*f*m;break;case"ZYX":this._x=d*h*u-c*f*m,this._y=c*f*u+d*h*m,this._z=c*h*m-d*f*u,this._w=c*h*u+d*f*m;break;case"YZX":this._x=d*h*u+c*f*m,this._y=c*f*u+d*h*m,this._z=c*h*m-d*f*u,this._w=c*h*u-d*f*m;break;case"XZY":this._x=d*h*u-c*f*m,this._y=c*f*u-d*h*m,this._z=c*h*m+d*f*u,this._w=c*h*u+d*f*m;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){const n=t/2,i=Math.sin(n);return this._x=e.x*i,this._y=e.y*i,this._z=e.z*i,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){const t=e.elements,n=t[0],i=t[4],s=t[8],a=t[1],o=t[5],l=t[9],c=t[2],h=t[6],u=t[10],d=n+o+u;if(d>0){const f=.5/Math.sqrt(d+1);this._w=.25/f,this._x=(h-l)*f,this._y=(s-c)*f,this._z=(a-i)*f}else if(n>o&&n>u){const f=2*Math.sqrt(1+n-o-u);this._w=(h-l)/f,this._x=.25*f,this._y=(i+a)/f,this._z=(s+c)/f}else if(o>u){const f=2*Math.sqrt(1+o-n-u);this._w=(s-c)/f,this._x=(i+a)/f,this._y=.25*f,this._z=(l+h)/f}else{const f=2*Math.sqrt(1+u-n-o);this._w=(a-i)/f,this._x=(s+c)/f,this._y=(l+h)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<Number.EPSILON?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Ve(this.dot(e),-1,1)))}rotateTowards(e,t){const n=this.angleTo(e);if(n===0)return this;const i=Math.min(1,t/n);return this.slerp(e,i),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){const n=e._x,i=e._y,s=e._z,a=e._w,o=t._x,l=t._y,c=t._z,h=t._w;return this._x=n*h+a*o+i*c-s*l,this._y=i*h+a*l+s*o-n*c,this._z=s*h+a*c+n*l-i*o,this._w=a*h-n*o-i*l-s*c,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);const n=this._x,i=this._y,s=this._z,a=this._w;let o=a*e._w+n*e._x+i*e._y+s*e._z;if(o<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,o=-o):this.copy(e),o>=1)return this._w=a,this._x=n,this._y=i,this._z=s,this;const l=1-o*o;if(l<=Number.EPSILON){const f=1-t;return this._w=f*a+t*this._w,this._x=f*n+t*this._x,this._y=f*i+t*this._y,this._z=f*s+t*this._z,this.normalize(),this}const c=Math.sqrt(l),h=Math.atan2(c,o),u=Math.sin((1-t)*h)/c,d=Math.sin(t*h)/c;return this._w=a*u+this._w*d,this._x=n*u+this._x*d,this._y=i*u+this._y*d,this._z=s*u+this._z*d,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){const e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),i=Math.sqrt(1-n),s=Math.sqrt(n);return this.set(i*Math.sin(e),i*Math.cos(e),s*Math.sin(t),s*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class C{constructor(e=0,t=0,n=0){C.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(Pl.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(Pl.setFromAxisAngle(e,t))}applyMatrix3(e){const t=this.x,n=this.y,i=this.z,s=e.elements;return this.x=s[0]*t+s[3]*n+s[6]*i,this.y=s[1]*t+s[4]*n+s[7]*i,this.z=s[2]*t+s[5]*n+s[8]*i,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){const t=this.x,n=this.y,i=this.z,s=e.elements,a=1/(s[3]*t+s[7]*n+s[11]*i+s[15]);return this.x=(s[0]*t+s[4]*n+s[8]*i+s[12])*a,this.y=(s[1]*t+s[5]*n+s[9]*i+s[13])*a,this.z=(s[2]*t+s[6]*n+s[10]*i+s[14])*a,this}applyQuaternion(e){const t=this.x,n=this.y,i=this.z,s=e.x,a=e.y,o=e.z,l=e.w,c=2*(a*i-o*n),h=2*(o*t-s*i),u=2*(s*n-a*t);return this.x=t+l*c+a*u-o*h,this.y=n+l*h+o*c-s*u,this.z=i+l*u+s*h-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){const t=this.x,n=this.y,i=this.z,s=e.elements;return this.x=s[0]*t+s[4]*n+s[8]*i,this.y=s[1]*t+s[5]*n+s[9]*i,this.z=s[2]*t+s[6]*n+s[10]*i,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Ve(this.x,e.x,t.x),this.y=Ve(this.y,e.y,t.y),this.z=Ve(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=Ve(this.x,e,t),this.y=Ve(this.y,e,t),this.z=Ve(this.z,e,t),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Ve(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){const n=e.x,i=e.y,s=e.z,a=t.x,o=t.y,l=t.z;return this.x=i*l-s*o,this.y=s*a-n*l,this.z=n*o-i*a,this}projectOnVector(e){const t=e.lengthSq();if(t===0)return this.set(0,0,0);const n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return ea.copy(this).projectOnVector(e),this.sub(ea)}reflect(e){return this.sub(ea.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Ve(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y,i=this.z-e.z;return t*t+n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){const i=Math.sin(t)*e;return this.x=i*Math.sin(n),this.y=Math.cos(t)*e,this.z=i*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){const t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),i=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=i,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const ea=new C,Pl=new Ct;class xn{constructor(e=new C(1/0,1/0,1/0),t=new C(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(hn.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(hn.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){const n=hn.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);const n=e.geometry;if(n!==void 0){const s=n.getAttribute("position");if(t===!0&&s!==void 0&&e.isInstancedMesh!==!0)for(let a=0,o=s.count;a<o;a++)e.isMesh===!0?e.getVertexPosition(a,hn):hn.fromBufferAttribute(s,a),hn.applyMatrix4(e.matrixWorld),this.expandByPoint(hn);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),Xs.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),Xs.copy(n.boundingBox)),Xs.applyMatrix4(e.matrixWorld),this.union(Xs)}const i=e.children;for(let s=0,a=i.length;s<a;s++)this.expandByObject(i[s],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,hn),hn.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(hs),qs.subVectors(this.max,hs),Si.subVectors(e.a,hs),Ei.subVectors(e.b,hs),Ti.subVectors(e.c,hs),Wn.subVectors(Ei,Si),Xn.subVectors(Ti,Ei),ri.subVectors(Si,Ti);let t=[0,-Wn.z,Wn.y,0,-Xn.z,Xn.y,0,-ri.z,ri.y,Wn.z,0,-Wn.x,Xn.z,0,-Xn.x,ri.z,0,-ri.x,-Wn.y,Wn.x,0,-Xn.y,Xn.x,0,-ri.y,ri.x,0];return!ta(t,Si,Ei,Ti,qs)||(t=[1,0,0,0,1,0,0,0,1],!ta(t,Si,Ei,Ti,qs))?!1:(Ys.crossVectors(Wn,Xn),t=[Ys.x,Ys.y,Ys.z],ta(t,Si,Ei,Ti,qs))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,hn).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(hn).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Pn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Pn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Pn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Pn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Pn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Pn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Pn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Pn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Pn),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}}const Pn=[new C,new C,new C,new C,new C,new C,new C,new C],hn=new C,Xs=new xn,Si=new C,Ei=new C,Ti=new C,Wn=new C,Xn=new C,ri=new C,hs=new C,qs=new C,Ys=new C,ai=new C;function ta(r,e,t,n,i){for(let s=0,a=r.length-3;s<=a;s+=3){ai.fromArray(r,s);const o=i.x*Math.abs(ai.x)+i.y*Math.abs(ai.y)+i.z*Math.abs(ai.z),l=e.dot(ai),c=t.dot(ai),h=n.dot(ai);if(Math.max(-Math.max(l,c,h),Math.min(l,c,h))>o)return!1}return!0}const Td=new xn,us=new C,na=new C;class En{constructor(e=new C,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){const n=this.center;t!==void 0?n.copy(t):Td.setFromPoints(e).getCenter(n);let i=0;for(let s=0,a=e.length;s<a;s++)i=Math.max(i,n.distanceToSquared(e[s]));return this.radius=Math.sqrt(i),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){const t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){const n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;us.subVectors(e,this.center);const t=us.lengthSq();if(t>this.radius*this.radius){const n=Math.sqrt(t),i=(n-this.radius)*.5;this.center.addScaledVector(us,i/n),this.radius+=i}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(na.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(us.copy(e.center).add(na)),this.expandByPoint(us.copy(e.center).sub(na))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}}const In=new C,ia=new C,$s=new C,qn=new C,sa=new C,js=new C,ra=new C;class zs{constructor(e=new C,t=new C(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,In)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);const n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){const t=In.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(In.copy(this.origin).addScaledVector(this.direction,t),In.distanceToSquared(e))}distanceSqToSegment(e,t,n,i){ia.copy(e).add(t).multiplyScalar(.5),$s.copy(t).sub(e).normalize(),qn.copy(this.origin).sub(ia);const s=e.distanceTo(t)*.5,a=-this.direction.dot($s),o=qn.dot(this.direction),l=-qn.dot($s),c=qn.lengthSq(),h=Math.abs(1-a*a);let u,d,f,m;if(h>0)if(u=a*l-o,d=a*o-l,m=s*h,u>=0)if(d>=-m)if(d<=m){const _=1/h;u*=_,d*=_,f=u*(u+a*d+2*o)+d*(a*u+d+2*l)+c}else d=s,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*l)+c;else d=-s,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*l)+c;else d<=-m?(u=Math.max(0,-(-a*s+o)),d=u>0?-s:Math.min(Math.max(-s,-l),s),f=-u*u+d*(d+2*l)+c):d<=m?(u=0,d=Math.min(Math.max(-s,-l),s),f=d*(d+2*l)+c):(u=Math.max(0,-(a*s+o)),d=u>0?s:Math.min(Math.max(-s,-l),s),f=-u*u+d*(d+2*l)+c);else d=a>0?-s:s,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*l)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,u),i&&i.copy(ia).addScaledVector($s,d),f}intersectSphere(e,t){In.subVectors(e.center,this.origin);const n=In.dot(this.direction),i=In.dot(In)-n*n,s=e.radius*e.radius;if(i>s)return null;const a=Math.sqrt(s-i),o=n-a,l=n+a;return l<0?null:o<0?this.at(l,t):this.at(o,t)}intersectsSphere(e){return this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){const t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){const n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){const t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,i,s,a,o,l;const c=1/this.direction.x,h=1/this.direction.y,u=1/this.direction.z,d=this.origin;return c>=0?(n=(e.min.x-d.x)*c,i=(e.max.x-d.x)*c):(n=(e.max.x-d.x)*c,i=(e.min.x-d.x)*c),h>=0?(s=(e.min.y-d.y)*h,a=(e.max.y-d.y)*h):(s=(e.max.y-d.y)*h,a=(e.min.y-d.y)*h),n>a||s>i||((s>n||isNaN(n))&&(n=s),(a<i||isNaN(i))&&(i=a),u>=0?(o=(e.min.z-d.z)*u,l=(e.max.z-d.z)*u):(o=(e.max.z-d.z)*u,l=(e.min.z-d.z)*u),n>l||o>i)||((o>n||n!==n)&&(n=o),(l<i||i!==i)&&(i=l),i<0)?null:this.at(n>=0?n:i,t)}intersectsBox(e){return this.intersectBox(e,In)!==null}intersectTriangle(e,t,n,i,s){sa.subVectors(t,e),js.subVectors(n,e),ra.crossVectors(sa,js);let a=this.direction.dot(ra),o;if(a>0){if(i)return null;o=1}else if(a<0)o=-1,a=-a;else return null;qn.subVectors(this.origin,e);const l=o*this.direction.dot(js.crossVectors(qn,js));if(l<0)return null;const c=o*this.direction.dot(sa.cross(qn));if(c<0||l+c>a)return null;const h=-o*qn.dot(ra);return h<0?null:this.at(h/a,s)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class Fe{constructor(e,t,n,i,s,a,o,l,c,h,u,d,f,m,_,g){Fe.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,i,s,a,o,l,c,h,u,d,f,m,_,g)}set(e,t,n,i,s,a,o,l,c,h,u,d,f,m,_,g){const p=this.elements;return p[0]=e,p[4]=t,p[8]=n,p[12]=i,p[1]=s,p[5]=a,p[9]=o,p[13]=l,p[2]=c,p[6]=h,p[10]=u,p[14]=d,p[3]=f,p[7]=m,p[11]=_,p[15]=g,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Fe().fromArray(this.elements)}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){const t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){const t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){const t=this.elements,n=e.elements,i=1/Ai.setFromMatrixColumn(e,0).length(),s=1/Ai.setFromMatrixColumn(e,1).length(),a=1/Ai.setFromMatrixColumn(e,2).length();return t[0]=n[0]*i,t[1]=n[1]*i,t[2]=n[2]*i,t[3]=0,t[4]=n[4]*s,t[5]=n[5]*s,t[6]=n[6]*s,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){const t=this.elements,n=e.x,i=e.y,s=e.z,a=Math.cos(n),o=Math.sin(n),l=Math.cos(i),c=Math.sin(i),h=Math.cos(s),u=Math.sin(s);if(e.order==="XYZ"){const d=a*h,f=a*u,m=o*h,_=o*u;t[0]=l*h,t[4]=-l*u,t[8]=c,t[1]=f+m*c,t[5]=d-_*c,t[9]=-o*l,t[2]=_-d*c,t[6]=m+f*c,t[10]=a*l}else if(e.order==="YXZ"){const d=l*h,f=l*u,m=c*h,_=c*u;t[0]=d+_*o,t[4]=m*o-f,t[8]=a*c,t[1]=a*u,t[5]=a*h,t[9]=-o,t[2]=f*o-m,t[6]=_+d*o,t[10]=a*l}else if(e.order==="ZXY"){const d=l*h,f=l*u,m=c*h,_=c*u;t[0]=d-_*o,t[4]=-a*u,t[8]=m+f*o,t[1]=f+m*o,t[5]=a*h,t[9]=_-d*o,t[2]=-a*c,t[6]=o,t[10]=a*l}else if(e.order==="ZYX"){const d=a*h,f=a*u,m=o*h,_=o*u;t[0]=l*h,t[4]=m*c-f,t[8]=d*c+_,t[1]=l*u,t[5]=_*c+d,t[9]=f*c-m,t[2]=-c,t[6]=o*l,t[10]=a*l}else if(e.order==="YZX"){const d=a*l,f=a*c,m=o*l,_=o*c;t[0]=l*h,t[4]=_-d*u,t[8]=m*u+f,t[1]=u,t[5]=a*h,t[9]=-o*h,t[2]=-c*h,t[6]=f*u+m,t[10]=d-_*u}else if(e.order==="XZY"){const d=a*l,f=a*c,m=o*l,_=o*c;t[0]=l*h,t[4]=-u,t[8]=c*h,t[1]=d*u+_,t[5]=a*h,t[9]=f*u-m,t[2]=m*u-f,t[6]=o*h,t[10]=_*u+d}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Ad,e,Rd)}lookAt(e,t,n){const i=this.elements;return Jt.subVectors(e,t),Jt.lengthSq()===0&&(Jt.z=1),Jt.normalize(),Yn.crossVectors(n,Jt),Yn.lengthSq()===0&&(Math.abs(n.z)===1?Jt.x+=1e-4:Jt.z+=1e-4,Jt.normalize(),Yn.crossVectors(n,Jt)),Yn.normalize(),Ks.crossVectors(Jt,Yn),i[0]=Yn.x,i[4]=Ks.x,i[8]=Jt.x,i[1]=Yn.y,i[5]=Ks.y,i[9]=Jt.y,i[2]=Yn.z,i[6]=Ks.z,i[10]=Jt.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,i=t.elements,s=this.elements,a=n[0],o=n[4],l=n[8],c=n[12],h=n[1],u=n[5],d=n[9],f=n[13],m=n[2],_=n[6],g=n[10],p=n[14],x=n[3],y=n[7],v=n[11],A=n[15],E=i[0],T=i[4],P=i[8],b=i[12],M=i[1],I=i[5],B=i[9],z=i[13],V=i[2],q=i[6],j=i[10],Q=i[14],N=i[3],$=i[7],W=i[11],re=i[15];return s[0]=a*E+o*M+l*V+c*N,s[4]=a*T+o*I+l*q+c*$,s[8]=a*P+o*B+l*j+c*W,s[12]=a*b+o*z+l*Q+c*re,s[1]=h*E+u*M+d*V+f*N,s[5]=h*T+u*I+d*q+f*$,s[9]=h*P+u*B+d*j+f*W,s[13]=h*b+u*z+d*Q+f*re,s[2]=m*E+_*M+g*V+p*N,s[6]=m*T+_*I+g*q+p*$,s[10]=m*P+_*B+g*j+p*W,s[14]=m*b+_*z+g*Q+p*re,s[3]=x*E+y*M+v*V+A*N,s[7]=x*T+y*I+v*q+A*$,s[11]=x*P+y*B+v*j+A*W,s[15]=x*b+y*z+v*Q+A*re,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[4],i=e[8],s=e[12],a=e[1],o=e[5],l=e[9],c=e[13],h=e[2],u=e[6],d=e[10],f=e[14],m=e[3],_=e[7],g=e[11],p=e[15];return m*(+s*l*u-i*c*u-s*o*d+n*c*d+i*o*f-n*l*f)+_*(+t*l*f-t*c*d+s*a*d-i*a*f+i*c*h-s*l*h)+g*(+t*c*u-t*o*f-s*a*u+n*a*f+s*o*h-n*c*h)+p*(-i*o*h-t*l*u+t*o*d+i*a*u-n*a*d+n*l*h)}transpose(){const e=this.elements;let t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){const i=this.elements;return e.isVector3?(i[12]=e.x,i[13]=e.y,i[14]=e.z):(i[12]=e,i[13]=t,i[14]=n),this}invert(){const e=this.elements,t=e[0],n=e[1],i=e[2],s=e[3],a=e[4],o=e[5],l=e[6],c=e[7],h=e[8],u=e[9],d=e[10],f=e[11],m=e[12],_=e[13],g=e[14],p=e[15],x=u*g*c-_*d*c+_*l*f-o*g*f-u*l*p+o*d*p,y=m*d*c-h*g*c-m*l*f+a*g*f+h*l*p-a*d*p,v=h*_*c-m*u*c+m*o*f-a*_*f-h*o*p+a*u*p,A=m*u*l-h*_*l-m*o*d+a*_*d+h*o*g-a*u*g,E=t*x+n*y+i*v+s*A;if(E===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const T=1/E;return e[0]=x*T,e[1]=(_*d*s-u*g*s-_*i*f+n*g*f+u*i*p-n*d*p)*T,e[2]=(o*g*s-_*l*s+_*i*c-n*g*c-o*i*p+n*l*p)*T,e[3]=(u*l*s-o*d*s-u*i*c+n*d*c+o*i*f-n*l*f)*T,e[4]=y*T,e[5]=(h*g*s-m*d*s+m*i*f-t*g*f-h*i*p+t*d*p)*T,e[6]=(m*l*s-a*g*s-m*i*c+t*g*c+a*i*p-t*l*p)*T,e[7]=(a*d*s-h*l*s+h*i*c-t*d*c-a*i*f+t*l*f)*T,e[8]=v*T,e[9]=(m*u*s-h*_*s-m*n*f+t*_*f+h*n*p-t*u*p)*T,e[10]=(a*_*s-m*o*s+m*n*c-t*_*c-a*n*p+t*o*p)*T,e[11]=(h*o*s-a*u*s-h*n*c+t*u*c+a*n*f-t*o*f)*T,e[12]=A*T,e[13]=(h*_*i-m*u*i+m*n*d-t*_*d-h*n*g+t*u*g)*T,e[14]=(m*o*i-a*_*i-m*n*l+t*_*l+a*n*g-t*o*g)*T,e[15]=(a*u*i-h*o*i+h*n*l-t*u*l-a*n*d+t*o*d)*T,this}scale(e){const t=this.elements,n=e.x,i=e.y,s=e.z;return t[0]*=n,t[4]*=i,t[8]*=s,t[1]*=n,t[5]*=i,t[9]*=s,t[2]*=n,t[6]*=i,t[10]*=s,t[3]*=n,t[7]*=i,t[11]*=s,this}getMaxScaleOnAxis(){const e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],i=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,i))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){const t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){const n=Math.cos(t),i=Math.sin(t),s=1-n,a=e.x,o=e.y,l=e.z,c=s*a,h=s*o;return this.set(c*a+n,c*o-i*l,c*l+i*o,0,c*o+i*l,h*o+n,h*l-i*a,0,c*l-i*o,h*l+i*a,s*l*l+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,i,s,a){return this.set(1,n,s,0,e,1,a,0,t,i,1,0,0,0,0,1),this}compose(e,t,n){const i=this.elements,s=t._x,a=t._y,o=t._z,l=t._w,c=s+s,h=a+a,u=o+o,d=s*c,f=s*h,m=s*u,_=a*h,g=a*u,p=o*u,x=l*c,y=l*h,v=l*u,A=n.x,E=n.y,T=n.z;return i[0]=(1-(_+p))*A,i[1]=(f+v)*A,i[2]=(m-y)*A,i[3]=0,i[4]=(f-v)*E,i[5]=(1-(d+p))*E,i[6]=(g+x)*E,i[7]=0,i[8]=(m+y)*T,i[9]=(g-x)*T,i[10]=(1-(d+_))*T,i[11]=0,i[12]=e.x,i[13]=e.y,i[14]=e.z,i[15]=1,this}decompose(e,t,n){const i=this.elements;let s=Ai.set(i[0],i[1],i[2]).length();const a=Ai.set(i[4],i[5],i[6]).length(),o=Ai.set(i[8],i[9],i[10]).length();this.determinant()<0&&(s=-s),e.x=i[12],e.y=i[13],e.z=i[14],un.copy(this);const c=1/s,h=1/a,u=1/o;return un.elements[0]*=c,un.elements[1]*=c,un.elements[2]*=c,un.elements[4]*=h,un.elements[5]*=h,un.elements[6]*=h,un.elements[8]*=u,un.elements[9]*=u,un.elements[10]*=u,t.setFromRotationMatrix(un),n.x=s,n.y=a,n.z=o,this}makePerspective(e,t,n,i,s,a,o=zn){const l=this.elements,c=2*s/(t-e),h=2*s/(n-i),u=(t+e)/(t-e),d=(n+i)/(n-i);let f,m;if(o===zn)f=-(a+s)/(a-s),m=-2*a*s/(a-s);else if(o===Fr)f=-a/(a-s),m=-a*s/(a-s);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+o);return l[0]=c,l[4]=0,l[8]=u,l[12]=0,l[1]=0,l[5]=h,l[9]=d,l[13]=0,l[2]=0,l[6]=0,l[10]=f,l[14]=m,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(e,t,n,i,s,a,o=zn){const l=this.elements,c=1/(t-e),h=1/(n-i),u=1/(a-s),d=(t+e)*c,f=(n+i)*h;let m,_;if(o===zn)m=(a+s)*u,_=-2*u;else if(o===Fr)m=s*u,_=-1*u;else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+o);return l[0]=2*c,l[4]=0,l[8]=0,l[12]=-d,l[1]=0,l[5]=2*h,l[9]=0,l[13]=-f,l[2]=0,l[6]=0,l[10]=_,l[14]=-m,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(e){const t=this.elements,n=e.elements;for(let i=0;i<16;i++)if(t[i]!==n[i])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}}const Ai=new C,un=new Fe,Ad=new C(0,0,0),Rd=new C(1,1,1),Yn=new C,Ks=new C,Jt=new C,Il=new Fe,Ll=new Ct;class bn{constructor(e=0,t=0,n=0,i=bn.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=i}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,i=this._order){return this._x=e,this._y=t,this._z=n,this._order=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){const i=e.elements,s=i[0],a=i[4],o=i[8],l=i[1],c=i[5],h=i[9],u=i[2],d=i[6],f=i[10];switch(t){case"XYZ":this._y=Math.asin(Ve(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-h,f),this._z=Math.atan2(-a,s)):(this._x=Math.atan2(d,c),this._z=0);break;case"YXZ":this._x=Math.asin(-Ve(h,-1,1)),Math.abs(h)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(l,c)):(this._y=Math.atan2(-u,s),this._z=0);break;case"ZXY":this._x=Math.asin(Ve(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,f),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(l,s));break;case"ZYX":this._y=Math.asin(-Ve(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(l,s)):(this._x=0,this._z=Math.atan2(-a,c));break;case"YZX":this._z=Math.asin(Ve(l,-1,1)),Math.abs(l)<.9999999?(this._x=Math.atan2(-h,c),this._y=Math.atan2(-u,s)):(this._x=0,this._y=Math.atan2(o,f));break;case"XZY":this._z=Math.asin(-Ve(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(d,c),this._y=Math.atan2(o,s)):(this._x=Math.atan2(-h,f),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return Il.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Il,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return Ll.setFromEuler(this),this.setFromQuaternion(Ll,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}bn.DEFAULT_ORDER="XYZ";class jo{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}}let Cd=0;const Dl=new C,Ri=new Ct,Ln=new Fe,Js=new C,ds=new C,Pd=new C,Id=new Ct,Nl=new C(1,0,0),Ul=new C(0,1,0),kl=new C(0,0,1),Fl={type:"added"},Ld={type:"removed"},Ci={type:"childadded",child:null},aa={type:"childremoved",child:null};class gt extends vi{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Cd++}),this.uuid=_n(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=gt.DEFAULT_UP.clone();const e=new C,t=new bn,n=new Ct,i=new C(1,1,1);function s(){n.setFromEuler(t,!1)}function a(){t.setFromQuaternion(n,void 0,!1)}t._onChange(s),n._onChange(a),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new Fe},normalMatrix:{value:new Oe}}),this.matrix=new Fe,this.matrixWorld=new Fe,this.matrixAutoUpdate=gt.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=gt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new jo,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return Ri.setFromAxisAngle(e,t),this.quaternion.multiply(Ri),this}rotateOnWorldAxis(e,t){return Ri.setFromAxisAngle(e,t),this.quaternion.premultiply(Ri),this}rotateX(e){return this.rotateOnAxis(Nl,e)}rotateY(e){return this.rotateOnAxis(Ul,e)}rotateZ(e){return this.rotateOnAxis(kl,e)}translateOnAxis(e,t){return Dl.copy(e).applyQuaternion(this.quaternion),this.position.add(Dl.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(Nl,e)}translateY(e){return this.translateOnAxis(Ul,e)}translateZ(e){return this.translateOnAxis(kl,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(Ln.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?Js.copy(e):Js.set(e,t,n);const i=this.parent;this.updateWorldMatrix(!0,!1),ds.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?Ln.lookAt(ds,Js,this.up):Ln.lookAt(Js,ds,this.up),this.quaternion.setFromRotationMatrix(Ln),i&&(Ln.extractRotation(i.matrixWorld),Ri.setFromRotationMatrix(Ln),this.quaternion.premultiply(Ri.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(Fl),Ci.child=e,this.dispatchEvent(Ci),Ci.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(Ld),aa.child=e,this.dispatchEvent(aa),aa.child=null),this}removeFromParent(){const e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),Ln.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),Ln.multiply(e.parent.matrixWorld)),e.applyMatrix4(Ln),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(Fl),Ci.child=e,this.dispatchEvent(Ci),Ci.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,i=this.children.length;n<i;n++){const a=this.children[n].getObjectByProperty(e,t);if(a!==void 0)return a}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);const i=this.children;for(let s=0,a=i.length;s<a;s++)i[s].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ds,e,Pd),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(ds,Id,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);const t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);const t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);const t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].traverseVisible(e)}traverseAncestors(e){const t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);const t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){const n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){const i=this.children;for(let s=0,a=i.length;s<a;s++)i[s].updateWorldMatrix(!1,!0)}}toJSON(e){const t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.6,type:"Object",generator:"Object3D.toJSON"});const i={};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.castShadow===!0&&(i.castShadow=!0),this.receiveShadow===!0&&(i.receiveShadow=!0),this.visible===!1&&(i.visible=!1),this.frustumCulled===!1&&(i.frustumCulled=!1),this.renderOrder!==0&&(i.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(i.userData=this.userData),i.layers=this.layers.mask,i.matrix=this.matrix.toArray(),i.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(i.matrixAutoUpdate=!1),this.isInstancedMesh&&(i.type="InstancedMesh",i.count=this.count,i.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(i.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(i.type="BatchedMesh",i.perObjectFrustumCulled=this.perObjectFrustumCulled,i.sortObjects=this.sortObjects,i.drawRanges=this._drawRanges,i.reservedRanges=this._reservedRanges,i.visibility=this._visibility,i.active=this._active,i.bounds=this._bounds.map(o=>({boxInitialized:o.boxInitialized,boxMin:o.box.min.toArray(),boxMax:o.box.max.toArray(),sphereInitialized:o.sphereInitialized,sphereRadius:o.sphere.radius,sphereCenter:o.sphere.center.toArray()})),i.maxInstanceCount=this._maxInstanceCount,i.maxVertexCount=this._maxVertexCount,i.maxIndexCount=this._maxIndexCount,i.geometryInitialized=this._geometryInitialized,i.geometryCount=this._geometryCount,i.matricesTexture=this._matricesTexture.toJSON(e),this._colorsTexture!==null&&(i.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(i.boundingSphere={center:i.boundingSphere.center.toArray(),radius:i.boundingSphere.radius}),this.boundingBox!==null&&(i.boundingBox={min:i.boundingBox.min.toArray(),max:i.boundingBox.max.toArray()}));function s(o,l){return o[l.uuid]===void 0&&(o[l.uuid]=l.toJSON(e)),l.uuid}if(this.isScene)this.background&&(this.background.isColor?i.background=this.background.toJSON():this.background.isTexture&&(i.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(i.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){i.geometry=s(e.geometries,this.geometry);const o=this.geometry.parameters;if(o!==void 0&&o.shapes!==void 0){const l=o.shapes;if(Array.isArray(l))for(let c=0,h=l.length;c<h;c++){const u=l[c];s(e.shapes,u)}else s(e.shapes,l)}}if(this.isSkinnedMesh&&(i.bindMode=this.bindMode,i.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(s(e.skeletons,this.skeleton),i.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const o=[];for(let l=0,c=this.material.length;l<c;l++)o.push(s(e.materials,this.material[l]));i.material=o}else i.material=s(e.materials,this.material);if(this.children.length>0){i.children=[];for(let o=0;o<this.children.length;o++)i.children.push(this.children[o].toJSON(e).object)}if(this.animations.length>0){i.animations=[];for(let o=0;o<this.animations.length;o++){const l=this.animations[o];i.animations.push(s(e.animations,l))}}if(t){const o=a(e.geometries),l=a(e.materials),c=a(e.textures),h=a(e.images),u=a(e.shapes),d=a(e.skeletons),f=a(e.animations),m=a(e.nodes);o.length>0&&(n.geometries=o),l.length>0&&(n.materials=l),c.length>0&&(n.textures=c),h.length>0&&(n.images=h),u.length>0&&(n.shapes=u),d.length>0&&(n.skeletons=d),f.length>0&&(n.animations=f),m.length>0&&(n.nodes=m)}return n.object=i,n;function a(o){const l=[];for(const c in o){const h=o[c];delete h.metadata,l.push(h)}return l}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){const i=e.children[n];this.add(i.clone())}return this}}gt.DEFAULT_UP=new C(0,1,0);gt.DEFAULT_MATRIX_AUTO_UPDATE=!0;gt.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const dn=new C,Dn=new C,oa=new C,Nn=new C,Pi=new C,Ii=new C,Bl=new C,la=new C,ca=new C,ha=new C,ua=new tt,da=new tt,fa=new tt;class pn{constructor(e=new C,t=new C,n=new C){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,i){i.subVectors(n,t),dn.subVectors(e,t),i.cross(dn);const s=i.lengthSq();return s>0?i.multiplyScalar(1/Math.sqrt(s)):i.set(0,0,0)}static getBarycoord(e,t,n,i,s){dn.subVectors(i,t),Dn.subVectors(n,t),oa.subVectors(e,t);const a=dn.dot(dn),o=dn.dot(Dn),l=dn.dot(oa),c=Dn.dot(Dn),h=Dn.dot(oa),u=a*c-o*o;if(u===0)return s.set(0,0,0),null;const d=1/u,f=(c*l-o*h)*d,m=(a*h-o*l)*d;return s.set(1-f-m,m,f)}static containsPoint(e,t,n,i){return this.getBarycoord(e,t,n,i,Nn)===null?!1:Nn.x>=0&&Nn.y>=0&&Nn.x+Nn.y<=1}static getInterpolation(e,t,n,i,s,a,o,l){return this.getBarycoord(e,t,n,i,Nn)===null?(l.x=0,l.y=0,"z"in l&&(l.z=0),"w"in l&&(l.w=0),null):(l.setScalar(0),l.addScaledVector(s,Nn.x),l.addScaledVector(a,Nn.y),l.addScaledVector(o,Nn.z),l)}static getInterpolatedAttribute(e,t,n,i,s,a){return ua.setScalar(0),da.setScalar(0),fa.setScalar(0),ua.fromBufferAttribute(e,t),da.fromBufferAttribute(e,n),fa.fromBufferAttribute(e,i),a.setScalar(0),a.addScaledVector(ua,s.x),a.addScaledVector(da,s.y),a.addScaledVector(fa,s.z),a}static isFrontFacing(e,t,n,i){return dn.subVectors(n,t),Dn.subVectors(e,t),dn.cross(Dn).dot(i)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,i){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[i]),this}setFromAttributeAndIndices(e,t,n,i){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,i),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return dn.subVectors(this.c,this.b),Dn.subVectors(this.a,this.b),dn.cross(Dn).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return pn.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return pn.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,i,s){return pn.getInterpolation(e,this.a,this.b,this.c,t,n,i,s)}containsPoint(e){return pn.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return pn.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){const n=this.a,i=this.b,s=this.c;let a,o;Pi.subVectors(i,n),Ii.subVectors(s,n),la.subVectors(e,n);const l=Pi.dot(la),c=Ii.dot(la);if(l<=0&&c<=0)return t.copy(n);ca.subVectors(e,i);const h=Pi.dot(ca),u=Ii.dot(ca);if(h>=0&&u<=h)return t.copy(i);const d=l*u-h*c;if(d<=0&&l>=0&&h<=0)return a=l/(l-h),t.copy(n).addScaledVector(Pi,a);ha.subVectors(e,s);const f=Pi.dot(ha),m=Ii.dot(ha);if(m>=0&&f<=m)return t.copy(s);const _=f*c-l*m;if(_<=0&&c>=0&&m<=0)return o=c/(c-m),t.copy(n).addScaledVector(Ii,o);const g=h*m-f*u;if(g<=0&&u-h>=0&&f-m>=0)return Bl.subVectors(s,i),o=(u-h)/(u-h+(f-m)),t.copy(i).addScaledVector(Bl,o);const p=1/(g+_+d);return a=_*p,o=d*p,t.copy(n).addScaledVector(Pi,a).addScaledVector(Ii,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}}const bh={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},$n={h:0,s:0,l:0},Zs={h:0,s:0,l:0};function pa(r,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?r+(e-r)*6*t:t<1/2?e:t<2/3?r+(e-r)*6*(2/3-t):r}class Te{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){const i=e;i&&i.isColor?this.copy(i):typeof i=="number"?this.setHex(i):typeof i=="string"&&this.setStyle(i)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=Mt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,Je.toWorkingColorSpace(this,t),this}setRGB(e,t,n,i=Je.workingColorSpace){return this.r=e,this.g=t,this.b=n,Je.toWorkingColorSpace(this,i),this}setHSL(e,t,n,i=Je.workingColorSpace){if(e=$o(e,1),t=Ve(t,0,1),n=Ve(n,0,1),t===0)this.r=this.g=this.b=n;else{const s=n<=.5?n*(1+t):n+t-n*t,a=2*n-s;this.r=pa(a,s,e+1/3),this.g=pa(a,s,e),this.b=pa(a,s,e-1/3)}return Je.toWorkingColorSpace(this,i),this}setStyle(e,t=Mt){function n(s){s!==void 0&&parseFloat(s)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let i;if(i=/^(\w+)\(([^\)]*)\)/.exec(e)){let s;const a=i[1],o=i[2];switch(a){case"rgb":case"rgba":if(s=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setRGB(Math.min(255,parseInt(s[1],10))/255,Math.min(255,parseInt(s[2],10))/255,Math.min(255,parseInt(s[3],10))/255,t);if(s=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setRGB(Math.min(100,parseInt(s[1],10))/100,Math.min(100,parseInt(s[2],10))/100,Math.min(100,parseInt(s[3],10))/100,t);break;case"hsl":case"hsla":if(s=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(s[4]),this.setHSL(parseFloat(s[1])/360,parseFloat(s[2])/100,parseFloat(s[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(i=/^\#([A-Fa-f\d]+)$/.exec(e)){const s=i[1],a=s.length;if(a===3)return this.setRGB(parseInt(s.charAt(0),16)/15,parseInt(s.charAt(1),16)/15,parseInt(s.charAt(2),16)/15,t);if(a===6)return this.setHex(parseInt(s,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=Mt){const n=bh[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=Hn(e.r),this.g=Hn(e.g),this.b=Hn(e.b),this}copyLinearToSRGB(e){return this.r=Gi(e.r),this.g=Gi(e.g),this.b=Gi(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Mt){return Je.fromWorkingColorSpace(Ft.copy(this),e),Math.round(Ve(Ft.r*255,0,255))*65536+Math.round(Ve(Ft.g*255,0,255))*256+Math.round(Ve(Ft.b*255,0,255))}getHexString(e=Mt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=Je.workingColorSpace){Je.fromWorkingColorSpace(Ft.copy(this),t);const n=Ft.r,i=Ft.g,s=Ft.b,a=Math.max(n,i,s),o=Math.min(n,i,s);let l,c;const h=(o+a)/2;if(o===a)l=0,c=0;else{const u=a-o;switch(c=h<=.5?u/(a+o):u/(2-a-o),a){case n:l=(i-s)/u+(i<s?6:0);break;case i:l=(s-n)/u+2;break;case s:l=(n-i)/u+4;break}l/=6}return e.h=l,e.s=c,e.l=h,e}getRGB(e,t=Je.workingColorSpace){return Je.fromWorkingColorSpace(Ft.copy(this),t),e.r=Ft.r,e.g=Ft.g,e.b=Ft.b,e}getStyle(e=Mt){Je.fromWorkingColorSpace(Ft.copy(this),e);const t=Ft.r,n=Ft.g,i=Ft.b;return e!==Mt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${i.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(i*255)})`}offsetHSL(e,t,n){return this.getHSL($n),this.setHSL($n.h+e,$n.s+t,$n.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL($n),e.getHSL(Zs);const n=Rs($n.h,Zs.h,t),i=Rs($n.s,Zs.s,t),s=Rs($n.l,Zs.l,t);return this.setHSL(n,i,s),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){const t=this.r,n=this.g,i=this.b,s=e.elements;return this.r=s[0]*t+s[3]*n+s[6]*i,this.g=s[1]*t+s[4]*n+s[7]*i,this.b=s[2]*t+s[5]*n+s[8]*i,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const Ft=new Te;Te.NAMES=bh;let Dd=0;class wn extends vi{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Dd++}),this.uuid=_n(),this.name="",this.type="Material",this.blending=Hi,this.side=Vn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Ha,this.blendDst=Va,this.blendEquation=pi,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Te(0,0,0),this.blendAlpha=0,this.depthFunc=qi,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Sl,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=wi,this.stencilZFail=wi,this.stencilZPass=wi,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(const t in e){const n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}const i=this[t];if(i===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}i&&i.isColor?i.set(n):i&&i.isVector3&&n&&n.isVector3?i.copy(n):this[t]=n}}toJSON(e){const t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});const n={metadata:{version:4.6,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==Hi&&(n.blending=this.blending),this.side!==Vn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Ha&&(n.blendSrc=this.blendSrc),this.blendDst!==Va&&(n.blendDst=this.blendDst),this.blendEquation!==pi&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==qi&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Sl&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==wi&&(n.stencilFail=this.stencilFail),this.stencilZFail!==wi&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==wi&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function i(s){const a=[];for(const o in s){const l=s[o];delete l.metadata,a.push(l)}return a}if(t){const s=i(e.textures),a=i(e.images);s.length>0&&(n.textures=s),a.length>0&&(n.images=a)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;const t=e.clippingPlanes;let n=null;if(t!==null){const i=t.length;n=new Array(i);for(let s=0;s!==i;++s)n[s]=t[s].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}onBuild(){console.warn("Material: onBuild() has been removed.")}}class ut extends wn{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new Te(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new bn,this.combine=ih,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}}const yt=new C,Qs=new pe;class Ot{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=To,this.updateRanges=[],this.gpuType=mn,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let i=0,s=this.itemSize;i<s;i++)this.array[e+i]=t.array[n+i];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)Qs.fromBufferAttribute(this,t),Qs.applyMatrix3(e),this.setXY(t,Qs.x,Qs.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)yt.fromBufferAttribute(this,t),yt.applyMatrix3(e),this.setXYZ(t,yt.x,yt.y,yt.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)yt.fromBufferAttribute(this,t),yt.applyMatrix4(e),this.setXYZ(t,yt.x,yt.y,yt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)yt.fromBufferAttribute(this,t),yt.applyNormalMatrix(e),this.setXYZ(t,yt.x,yt.y,yt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)yt.fromBufferAttribute(this,t),yt.transformDirection(e),this.setXYZ(t,yt.x,yt.y,yt.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=fn(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=ot(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=fn(t,this.array)),t}setX(e,t){return this.normalized&&(t=ot(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=fn(t,this.array)),t}setY(e,t){return this.normalized&&(t=ot(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=fn(t,this.array)),t}setZ(e,t){return this.normalized&&(t=ot(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=fn(t,this.array)),t}setW(e,t){return this.normalized&&(t=ot(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=ot(t,this.array),n=ot(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,i){return e*=this.itemSize,this.normalized&&(t=ot(t,this.array),n=ot(n,this.array),i=ot(i,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=i,this}setXYZW(e,t,n,i,s){return e*=this.itemSize,this.normalized&&(t=ot(t,this.array),n=ot(n,this.array),i=ot(i,this.array),s=ot(s,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=i,this.array[e+3]=s,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==To&&(e.usage=this.usage),e}}class Sh extends Ot{constructor(e,t,n){super(new Uint16Array(e),t,n)}}class Eh extends Ot{constructor(e,t,n){super(new Uint32Array(e),t,n)}}class rt extends Ot{constructor(e,t,n){super(new Float32Array(e),t,n)}}let Nd=0;const nn=new Fe,ma=new gt,Li=new C,Zt=new xn,fs=new xn,Tt=new C;class Pt extends vi{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:Nd++}),this.uuid=_n(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(yh(e)?Eh:Sh)(e,1):this.index=e,this}setIndirect(e){return this.indirect=e,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){const t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const s=new Oe().getNormalMatrix(e);n.applyNormalMatrix(s),n.needsUpdate=!0}const i=this.attributes.tangent;return i!==void 0&&(i.transformDirection(e),i.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return nn.makeRotationFromQuaternion(e),this.applyMatrix4(nn),this}rotateX(e){return nn.makeRotationX(e),this.applyMatrix4(nn),this}rotateY(e){return nn.makeRotationY(e),this.applyMatrix4(nn),this}rotateZ(e){return nn.makeRotationZ(e),this.applyMatrix4(nn),this}translate(e,t,n){return nn.makeTranslation(e,t,n),this.applyMatrix4(nn),this}scale(e,t,n){return nn.makeScale(e,t,n),this.applyMatrix4(nn),this}lookAt(e){return ma.lookAt(e),ma.updateMatrix(),this.applyMatrix4(ma.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Li).negate(),this.translate(Li.x,Li.y,Li.z),this}setFromPoints(e){const t=this.getAttribute("position");if(t===void 0){const n=[];for(let i=0,s=e.length;i<s;i++){const a=e[i];n.push(a.x,a.y,a.z||0)}this.setAttribute("position",new rt(n,3))}else{const n=Math.min(e.length,t.count);for(let i=0;i<n;i++){const s=e[i];t.setXYZ(i,s.x,s.y,s.z||0)}e.length>t.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new xn);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new C(-1/0,-1/0,-1/0),new C(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,i=t.length;n<i;n++){const s=t[n];Zt.setFromBufferAttribute(s),this.morphTargetsRelative?(Tt.addVectors(this.boundingBox.min,Zt.min),this.boundingBox.expandByPoint(Tt),Tt.addVectors(this.boundingBox.max,Zt.max),this.boundingBox.expandByPoint(Tt)):(this.boundingBox.expandByPoint(Zt.min),this.boundingBox.expandByPoint(Zt.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new En);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new C,1/0);return}if(e){const n=this.boundingSphere.center;if(Zt.setFromBufferAttribute(e),t)for(let s=0,a=t.length;s<a;s++){const o=t[s];fs.setFromBufferAttribute(o),this.morphTargetsRelative?(Tt.addVectors(Zt.min,fs.min),Zt.expandByPoint(Tt),Tt.addVectors(Zt.max,fs.max),Zt.expandByPoint(Tt)):(Zt.expandByPoint(fs.min),Zt.expandByPoint(fs.max))}Zt.getCenter(n);let i=0;for(let s=0,a=e.count;s<a;s++)Tt.fromBufferAttribute(e,s),i=Math.max(i,n.distanceToSquared(Tt));if(t)for(let s=0,a=t.length;s<a;s++){const o=t[s],l=this.morphTargetsRelative;for(let c=0,h=o.count;c<h;c++)Tt.fromBufferAttribute(o,c),l&&(Li.fromBufferAttribute(e,c),Tt.add(Li)),i=Math.max(i,n.distanceToSquared(Tt))}this.boundingSphere.radius=Math.sqrt(i),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=t.position,i=t.normal,s=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new Ot(new Float32Array(4*n.count),4));const a=this.getAttribute("tangent"),o=[],l=[];for(let P=0;P<n.count;P++)o[P]=new C,l[P]=new C;const c=new C,h=new C,u=new C,d=new pe,f=new pe,m=new pe,_=new C,g=new C;function p(P,b,M){c.fromBufferAttribute(n,P),h.fromBufferAttribute(n,b),u.fromBufferAttribute(n,M),d.fromBufferAttribute(s,P),f.fromBufferAttribute(s,b),m.fromBufferAttribute(s,M),h.sub(c),u.sub(c),f.sub(d),m.sub(d);const I=1/(f.x*m.y-m.x*f.y);isFinite(I)&&(_.copy(h).multiplyScalar(m.y).addScaledVector(u,-f.y).multiplyScalar(I),g.copy(u).multiplyScalar(f.x).addScaledVector(h,-m.x).multiplyScalar(I),o[P].add(_),o[b].add(_),o[M].add(_),l[P].add(g),l[b].add(g),l[M].add(g))}let x=this.groups;x.length===0&&(x=[{start:0,count:e.count}]);for(let P=0,b=x.length;P<b;++P){const M=x[P],I=M.start,B=M.count;for(let z=I,V=I+B;z<V;z+=3)p(e.getX(z+0),e.getX(z+1),e.getX(z+2))}const y=new C,v=new C,A=new C,E=new C;function T(P){A.fromBufferAttribute(i,P),E.copy(A);const b=o[P];y.copy(b),y.sub(A.multiplyScalar(A.dot(b))).normalize(),v.crossVectors(E,b);const I=v.dot(l[P])<0?-1:1;a.setXYZW(P,y.x,y.y,y.z,I)}for(let P=0,b=x.length;P<b;++P){const M=x[P],I=M.start,B=M.count;for(let z=I,V=I+B;z<V;z+=3)T(e.getX(z+0)),T(e.getX(z+1)),T(e.getX(z+2))}}computeVertexNormals(){const e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new Ot(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let d=0,f=n.count;d<f;d++)n.setXYZ(d,0,0,0);const i=new C,s=new C,a=new C,o=new C,l=new C,c=new C,h=new C,u=new C;if(e)for(let d=0,f=e.count;d<f;d+=3){const m=e.getX(d+0),_=e.getX(d+1),g=e.getX(d+2);i.fromBufferAttribute(t,m),s.fromBufferAttribute(t,_),a.fromBufferAttribute(t,g),h.subVectors(a,s),u.subVectors(i,s),h.cross(u),o.fromBufferAttribute(n,m),l.fromBufferAttribute(n,_),c.fromBufferAttribute(n,g),o.add(h),l.add(h),c.add(h),n.setXYZ(m,o.x,o.y,o.z),n.setXYZ(_,l.x,l.y,l.z),n.setXYZ(g,c.x,c.y,c.z)}else for(let d=0,f=t.count;d<f;d+=3)i.fromBufferAttribute(t,d+0),s.fromBufferAttribute(t,d+1),a.fromBufferAttribute(t,d+2),h.subVectors(a,s),u.subVectors(i,s),h.cross(u),n.setXYZ(d+0,h.x,h.y,h.z),n.setXYZ(d+1,h.x,h.y,h.z),n.setXYZ(d+2,h.x,h.y,h.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)Tt.fromBufferAttribute(e,t),Tt.normalize(),e.setXYZ(t,Tt.x,Tt.y,Tt.z)}toNonIndexed(){function e(o,l){const c=o.array,h=o.itemSize,u=o.normalized,d=new c.constructor(l.length*h);let f=0,m=0;for(let _=0,g=l.length;_<g;_++){o.isInterleavedBufferAttribute?f=l[_]*o.data.stride+o.offset:f=l[_]*h;for(let p=0;p<h;p++)d[m++]=c[f++]}return new Ot(d,h,u)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const t=new Pt,n=this.index.array,i=this.attributes;for(const o in i){const l=i[o],c=e(l,n);t.setAttribute(o,c)}const s=this.morphAttributes;for(const o in s){const l=[],c=s[o];for(let h=0,u=c.length;h<u;h++){const d=c[h],f=e(d,n);l.push(f)}t.morphAttributes[o]=l}t.morphTargetsRelative=this.morphTargetsRelative;const a=this.groups;for(let o=0,l=a.length;o<l;o++){const c=a[o];t.addGroup(c.start,c.count,c.materialIndex)}return t}toJSON(){const e={metadata:{version:4.6,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){const l=this.parameters;for(const c in l)l[c]!==void 0&&(e[c]=l[c]);return e}e.data={attributes:{}};const t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});const n=this.attributes;for(const l in n){const c=n[l];e.data.attributes[l]=c.toJSON(e.data)}const i={};let s=!1;for(const l in this.morphAttributes){const c=this.morphAttributes[l],h=[];for(let u=0,d=c.length;u<d;u++){const f=c[u];h.push(f.toJSON(e.data))}h.length>0&&(i[l]=h,s=!0)}s&&(e.data.morphAttributes=i,e.data.morphTargetsRelative=this.morphTargetsRelative);const a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));const o=this.boundingSphere;return o!==null&&(e.data.boundingSphere={center:o.center.toArray(),radius:o.radius}),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const t={};this.name=e.name;const n=e.index;n!==null&&this.setIndex(n.clone(t));const i=e.attributes;for(const c in i){const h=i[c];this.setAttribute(c,h.clone(t))}const s=e.morphAttributes;for(const c in s){const h=[],u=s[c];for(let d=0,f=u.length;d<f;d++)h.push(u[d].clone(t));this.morphAttributes[c]=h}this.morphTargetsRelative=e.morphTargetsRelative;const a=e.groups;for(let c=0,h=a.length;c<h;c++){const u=a[c];this.addGroup(u.start,u.count,u.materialIndex)}const o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());const l=e.boundingSphere;return l!==null&&(this.boundingSphere=l.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const Ol=new Fe,oi=new zs,er=new En,zl=new C,tr=new C,nr=new C,ir=new C,ga=new C,sr=new C,Hl=new C,rr=new C;class D extends gt{constructor(e=new Pt,t=new ut){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=i.length;s<a;s++){const o=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}getVertexPosition(e,t){const n=this.geometry,i=n.attributes.position,s=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(i,e);const o=this.morphTargetInfluences;if(s&&o){sr.set(0,0,0);for(let l=0,c=s.length;l<c;l++){const h=o[l],u=s[l];h!==0&&(ga.fromBufferAttribute(u,e),a?sr.addScaledVector(ga,h):sr.addScaledVector(ga.sub(t),h))}t.add(sr)}return t}raycast(e,t){const n=this.geometry,i=this.material,s=this.matrixWorld;i!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),er.copy(n.boundingSphere),er.applyMatrix4(s),oi.copy(e.ray).recast(e.near),!(er.containsPoint(oi.origin)===!1&&(oi.intersectSphere(er,zl)===null||oi.origin.distanceToSquared(zl)>(e.far-e.near)**2))&&(Ol.copy(s).invert(),oi.copy(e.ray).applyMatrix4(Ol),!(n.boundingBox!==null&&oi.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,oi)))}_computeIntersections(e,t,n){let i;const s=this.geometry,a=this.material,o=s.index,l=s.attributes.position,c=s.attributes.uv,h=s.attributes.uv1,u=s.attributes.normal,d=s.groups,f=s.drawRange;if(o!==null)if(Array.isArray(a))for(let m=0,_=d.length;m<_;m++){const g=d[m],p=a[g.materialIndex],x=Math.max(g.start,f.start),y=Math.min(o.count,Math.min(g.start+g.count,f.start+f.count));for(let v=x,A=y;v<A;v+=3){const E=o.getX(v),T=o.getX(v+1),P=o.getX(v+2);i=ar(this,p,e,n,c,h,u,E,T,P),i&&(i.faceIndex=Math.floor(v/3),i.face.materialIndex=g.materialIndex,t.push(i))}}else{const m=Math.max(0,f.start),_=Math.min(o.count,f.start+f.count);for(let g=m,p=_;g<p;g+=3){const x=o.getX(g),y=o.getX(g+1),v=o.getX(g+2);i=ar(this,a,e,n,c,h,u,x,y,v),i&&(i.faceIndex=Math.floor(g/3),t.push(i))}}else if(l!==void 0)if(Array.isArray(a))for(let m=0,_=d.length;m<_;m++){const g=d[m],p=a[g.materialIndex],x=Math.max(g.start,f.start),y=Math.min(l.count,Math.min(g.start+g.count,f.start+f.count));for(let v=x,A=y;v<A;v+=3){const E=v,T=v+1,P=v+2;i=ar(this,p,e,n,c,h,u,E,T,P),i&&(i.faceIndex=Math.floor(v/3),i.face.materialIndex=g.materialIndex,t.push(i))}}else{const m=Math.max(0,f.start),_=Math.min(l.count,f.start+f.count);for(let g=m,p=_;g<p;g+=3){const x=g,y=g+1,v=g+2;i=ar(this,a,e,n,c,h,u,x,y,v),i&&(i.faceIndex=Math.floor(g/3),t.push(i))}}}}function Ud(r,e,t,n,i,s,a,o){let l;if(e.side===Gt?l=n.intersectTriangle(a,s,i,!0,o):l=n.intersectTriangle(i,s,a,e.side===Vn,o),l===null)return null;rr.copy(o),rr.applyMatrix4(r.matrixWorld);const c=t.ray.origin.distanceTo(rr);return c<t.near||c>t.far?null:{distance:c,point:rr.clone(),object:r}}function ar(r,e,t,n,i,s,a,o,l,c){r.getVertexPosition(o,tr),r.getVertexPosition(l,nr),r.getVertexPosition(c,ir);const h=Ud(r,e,t,n,tr,nr,ir,Hl);if(h){const u=new C;pn.getBarycoord(Hl,tr,nr,ir,u),i&&(h.uv=pn.getInterpolatedAttribute(i,o,l,c,u,new pe)),s&&(h.uv1=pn.getInterpolatedAttribute(s,o,l,c,u,new pe)),a&&(h.normal=pn.getInterpolatedAttribute(a,o,l,c,u,new C),h.normal.dot(n.direction)>0&&h.normal.multiplyScalar(-1));const d={a:o,b:l,c,normal:new C,materialIndex:0};pn.getNormal(tr,nr,ir,d.normal),h.face=d,h.barycoord=u}return h}class We extends Pt{constructor(e=1,t=1,n=1,i=1,s=1,a=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:i,heightSegments:s,depthSegments:a};const o=this;i=Math.floor(i),s=Math.floor(s),a=Math.floor(a);const l=[],c=[],h=[],u=[];let d=0,f=0;m("z","y","x",-1,-1,n,t,e,a,s,0),m("z","y","x",1,-1,n,t,-e,a,s,1),m("x","z","y",1,1,e,n,t,i,a,2),m("x","z","y",1,-1,e,n,-t,i,a,3),m("x","y","z",1,-1,e,t,n,i,s,4),m("x","y","z",-1,-1,e,t,-n,i,s,5),this.setIndex(l),this.setAttribute("position",new rt(c,3)),this.setAttribute("normal",new rt(h,3)),this.setAttribute("uv",new rt(u,2));function m(_,g,p,x,y,v,A,E,T,P,b){const M=v/T,I=A/P,B=v/2,z=A/2,V=E/2,q=T+1,j=P+1;let Q=0,N=0;const $=new C;for(let W=0;W<j;W++){const re=W*I-z;for(let me=0;me<q;me++){const Ue=me*M-B;$[_]=Ue*x,$[g]=re*y,$[p]=V,c.push($.x,$.y,$.z),$[_]=0,$[g]=0,$[p]=E>0?1:-1,h.push($.x,$.y,$.z),u.push(me/T),u.push(1-W/P),Q+=1}}for(let W=0;W<P;W++)for(let re=0;re<T;re++){const me=d+re+q*W,Ue=d+re+q*(W+1),X=d+(re+1)+q*(W+1),ee=d+(re+1)+q*W;l.push(me,Ue,ee),l.push(Ue,X,ee),N+=6}o.addGroup(f,N,b),f+=N,d+=Q}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new We(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}}function Qi(r){const e={};for(const t in r){e[t]={};for(const n in r[t]){const i=r[t][n];i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)?i.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=i.clone():Array.isArray(i)?e[t][n]=i.slice():e[t][n]=i}}return e}function Vt(r){const e={};for(let t=0;t<r.length;t++){const n=Qi(r[t]);for(const i in n)e[i]=n[i]}return e}function kd(r){const e=[];for(let t=0;t<r.length;t++)e.push(r[t].clone());return e}function Th(r){const e=r.getRenderTarget();return e===null?r.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:Je.workingColorSpace}const Fd={clone:Qi,merge:Vt};var Bd=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Od=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class Sn extends wn{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Bd,this.fragmentShader=Od,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Qi(e.uniforms),this.uniformsGroups=kd(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){const t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(const i in this.uniforms){const a=this.uniforms[i].value;a&&a.isTexture?t.uniforms[i]={type:"t",value:a.toJSON(e).uuid}:a&&a.isColor?t.uniforms[i]={type:"c",value:a.getHex()}:a&&a.isVector2?t.uniforms[i]={type:"v2",value:a.toArray()}:a&&a.isVector3?t.uniforms[i]={type:"v3",value:a.toArray()}:a&&a.isVector4?t.uniforms[i]={type:"v4",value:a.toArray()}:a&&a.isMatrix3?t.uniforms[i]={type:"m3",value:a.toArray()}:a&&a.isMatrix4?t.uniforms[i]={type:"m4",value:a.toArray()}:t.uniforms[i]={value:a}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;const n={};for(const i in this.extensions)this.extensions[i]===!0&&(n[i]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}}class Ah extends gt{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Fe,this.projectionMatrix=new Fe,this.projectionMatrixInverse=new Fe,this.coordinateSystem=zn}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const jn=new C,Vl=new pe,Gl=new pe;class Bt extends Ah{constructor(e=50,t=1,n=.1,i=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=i,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){const t=.5*this.getFilmHeight()/e;this.fov=Zi*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){const e=Math.tan(As*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Zi*2*Math.atan(Math.tan(As*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){jn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(jn.x,jn.y).multiplyScalar(-e/jn.z),jn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(jn.x,jn.y).multiplyScalar(-e/jn.z)}getViewSize(e,t){return this.getViewBounds(e,Vl,Gl),t.subVectors(Gl,Vl)}setViewOffset(e,t,n,i,s,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=i,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=this.near;let t=e*Math.tan(As*.5*this.fov)/this.zoom,n=2*t,i=this.aspect*n,s=-.5*i;const a=this.view;if(this.view!==null&&this.view.enabled){const l=a.fullWidth,c=a.fullHeight;s+=a.offsetX*i/l,t-=a.offsetY*n/c,i*=a.width/l,n*=a.height/c}const o=this.filmOffset;o!==0&&(s+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(s,s+i,t,t-n,e,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}}const Di=-90,Ni=1;class zd extends gt{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const i=new Bt(Di,Ni,e,t);i.layers=this.layers,this.add(i);const s=new Bt(Di,Ni,e,t);s.layers=this.layers,this.add(s);const a=new Bt(Di,Ni,e,t);a.layers=this.layers,this.add(a);const o=new Bt(Di,Ni,e,t);o.layers=this.layers,this.add(o);const l=new Bt(Di,Ni,e,t);l.layers=this.layers,this.add(l);const c=new Bt(Di,Ni,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){const e=this.coordinateSystem,t=this.children.concat(),[n,i,s,a,o,l]=t;for(const c of t)this.remove(c);if(e===zn)n.up.set(0,1,0),n.lookAt(1,0,0),i.up.set(0,1,0),i.lookAt(-1,0,0),s.up.set(0,0,-1),s.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),l.up.set(0,1,0),l.lookAt(0,0,-1);else if(e===Fr)n.up.set(0,-1,0),n.lookAt(-1,0,0),i.up.set(0,-1,0),i.lookAt(1,0,0),s.up.set(0,0,1),s.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),l.up.set(0,-1,0),l.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(const c of t)this.add(c),c.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:i}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());const[s,a,o,l,c,h]=this.children,u=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),m=e.xr.enabled;e.xr.enabled=!1;const _=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,i),e.render(t,s),e.setRenderTarget(n,1,i),e.render(t,a),e.setRenderTarget(n,2,i),e.render(t,o),e.setRenderTarget(n,3,i),e.render(t,l),e.setRenderTarget(n,4,i),e.render(t,c),n.texture.generateMipmaps=_,e.setRenderTarget(n,5,i),e.render(t,h),e.setRenderTarget(u,d,f),e.xr.enabled=m,n.texture.needsPMREMUpdate=!0}}class Rh extends bt{constructor(e,t,n,i,s,a,o,l,c,h){e=e!==void 0?e:[],t=t!==void 0?t:Yi,super(e,t,n,i,s,a,o,l,c,h),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}}class Hd extends _i{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;const n={width:e,height:e,depth:1},i=[n,n,n,n,n,n];this.texture=new Rh(i,t.mapping,t.wrapS,t.wrapT,t.magFilter,t.minFilter,t.format,t.type,t.anisotropy,t.colorSpace),this.texture.isRenderTargetTexture=!0,this.texture.generateMipmaps=t.generateMipmaps!==void 0?t.generateMipmaps:!1,this.texture.minFilter=t.minFilter!==void 0?t.minFilter:Dt}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},i=new We(5,5,5),s=new Sn({name:"CubemapFromEquirect",uniforms:Qi(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:Gt,blending:ti});s.uniforms.tEquirect.value=t;const a=new D(i,s),o=t.minFilter;return t.minFilter===On&&(t.minFilter=Dt),new zd(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t,n,i){const s=e.getRenderTarget();for(let a=0;a<6;a++)e.setRenderTarget(this,a),e.clear(t,n,i);e.setRenderTarget(s)}}class Ko{constructor(e,t=1,n=1e3){this.isFog=!0,this.name="",this.color=new Te(e),this.near=t,this.far=n}clone(){return new Ko(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}}class Ch extends gt{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new bn,this.environmentIntensity=1,this.environmentRotation=new bn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){const t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}}class Vd{constructor(e,t){this.isInterleavedBuffer=!0,this.array=e,this.stride=t,this.count=e!==void 0?e.length/t:0,this.usage=To,this.updateRanges=[],this.version=0,this.uuid=_n()}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.array=new e.array.constructor(e.array),this.count=e.count,this.stride=e.stride,this.usage=e.usage,this}copyAt(e,t,n){e*=this.stride,n*=t.stride;for(let i=0,s=this.stride;i<s;i++)this.array[e+i]=t.array[n+i];return this}set(e,t=0){return this.array.set(e,t),this}clone(e){e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=_n()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);const t=new this.array.constructor(e.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(t,this.stride);return n.setUsage(this.usage),n}onUpload(e){return this.onUploadCallback=e,this}toJSON(e){return e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=_n()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}}const Ht=new C;class Jo{constructor(e,t,n,i=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=e,this.itemSize=t,this.offset=n,this.normalized=i}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(e){this.data.needsUpdate=e}applyMatrix4(e){for(let t=0,n=this.data.count;t<n;t++)Ht.fromBufferAttribute(this,t),Ht.applyMatrix4(e),this.setXYZ(t,Ht.x,Ht.y,Ht.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Ht.fromBufferAttribute(this,t),Ht.applyNormalMatrix(e),this.setXYZ(t,Ht.x,Ht.y,Ht.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Ht.fromBufferAttribute(this,t),Ht.transformDirection(e),this.setXYZ(t,Ht.x,Ht.y,Ht.z);return this}getComponent(e,t){let n=this.array[e*this.data.stride+this.offset+t];return this.normalized&&(n=fn(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=ot(n,this.array)),this.data.array[e*this.data.stride+this.offset+t]=n,this}setX(e,t){return this.normalized&&(t=ot(t,this.array)),this.data.array[e*this.data.stride+this.offset]=t,this}setY(e,t){return this.normalized&&(t=ot(t,this.array)),this.data.array[e*this.data.stride+this.offset+1]=t,this}setZ(e,t){return this.normalized&&(t=ot(t,this.array)),this.data.array[e*this.data.stride+this.offset+2]=t,this}setW(e,t){return this.normalized&&(t=ot(t,this.array)),this.data.array[e*this.data.stride+this.offset+3]=t,this}getX(e){let t=this.data.array[e*this.data.stride+this.offset];return this.normalized&&(t=fn(t,this.array)),t}getY(e){let t=this.data.array[e*this.data.stride+this.offset+1];return this.normalized&&(t=fn(t,this.array)),t}getZ(e){let t=this.data.array[e*this.data.stride+this.offset+2];return this.normalized&&(t=fn(t,this.array)),t}getW(e){let t=this.data.array[e*this.data.stride+this.offset+3];return this.normalized&&(t=fn(t,this.array)),t}setXY(e,t,n){return e=e*this.data.stride+this.offset,this.normalized&&(t=ot(t,this.array),n=ot(n,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this}setXYZ(e,t,n,i){return e=e*this.data.stride+this.offset,this.normalized&&(t=ot(t,this.array),n=ot(n,this.array),i=ot(i,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=i,this}setXYZW(e,t,n,i,s){return e=e*this.data.stride+this.offset,this.normalized&&(t=ot(t,this.array),n=ot(n,this.array),i=ot(i,this.array),s=ot(s,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=i,this.data.array[e+3]=s,this}clone(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");const t=[];for(let n=0;n<this.count;n++){const i=n*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)t.push(this.data.array[i+s])}return new Ot(new this.array.constructor(t),this.itemSize,this.normalized)}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.clone(e)),new Jo(e.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");const t=[];for(let n=0;n<this.count;n++){const i=n*this.data.stride+this.offset;for(let s=0;s<this.itemSize;s++)t.push(this.data.array[i+s])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:t,normalized:this.normalized}}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.toJSON(e)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}}const Wl=new C,Xl=new tt,ql=new tt,Gd=new C,Yl=new Fe,or=new C,_a=new En,$l=new Fe,xa=new zs;class Wd extends D{constructor(e,t){super(e,t),this.isSkinnedMesh=!0,this.type="SkinnedMesh",this.bindMode=bl,this.bindMatrix=new Fe,this.bindMatrixInverse=new Fe,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){const e=this.geometry;this.boundingBox===null&&(this.boundingBox=new xn),this.boundingBox.makeEmpty();const t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,or),this.boundingBox.expandByPoint(or)}computeBoundingSphere(){const e=this.geometry;this.boundingSphere===null&&(this.boundingSphere=new En),this.boundingSphere.makeEmpty();const t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,or),this.boundingSphere.expandByPoint(or)}copy(e,t){return super.copy(e,t),this.bindMode=e.bindMode,this.bindMatrix.copy(e.bindMatrix),this.bindMatrixInverse.copy(e.bindMatrixInverse),this.skeleton=e.skeleton,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}raycast(e,t){const n=this.material,i=this.matrixWorld;n!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),_a.copy(this.boundingSphere),_a.applyMatrix4(i),e.ray.intersectsSphere(_a)!==!1&&($l.copy(i).invert(),xa.copy(e.ray).applyMatrix4($l),!(this.boundingBox!==null&&xa.intersectsBox(this.boundingBox)===!1)&&this._computeIntersections(e,t,xa)))}getVertexPosition(e,t){return super.getVertexPosition(e,t),this.applyBoneTransform(e,t),t}bind(e,t){this.skeleton=e,t===void 0&&(this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),t=this.matrixWorld),this.bindMatrix.copy(t),this.bindMatrixInverse.copy(t).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){const e=new tt,t=this.geometry.attributes.skinWeight;for(let n=0,i=t.count;n<i;n++){e.fromBufferAttribute(t,n);const s=1/e.manhattanLength();s!==1/0?e.multiplyScalar(s):e.set(1,0,0,0),t.setXYZW(n,e.x,e.y,e.z,e.w)}}updateMatrixWorld(e){super.updateMatrixWorld(e),this.bindMode===bl?this.bindMatrixInverse.copy(this.matrixWorld).invert():this.bindMode===Bu?this.bindMatrixInverse.copy(this.bindMatrix).invert():console.warn("THREE.SkinnedMesh: Unrecognized bindMode: "+this.bindMode)}applyBoneTransform(e,t){const n=this.skeleton,i=this.geometry;Xl.fromBufferAttribute(i.attributes.skinIndex,e),ql.fromBufferAttribute(i.attributes.skinWeight,e),Wl.copy(t).applyMatrix4(this.bindMatrix),t.set(0,0,0);for(let s=0;s<4;s++){const a=ql.getComponent(s);if(a!==0){const o=Xl.getComponent(s);Yl.multiplyMatrices(n.bones[o].matrixWorld,n.boneInverses[o]),t.addScaledVector(Gd.copy(Wl).applyMatrix4(Yl),a)}}return t.applyMatrix4(this.bindMatrixInverse)}}class Ph extends gt{constructor(){super(),this.isBone=!0,this.type="Bone"}}class Ih extends bt{constructor(e=null,t=1,n=1,i,s,a,o,l,c=Wt,h=Wt,u,d){super(null,a,o,l,c,h,i,s,u,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}const jl=new Fe,Xd=new Fe;class Zo{constructor(e=[],t=[]){this.uuid=_n(),this.bones=e.slice(0),this.boneInverses=t,this.boneMatrices=null,this.boneTexture=null,this.init()}init(){const e=this.bones,t=this.boneInverses;if(this.boneMatrices=new Float32Array(e.length*16),t.length===0)this.calculateInverses();else if(e.length!==t.length){console.warn("THREE.Skeleton: Number of inverse bone matrices does not match amount of bones."),this.boneInverses=[];for(let n=0,i=this.bones.length;n<i;n++)this.boneInverses.push(new Fe)}}calculateInverses(){this.boneInverses.length=0;for(let e=0,t=this.bones.length;e<t;e++){const n=new Fe;this.bones[e]&&n.copy(this.bones[e].matrixWorld).invert(),this.boneInverses.push(n)}}pose(){for(let e=0,t=this.bones.length;e<t;e++){const n=this.bones[e];n&&n.matrixWorld.copy(this.boneInverses[e]).invert()}for(let e=0,t=this.bones.length;e<t;e++){const n=this.bones[e];n&&(n.parent&&n.parent.isBone?(n.matrix.copy(n.parent.matrixWorld).invert(),n.matrix.multiply(n.matrixWorld)):n.matrix.copy(n.matrixWorld),n.matrix.decompose(n.position,n.quaternion,n.scale))}}update(){const e=this.bones,t=this.boneInverses,n=this.boneMatrices,i=this.boneTexture;for(let s=0,a=e.length;s<a;s++){const o=e[s]?e[s].matrixWorld:Xd;jl.multiplyMatrices(o,t[s]),jl.toArray(n,s*16)}i!==null&&(i.needsUpdate=!0)}clone(){return new Zo(this.bones,this.boneInverses)}computeBoneTexture(){let e=Math.sqrt(this.bones.length*4);e=Math.ceil(e/4)*4,e=Math.max(e,4);const t=new Float32Array(e*e*4);t.set(this.boneMatrices);const n=new Ih(t,e,e,an,mn);return n.needsUpdate=!0,this.boneMatrices=t,this.boneTexture=n,this}getBoneByName(e){for(let t=0,n=this.bones.length;t<n;t++){const i=this.bones[t];if(i.name===e)return i}}dispose(){this.boneTexture!==null&&(this.boneTexture.dispose(),this.boneTexture=null)}fromJSON(e,t){this.uuid=e.uuid;for(let n=0,i=e.bones.length;n<i;n++){const s=e.bones[n];let a=t[s];a===void 0&&(console.warn("THREE.Skeleton: No bone found with UUID:",s),a=new Ph),this.bones.push(a),this.boneInverses.push(new Fe().fromArray(e.boneInverses[n]))}return this.init(),this}toJSON(){const e={metadata:{version:4.6,type:"Skeleton",generator:"Skeleton.toJSON"},bones:[],boneInverses:[]};e.uuid=this.uuid;const t=this.bones,n=this.boneInverses;for(let i=0,s=t.length;i<s;i++){const a=t[i];e.bones.push(a.uuid);const o=n[i];e.boneInverses.push(o.toArray())}return e}}class Ao extends Ot{constructor(e,t,n,i=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=i}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){const e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}}const Ui=new Fe,Kl=new Fe,lr=[],Jl=new xn,qd=new Fe,ps=new D,ms=new En;class Yd extends D{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new Ao(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let i=0;i<n;i++)this.setMatrixAt(i,qd)}computeBoundingBox(){const e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new xn),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Ui),Jl.copy(e.boundingBox).applyMatrix4(Ui),this.boundingBox.union(Jl)}computeBoundingSphere(){const e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new En),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Ui),ms.copy(e.boundingSphere).applyMatrix4(Ui),this.boundingSphere.union(ms)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){const n=t.morphTargetInfluences,i=this.morphTexture.source.data.data,s=n.length+1,a=e*s+1;for(let o=0;o<n.length;o++)n[o]=i[a+o]}raycast(e,t){const n=this.matrixWorld,i=this.count;if(ps.geometry=this.geometry,ps.material=this.material,ps.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),ms.copy(this.boundingSphere),ms.applyMatrix4(n),e.ray.intersectsSphere(ms)!==!1))for(let s=0;s<i;s++){this.getMatrixAt(s,Ui),Kl.multiplyMatrices(n,Ui),ps.matrixWorld=Kl,ps.raycast(e,lr);for(let a=0,o=lr.length;a<o;a++){const l=lr[a];l.instanceId=s,l.object=this,t.push(l)}lr.length=0}}setColorAt(e,t){this.instanceColor===null&&(this.instanceColor=new Ao(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3)}setMatrixAt(e,t){t.toArray(this.instanceMatrix.array,e*16)}setMorphAt(e,t){const n=t.morphTargetInfluences,i=n.length+1;this.morphTexture===null&&(this.morphTexture=new Ih(new Float32Array(i*this.count),i,this.count,Go,mn));const s=this.morphTexture.source.data.data;let a=0;for(let c=0;c<n.length;c++)a+=n[c];const o=this.geometry.morphTargetsRelative?1:1-a,l=i*e;s[l]=o,s.set(n,l+1)}updateMorphTargets(){}dispose(){return this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null),this}}const va=new C,$d=new C,jd=new Oe;class Jn{constructor(e=new C(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,i){return this.normal.set(e,t,n),this.constant=i,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){const i=va.subVectors(n,t).cross($d.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(i,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){const e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){const n=e.delta(va),i=this.normal.dot(n);if(i===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;const s=-(e.start.dot(this.normal)+this.constant)/i;return s<0||s>1?null:t.copy(e.start).addScaledVector(n,s)}intersectsLine(e){const t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){const n=t||jd.getNormalMatrix(e),i=this.coplanarPoint(va).applyMatrix4(e),s=this.normal.applyMatrix3(n).normalize();return this.constant=-i.dot(s),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}}const li=new En,cr=new C;class Qo{constructor(e=new Jn,t=new Jn,n=new Jn,i=new Jn,s=new Jn,a=new Jn){this.planes=[e,t,n,i,s,a]}set(e,t,n,i,s,a){const o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(i),o[4].copy(s),o[5].copy(a),this}copy(e){const t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=zn){const n=this.planes,i=e.elements,s=i[0],a=i[1],o=i[2],l=i[3],c=i[4],h=i[5],u=i[6],d=i[7],f=i[8],m=i[9],_=i[10],g=i[11],p=i[12],x=i[13],y=i[14],v=i[15];if(n[0].setComponents(l-s,d-c,g-f,v-p).normalize(),n[1].setComponents(l+s,d+c,g+f,v+p).normalize(),n[2].setComponents(l+a,d+h,g+m,v+x).normalize(),n[3].setComponents(l-a,d-h,g-m,v-x).normalize(),n[4].setComponents(l-o,d-u,g-_,v-y).normalize(),t===zn)n[5].setComponents(l+o,d+u,g+_,v+y).normalize();else if(t===Fr)n[5].setComponents(o,u,_,y).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),li.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{const t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),li.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(li)}intersectsSprite(e){return li.center.set(0,0,0),li.radius=.7071067811865476,li.applyMatrix4(e.matrixWorld),this.intersectsSphere(li)}intersectsSphere(e){const t=this.planes,n=e.center,i=-e.radius;for(let s=0;s<6;s++)if(t[s].distanceToPoint(n)<i)return!1;return!0}intersectsBox(e){const t=this.planes;for(let n=0;n<6;n++){const i=t[n];if(cr.x=i.normal.x>0?e.max.x:e.min.x,cr.y=i.normal.y>0?e.max.y:e.min.y,cr.z=i.normal.z>0?e.max.z:e.min.z,i.distanceToPoint(cr)<0)return!1}return!0}containsPoint(e){const t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}class Lh extends wn{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new Te(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}}const Br=new C,Or=new C,Zl=new Fe,gs=new zs,hr=new En,ya=new C,Ql=new C;class el extends gt{constructor(e=new Pt,t=new Lh){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,n=[0];for(let i=1,s=t.count;i<s;i++)Br.fromBufferAttribute(t,i-1),Or.fromBufferAttribute(t,i),n[i]=n[i-1],n[i]+=Br.distanceTo(Or);e.setAttribute("lineDistance",new rt(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,t){const n=this.geometry,i=this.matrixWorld,s=e.params.Line.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),hr.copy(n.boundingSphere),hr.applyMatrix4(i),hr.radius+=s,e.ray.intersectsSphere(hr)===!1)return;Zl.copy(i).invert(),gs.copy(e.ray).applyMatrix4(Zl);const o=s/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,c=this.isLineSegments?2:1,h=n.index,d=n.attributes.position;if(h!==null){const f=Math.max(0,a.start),m=Math.min(h.count,a.start+a.count);for(let _=f,g=m-1;_<g;_+=c){const p=h.getX(_),x=h.getX(_+1),y=ur(this,e,gs,l,p,x);y&&t.push(y)}if(this.isLineLoop){const _=h.getX(m-1),g=h.getX(f),p=ur(this,e,gs,l,_,g);p&&t.push(p)}}else{const f=Math.max(0,a.start),m=Math.min(d.count,a.start+a.count);for(let _=f,g=m-1;_<g;_+=c){const p=ur(this,e,gs,l,_,_+1);p&&t.push(p)}if(this.isLineLoop){const _=ur(this,e,gs,l,m-1,f);_&&t.push(_)}}}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=i.length;s<a;s++){const o=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}}function ur(r,e,t,n,i,s){const a=r.geometry.attributes.position;if(Br.fromBufferAttribute(a,i),Or.fromBufferAttribute(a,s),t.distanceSqToSegment(Br,Or,ya,Ql)>n)return;ya.applyMatrix4(r.matrixWorld);const l=e.ray.origin.distanceTo(ya);if(!(l<e.near||l>e.far))return{distance:l,point:Ql.clone().applyMatrix4(r.matrixWorld),index:i,face:null,faceIndex:null,barycoord:null,object:r}}const ec=new C,tc=new C;class Kd extends el{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,n=[];for(let i=0,s=t.count;i<s;i+=2)ec.fromBufferAttribute(t,i),tc.fromBufferAttribute(t,i+1),n[i]=i===0?0:n[i-1],n[i+1]=n[i]+ec.distanceTo(tc);e.setAttribute("lineDistance",new rt(n,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}}class Jd extends el{constructor(e,t){super(e,t),this.isLineLoop=!0,this.type="LineLoop"}}class tl extends wn{constructor(e){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new Te(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}}const nc=new Fe,Ro=new zs,dr=new En,fr=new C;class Dh extends gt{constructor(e=new Pt,t=new tl){super(),this.isPoints=!0,this.type="Points",this.geometry=e,this.material=t,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}raycast(e,t){const n=this.geometry,i=this.matrixWorld,s=e.params.Points.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),dr.copy(n.boundingSphere),dr.applyMatrix4(i),dr.radius+=s,e.ray.intersectsSphere(dr)===!1)return;nc.copy(i).invert(),Ro.copy(e.ray).applyMatrix4(nc);const o=s/((this.scale.x+this.scale.y+this.scale.z)/3),l=o*o,c=n.index,u=n.attributes.position;if(c!==null){const d=Math.max(0,a.start),f=Math.min(c.count,a.start+a.count);for(let m=d,_=f;m<_;m++){const g=c.getX(m);fr.fromBufferAttribute(u,g),ic(fr,g,l,i,e,t,this)}}else{const d=Math.max(0,a.start),f=Math.min(u.count,a.start+a.count);for(let m=d,_=f;m<_;m++)fr.fromBufferAttribute(u,m),ic(fr,m,l,i,e,t,this)}}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let s=0,a=i.length;s<a;s++){const o=i[s].name||String(s);this.morphTargetInfluences.push(0),this.morphTargetDictionary[o]=s}}}}}function ic(r,e,t,n,i,s,a){const o=Ro.distanceSqToPoint(r);if(o<t){const l=new C;Ro.closestPointToPoint(r,l),l.applyMatrix4(n);const c=i.ray.origin.distanceTo(l);if(c<i.near||c>i.far)return;s.push({distance:c,distanceToRay:Math.sqrt(o),point:l,index:e,face:null,faceIndex:null,barycoord:null,object:a})}}class ht extends gt{constructor(){super(),this.isGroup=!0,this.type="Group"}}class sc extends bt{constructor(e,t,n,i,s,a,o,l,c){super(e,t,n,i,s,a,o,l,c),this.isCanvasTexture=!0,this.needsUpdate=!0}}class Nh extends bt{constructor(e,t,n,i,s,a,o,l,c,h=Vi){if(h!==Vi&&h!==Ji)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");n===void 0&&h===Vi&&(n=gi),n===void 0&&h===Ji&&(n=Ki),super(null,i,s,a,o,l,h,n,c),this.isDepthTexture=!0,this.image={width:e,height:t},this.magFilter=o!==void 0?o:Wt,this.minFilter=l!==void 0?l:Wt,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.compareFunction=e.compareFunction,this}toJSON(e){const t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}}class Tn{constructor(){this.type="Curve",this.arcLengthDivisions=200}getPoint(){return console.warn("THREE.Curve: .getPoint() not implemented."),null}getPointAt(e,t){const n=this.getUtoTmapping(e);return this.getPoint(n,t)}getPoints(e=5){const t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return t}getSpacedPoints(e=5){const t=[];for(let n=0;n<=e;n++)t.push(this.getPointAt(n/e));return t}getLength(){const e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;const t=[];let n,i=this.getPoint(0),s=0;t.push(0);for(let a=1;a<=e;a++)n=this.getPoint(a/e),s+=n.distanceTo(i),t.push(s),i=n;return this.cacheArcLengths=t,t}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,t){const n=this.getLengths();let i=0;const s=n.length;let a;t?a=t:a=e*n[s-1];let o=0,l=s-1,c;for(;o<=l;)if(i=Math.floor(o+(l-o)/2),c=n[i]-a,c<0)o=i+1;else if(c>0)l=i-1;else{l=i;break}if(i=l,n[i]===a)return i/(s-1);const h=n[i],d=n[i+1]-h,f=(a-h)/d;return(i+f)/(s-1)}getTangent(e,t){let i=e-1e-4,s=e+1e-4;i<0&&(i=0),s>1&&(s=1);const a=this.getPoint(i),o=this.getPoint(s),l=t||(a.isVector2?new pe:new C);return l.copy(o).sub(a).normalize(),l}getTangentAt(e,t){const n=this.getUtoTmapping(e);return this.getTangent(n,t)}computeFrenetFrames(e,t){const n=new C,i=[],s=[],a=[],o=new C,l=new Fe;for(let f=0;f<=e;f++){const m=f/e;i[f]=this.getTangentAt(m,new C)}s[0]=new C,a[0]=new C;let c=Number.MAX_VALUE;const h=Math.abs(i[0].x),u=Math.abs(i[0].y),d=Math.abs(i[0].z);h<=c&&(c=h,n.set(1,0,0)),u<=c&&(c=u,n.set(0,1,0)),d<=c&&n.set(0,0,1),o.crossVectors(i[0],n).normalize(),s[0].crossVectors(i[0],o),a[0].crossVectors(i[0],s[0]);for(let f=1;f<=e;f++){if(s[f]=s[f-1].clone(),a[f]=a[f-1].clone(),o.crossVectors(i[f-1],i[f]),o.length()>Number.EPSILON){o.normalize();const m=Math.acos(Ve(i[f-1].dot(i[f]),-1,1));s[f].applyMatrix4(l.makeRotationAxis(o,m))}a[f].crossVectors(i[f],s[f])}if(t===!0){let f=Math.acos(Ve(s[0].dot(s[e]),-1,1));f/=e,i[0].dot(o.crossVectors(s[0],s[e]))>0&&(f=-f);for(let m=1;m<=e;m++)s[m].applyMatrix4(l.makeRotationAxis(i[m],f*m)),a[m].crossVectors(i[m],s[m])}return{tangents:i,normals:s,binormals:a}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){const e={metadata:{version:4.6,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}}class nl extends Tn{constructor(e=0,t=0,n=1,i=1,s=0,a=Math.PI*2,o=!1,l=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=t,this.xRadius=n,this.yRadius=i,this.aStartAngle=s,this.aEndAngle=a,this.aClockwise=o,this.aRotation=l}getPoint(e,t=new pe){const n=t,i=Math.PI*2;let s=this.aEndAngle-this.aStartAngle;const a=Math.abs(s)<Number.EPSILON;for(;s<0;)s+=i;for(;s>i;)s-=i;s<Number.EPSILON&&(a?s=0:s=i),this.aClockwise===!0&&!a&&(s===i?s=-i:s=s-i);const o=this.aStartAngle+e*s;let l=this.aX+this.xRadius*Math.cos(o),c=this.aY+this.yRadius*Math.sin(o);if(this.aRotation!==0){const h=Math.cos(this.aRotation),u=Math.sin(this.aRotation),d=l-this.aX,f=c-this.aY;l=d*h-f*u+this.aX,c=d*u+f*h+this.aY}return n.set(l,c)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){const e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}}class Zd extends nl{constructor(e,t,n,i,s,a){super(e,t,n,n,i,s,a),this.isArcCurve=!0,this.type="ArcCurve"}}function il(){let r=0,e=0,t=0,n=0;function i(s,a,o,l){r=s,e=o,t=-3*s+3*a-2*o-l,n=2*s-2*a+o+l}return{initCatmullRom:function(s,a,o,l,c){i(a,o,c*(o-s),c*(l-a))},initNonuniformCatmullRom:function(s,a,o,l,c,h,u){let d=(a-s)/c-(o-s)/(c+h)+(o-a)/h,f=(o-a)/h-(l-a)/(h+u)+(l-o)/u;d*=h,f*=h,i(a,o,d,f)},calc:function(s){const a=s*s,o=a*s;return r+e*s+t*a+n*o}}}const pr=new C,Ma=new il,wa=new il,ba=new il;class Qd extends Tn{constructor(e=[],t=!1,n="centripetal",i=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=t,this.curveType=n,this.tension=i}getPoint(e,t=new C){const n=t,i=this.points,s=i.length,a=(s-(this.closed?0:1))*e;let o=Math.floor(a),l=a-o;this.closed?o+=o>0?0:(Math.floor(Math.abs(o)/s)+1)*s:l===0&&o===s-1&&(o=s-2,l=1);let c,h;this.closed||o>0?c=i[(o-1)%s]:(pr.subVectors(i[0],i[1]).add(i[0]),c=pr);const u=i[o%s],d=i[(o+1)%s];if(this.closed||o+2<s?h=i[(o+2)%s]:(pr.subVectors(i[s-1],i[s-2]).add(i[s-1]),h=pr),this.curveType==="centripetal"||this.curveType==="chordal"){const f=this.curveType==="chordal"?.5:.25;let m=Math.pow(c.distanceToSquared(u),f),_=Math.pow(u.distanceToSquared(d),f),g=Math.pow(d.distanceToSquared(h),f);_<1e-4&&(_=1),m<1e-4&&(m=_),g<1e-4&&(g=_),Ma.initNonuniformCatmullRom(c.x,u.x,d.x,h.x,m,_,g),wa.initNonuniformCatmullRom(c.y,u.y,d.y,h.y,m,_,g),ba.initNonuniformCatmullRom(c.z,u.z,d.z,h.z,m,_,g)}else this.curveType==="catmullrom"&&(Ma.initCatmullRom(c.x,u.x,d.x,h.x,this.tension),wa.initCatmullRom(c.y,u.y,d.y,h.y,this.tension),ba.initCatmullRom(c.z,u.z,d.z,h.z,this.tension));return n.set(Ma.calc(l),wa.calc(l),ba.calc(l)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){const i=e.points[t];this.points.push(i.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){const e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){const i=this.points[t];e.points.push(i.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){const i=e.points[t];this.points.push(new C().fromArray(i))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}}function rc(r,e,t,n,i){const s=(n-e)*.5,a=(i-t)*.5,o=r*r,l=r*o;return(2*t-2*n+s+a)*l+(-3*t+3*n-2*s-a)*o+s*r+t}function ef(r,e){const t=1-r;return t*t*e}function tf(r,e){return 2*(1-r)*r*e}function nf(r,e){return r*r*e}function Cs(r,e,t,n){return ef(r,e)+tf(r,t)+nf(r,n)}function sf(r,e){const t=1-r;return t*t*t*e}function rf(r,e){const t=1-r;return 3*t*t*r*e}function af(r,e){return 3*(1-r)*r*r*e}function of(r,e){return r*r*r*e}function Ps(r,e,t,n,i){return sf(r,e)+rf(r,t)+af(r,n)+of(r,i)}class Uh extends Tn{constructor(e=new pe,t=new pe,n=new pe,i=new pe){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=t,this.v2=n,this.v3=i}getPoint(e,t=new pe){const n=t,i=this.v0,s=this.v1,a=this.v2,o=this.v3;return n.set(Ps(e,i.x,s.x,a.x,o.x),Ps(e,i.y,s.y,a.y,o.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){const e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}}class lf extends Tn{constructor(e=new C,t=new C,n=new C,i=new C){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=t,this.v2=n,this.v3=i}getPoint(e,t=new C){const n=t,i=this.v0,s=this.v1,a=this.v2,o=this.v3;return n.set(Ps(e,i.x,s.x,a.x,o.x),Ps(e,i.y,s.y,a.y,o.y),Ps(e,i.z,s.z,a.z,o.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){const e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}}class kh extends Tn{constructor(e=new pe,t=new pe){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=t}getPoint(e,t=new pe){const n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new pe){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){const e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}}class cf extends Tn{constructor(e=new C,t=new C){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=t}getPoint(e,t=new C){const n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new C){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){const e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}}class Fh extends Tn{constructor(e=new pe,t=new pe,n=new pe){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new pe){const n=t,i=this.v0,s=this.v1,a=this.v2;return n.set(Cs(e,i.x,s.x,a.x),Cs(e,i.y,s.y,a.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){const e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}}class hf extends Tn{constructor(e=new C,t=new C,n=new C){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new C){const n=t,i=this.v0,s=this.v1,a=this.v2;return n.set(Cs(e,i.x,s.x,a.x),Cs(e,i.y,s.y,a.y),Cs(e,i.z,s.z,a.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){const e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}}class Bh extends Tn{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,t=new pe){const n=t,i=this.points,s=(i.length-1)*e,a=Math.floor(s),o=s-a,l=i[a===0?a:a-1],c=i[a],h=i[a>i.length-2?i.length-1:a+1],u=i[a>i.length-3?i.length-1:a+2];return n.set(rc(o,l.x,c.x,h.x,u.x),rc(o,l.y,c.y,h.y,u.y)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){const i=e.points[t];this.points.push(i.clone())}return this}toJSON(){const e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){const i=this.points[t];e.points.push(i.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){const i=e.points[t];this.points.push(new pe().fromArray(i))}return this}}var ac=Object.freeze({__proto__:null,ArcCurve:Zd,CatmullRomCurve3:Qd,CubicBezierCurve:Uh,CubicBezierCurve3:lf,EllipseCurve:nl,LineCurve:kh,LineCurve3:cf,QuadraticBezierCurve:Fh,QuadraticBezierCurve3:hf,SplineCurve:Bh});class uf extends Tn{constructor(){super(),this.type="CurvePath",this.curves=[],this.autoClose=!1}add(e){this.curves.push(e)}closePath(){const e=this.curves[0].getPoint(0),t=this.curves[this.curves.length-1].getPoint(1);if(!e.equals(t)){const n=e.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new ac[n](t,e))}return this}getPoint(e,t){const n=e*this.getLength(),i=this.getCurveLengths();let s=0;for(;s<i.length;){if(i[s]>=n){const a=i[s]-n,o=this.curves[s],l=o.getLength(),c=l===0?0:1-a/l;return o.getPointAt(c,t)}s++}return null}getLength(){const e=this.getCurveLengths();return e[e.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;const e=[];let t=0;for(let n=0,i=this.curves.length;n<i;n++)t+=this.curves[n].getLength(),e.push(t);return this.cacheLengths=e,e}getSpacedPoints(e=40){const t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return this.autoClose&&t.push(t[0]),t}getPoints(e=12){const t=[];let n;for(let i=0,s=this.curves;i<s.length;i++){const a=s[i],o=a.isEllipseCurve?e*2:a.isLineCurve||a.isLineCurve3?1:a.isSplineCurve?e*a.points.length:e,l=a.getPoints(o);for(let c=0;c<l.length;c++){const h=l[c];n&&n.equals(h)||(t.push(h),n=h)}}return this.autoClose&&t.length>1&&!t[t.length-1].equals(t[0])&&t.push(t[0]),t}copy(e){super.copy(e),this.curves=[];for(let t=0,n=e.curves.length;t<n;t++){const i=e.curves[t];this.curves.push(i.clone())}return this.autoClose=e.autoClose,this}toJSON(){const e=super.toJSON();e.autoClose=this.autoClose,e.curves=[];for(let t=0,n=this.curves.length;t<n;t++){const i=this.curves[t];e.curves.push(i.toJSON())}return e}fromJSON(e){super.fromJSON(e),this.autoClose=e.autoClose,this.curves=[];for(let t=0,n=e.curves.length;t<n;t++){const i=e.curves[t];this.curves.push(new ac[i.type]().fromJSON(i))}return this}}class df extends uf{constructor(e){super(),this.type="Path",this.currentPoint=new pe,e&&this.setFromPoints(e)}setFromPoints(e){this.moveTo(e[0].x,e[0].y);for(let t=1,n=e.length;t<n;t++)this.lineTo(e[t].x,e[t].y);return this}moveTo(e,t){return this.currentPoint.set(e,t),this}lineTo(e,t){const n=new kh(this.currentPoint.clone(),new pe(e,t));return this.curves.push(n),this.currentPoint.set(e,t),this}quadraticCurveTo(e,t,n,i){const s=new Fh(this.currentPoint.clone(),new pe(e,t),new pe(n,i));return this.curves.push(s),this.currentPoint.set(n,i),this}bezierCurveTo(e,t,n,i,s,a){const o=new Uh(this.currentPoint.clone(),new pe(e,t),new pe(n,i),new pe(s,a));return this.curves.push(o),this.currentPoint.set(s,a),this}splineThru(e){const t=[this.currentPoint.clone()].concat(e),n=new Bh(t);return this.curves.push(n),this.currentPoint.copy(e[e.length-1]),this}arc(e,t,n,i,s,a){const o=this.currentPoint.x,l=this.currentPoint.y;return this.absarc(e+o,t+l,n,i,s,a),this}absarc(e,t,n,i,s,a){return this.absellipse(e,t,n,n,i,s,a),this}ellipse(e,t,n,i,s,a,o,l){const c=this.currentPoint.x,h=this.currentPoint.y;return this.absellipse(e+c,t+h,n,i,s,a,o,l),this}absellipse(e,t,n,i,s,a,o,l){const c=new nl(e,t,n,i,s,a,o,l);if(this.curves.length>0){const u=c.getPoint(0);u.equals(this.currentPoint)||this.lineTo(u.x,u.y)}this.curves.push(c);const h=c.getPoint(1);return this.currentPoint.copy(h),this}copy(e){return super.copy(e),this.currentPoint.copy(e.currentPoint),this}toJSON(){const e=super.toJSON();return e.currentPoint=this.currentPoint.toArray(),e}fromJSON(e){return super.fromJSON(e),this.currentPoint.fromArray(e.currentPoint),this}}class sl extends Pt{constructor(e=[new pe(0,-.5),new pe(.5,0),new pe(0,.5)],t=12,n=0,i=Math.PI*2){super(),this.type="LatheGeometry",this.parameters={points:e,segments:t,phiStart:n,phiLength:i},t=Math.floor(t),i=Ve(i,0,Math.PI*2);const s=[],a=[],o=[],l=[],c=[],h=1/t,u=new C,d=new pe,f=new C,m=new C,_=new C;let g=0,p=0;for(let x=0;x<=e.length-1;x++)switch(x){case 0:g=e[x+1].x-e[x].x,p=e[x+1].y-e[x].y,f.x=p*1,f.y=-g,f.z=p*0,_.copy(f),f.normalize(),l.push(f.x,f.y,f.z);break;case e.length-1:l.push(_.x,_.y,_.z);break;default:g=e[x+1].x-e[x].x,p=e[x+1].y-e[x].y,f.x=p*1,f.y=-g,f.z=p*0,m.copy(f),f.x+=_.x,f.y+=_.y,f.z+=_.z,f.normalize(),l.push(f.x,f.y,f.z),_.copy(m)}for(let x=0;x<=t;x++){const y=n+x*h*i,v=Math.sin(y),A=Math.cos(y);for(let E=0;E<=e.length-1;E++){u.x=e[E].x*v,u.y=e[E].y,u.z=e[E].x*A,a.push(u.x,u.y,u.z),d.x=x/t,d.y=E/(e.length-1),o.push(d.x,d.y);const T=l[3*E+0]*v,P=l[3*E+1],b=l[3*E+0]*A;c.push(T,P,b)}}for(let x=0;x<t;x++)for(let y=0;y<e.length-1;y++){const v=y+x*e.length,A=v,E=v+e.length,T=v+e.length+1,P=v+1;s.push(A,E,P),s.push(T,P,E)}this.setIndex(s),this.setAttribute("position",new rt(a,3)),this.setAttribute("uv",new rt(o,2)),this.setAttribute("normal",new rt(c,3))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new sl(e.points,e.segments,e.phiStart,e.phiLength)}}class $t extends sl{constructor(e=1,t=1,n=4,i=8){const s=new df;s.absarc(0,-t/2,e,Math.PI*1.5,0),s.absarc(0,t/2,e,0,Math.PI*.5),super(s.getPoints(n),i),this.type="CapsuleGeometry",this.parameters={radius:e,length:t,capSegments:n,radialSegments:i}}static fromJSON(e){return new $t(e.radius,e.length,e.capSegments,e.radialSegments)}}class on extends Pt{constructor(e=1,t=32,n=0,i=Math.PI*2){super(),this.type="CircleGeometry",this.parameters={radius:e,segments:t,thetaStart:n,thetaLength:i},t=Math.max(3,t);const s=[],a=[],o=[],l=[],c=new C,h=new pe;a.push(0,0,0),o.push(0,0,1),l.push(.5,.5);for(let u=0,d=3;u<=t;u++,d+=3){const f=n+u/t*i;c.x=e*Math.cos(f),c.y=e*Math.sin(f),a.push(c.x,c.y,c.z),o.push(0,0,1),h.x=(a[d]/e+1)/2,h.y=(a[d+1]/e+1)/2,l.push(h.x,h.y)}for(let u=1;u<=t;u++)s.push(u,u+1,0);this.setIndex(s),this.setAttribute("position",new rt(a,3)),this.setAttribute("normal",new rt(o,3)),this.setAttribute("uv",new rt(l,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new on(e.radius,e.segments,e.thetaStart,e.thetaLength)}}class ft extends Pt{constructor(e=1,t=1,n=1,i=32,s=1,a=!1,o=0,l=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:i,heightSegments:s,openEnded:a,thetaStart:o,thetaLength:l};const c=this;i=Math.floor(i),s=Math.floor(s);const h=[],u=[],d=[],f=[];let m=0;const _=[],g=n/2;let p=0;x(),a===!1&&(e>0&&y(!0),t>0&&y(!1)),this.setIndex(h),this.setAttribute("position",new rt(u,3)),this.setAttribute("normal",new rt(d,3)),this.setAttribute("uv",new rt(f,2));function x(){const v=new C,A=new C;let E=0;const T=(t-e)/n;for(let P=0;P<=s;P++){const b=[],M=P/s,I=M*(t-e)+e;for(let B=0;B<=i;B++){const z=B/i,V=z*l+o,q=Math.sin(V),j=Math.cos(V);A.x=I*q,A.y=-M*n+g,A.z=I*j,u.push(A.x,A.y,A.z),v.set(q,T,j).normalize(),d.push(v.x,v.y,v.z),f.push(z,1-M),b.push(m++)}_.push(b)}for(let P=0;P<i;P++)for(let b=0;b<s;b++){const M=_[b][P],I=_[b+1][P],B=_[b+1][P+1],z=_[b][P+1];(e>0||b!==0)&&(h.push(M,I,z),E+=3),(t>0||b!==s-1)&&(h.push(I,B,z),E+=3)}c.addGroup(p,E,0),p+=E}function y(v){const A=m,E=new pe,T=new C;let P=0;const b=v===!0?e:t,M=v===!0?1:-1;for(let B=1;B<=i;B++)u.push(0,g*M,0),d.push(0,M,0),f.push(.5,.5),m++;const I=m;for(let B=0;B<=i;B++){const V=B/i*l+o,q=Math.cos(V),j=Math.sin(V);T.x=b*j,T.y=g*M,T.z=b*q,u.push(T.x,T.y,T.z),d.push(0,M,0),E.x=q*.5+.5,E.y=j*.5*M+.5,f.push(E.x,E.y),m++}for(let B=0;B<i;B++){const z=A+B,V=I+B;v===!0?h.push(V,V+1,z):h.push(V+1,V,z),P+=3}c.addGroup(p,P,v===!0?1:2),p+=P}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new ft(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}}class wt extends ft{constructor(e=1,t=1,n=32,i=1,s=!1,a=0,o=Math.PI*2){super(0,e,t,n,i,s,a,o),this.type="ConeGeometry",this.parameters={radius:e,height:t,radialSegments:n,heightSegments:i,openEnded:s,thetaStart:a,thetaLength:o}}static fromJSON(e){return new wt(e.radius,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}}class rl extends Pt{constructor(e=[],t=[],n=1,i=0){super(),this.type="PolyhedronGeometry",this.parameters={vertices:e,indices:t,radius:n,detail:i};const s=[],a=[];o(i),c(n),h(),this.setAttribute("position",new rt(s,3)),this.setAttribute("normal",new rt(s.slice(),3)),this.setAttribute("uv",new rt(a,2)),i===0?this.computeVertexNormals():this.normalizeNormals();function o(x){const y=new C,v=new C,A=new C;for(let E=0;E<t.length;E+=3)f(t[E+0],y),f(t[E+1],v),f(t[E+2],A),l(y,v,A,x)}function l(x,y,v,A){const E=A+1,T=[];for(let P=0;P<=E;P++){T[P]=[];const b=x.clone().lerp(v,P/E),M=y.clone().lerp(v,P/E),I=E-P;for(let B=0;B<=I;B++)B===0&&P===E?T[P][B]=b:T[P][B]=b.clone().lerp(M,B/I)}for(let P=0;P<E;P++)for(let b=0;b<2*(E-P)-1;b++){const M=Math.floor(b/2);b%2===0?(d(T[P][M+1]),d(T[P+1][M]),d(T[P][M])):(d(T[P][M+1]),d(T[P+1][M+1]),d(T[P+1][M]))}}function c(x){const y=new C;for(let v=0;v<s.length;v+=3)y.x=s[v+0],y.y=s[v+1],y.z=s[v+2],y.normalize().multiplyScalar(x),s[v+0]=y.x,s[v+1]=y.y,s[v+2]=y.z}function h(){const x=new C;for(let y=0;y<s.length;y+=3){x.x=s[y+0],x.y=s[y+1],x.z=s[y+2];const v=g(x)/2/Math.PI+.5,A=p(x)/Math.PI+.5;a.push(v,1-A)}m(),u()}function u(){for(let x=0;x<a.length;x+=6){const y=a[x+0],v=a[x+2],A=a[x+4],E=Math.max(y,v,A),T=Math.min(y,v,A);E>.9&&T<.1&&(y<.2&&(a[x+0]+=1),v<.2&&(a[x+2]+=1),A<.2&&(a[x+4]+=1))}}function d(x){s.push(x.x,x.y,x.z)}function f(x,y){const v=x*3;y.x=e[v+0],y.y=e[v+1],y.z=e[v+2]}function m(){const x=new C,y=new C,v=new C,A=new C,E=new pe,T=new pe,P=new pe;for(let b=0,M=0;b<s.length;b+=9,M+=6){x.set(s[b+0],s[b+1],s[b+2]),y.set(s[b+3],s[b+4],s[b+5]),v.set(s[b+6],s[b+7],s[b+8]),E.set(a[M+0],a[M+1]),T.set(a[M+2],a[M+3]),P.set(a[M+4],a[M+5]),A.copy(x).add(y).add(v).divideScalar(3);const I=g(A);_(E,M+0,x,I),_(T,M+2,y,I),_(P,M+4,v,I)}}function _(x,y,v,A){A<0&&x.x===1&&(a[y]=x.x-1),v.x===0&&v.z===0&&(a[y]=A/2/Math.PI+.5)}function g(x){return Math.atan2(x.z,-x.x)}function p(x){return Math.atan2(-x.y,Math.sqrt(x.x*x.x+x.z*x.z))}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new rl(e.vertices,e.indices,e.radius,e.details)}}class Mn extends rl{constructor(e=1,t=0){const n=[1,0,0,-1,0,0,0,1,0,0,-1,0,0,0,1,0,0,-1],i=[0,2,4,0,4,3,0,3,5,0,5,2,1,2,5,1,5,3,1,3,4,1,4,2];super(n,i,e,t),this.type="OctahedronGeometry",this.parameters={radius:e,detail:t}}static fromJSON(e){return new Mn(e.radius,e.detail)}}class Qt extends Pt{constructor(e=1,t=1,n=1,i=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:i};const s=e/2,a=t/2,o=Math.floor(n),l=Math.floor(i),c=o+1,h=l+1,u=e/o,d=t/l,f=[],m=[],_=[],g=[];for(let p=0;p<h;p++){const x=p*d-a;for(let y=0;y<c;y++){const v=y*u-s;m.push(v,-x,0),_.push(0,0,1),g.push(y/o),g.push(1-p/l)}}for(let p=0;p<l;p++)for(let x=0;x<o;x++){const y=x+c*p,v=x+c*(p+1),A=x+1+c*(p+1),E=x+1+c*p;f.push(y,v,E),f.push(v,A,E)}this.setIndex(f),this.setAttribute("position",new rt(m,3)),this.setAttribute("normal",new rt(_,3)),this.setAttribute("uv",new rt(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Qt(e.width,e.height,e.widthSegments,e.heightSegments)}}class Wi extends Pt{constructor(e=.5,t=1,n=32,i=1,s=0,a=Math.PI*2){super(),this.type="RingGeometry",this.parameters={innerRadius:e,outerRadius:t,thetaSegments:n,phiSegments:i,thetaStart:s,thetaLength:a},n=Math.max(3,n),i=Math.max(1,i);const o=[],l=[],c=[],h=[];let u=e;const d=(t-e)/i,f=new C,m=new pe;for(let _=0;_<=i;_++){for(let g=0;g<=n;g++){const p=s+g/n*a;f.x=u*Math.cos(p),f.y=u*Math.sin(p),l.push(f.x,f.y,f.z),c.push(0,0,1),m.x=(f.x/t+1)/2,m.y=(f.y/t+1)/2,h.push(m.x,m.y)}u+=d}for(let _=0;_<i;_++){const g=_*(n+1);for(let p=0;p<n;p++){const x=p+g,y=x,v=x+n+1,A=x+n+2,E=x+1;o.push(y,v,E),o.push(v,A,E)}}this.setIndex(o),this.setAttribute("position",new rt(l,3)),this.setAttribute("normal",new rt(c,3)),this.setAttribute("uv",new rt(h,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Wi(e.innerRadius,e.outerRadius,e.thetaSegments,e.phiSegments,e.thetaStart,e.thetaLength)}}class Le extends Pt{constructor(e=1,t=32,n=16,i=0,s=Math.PI*2,a=0,o=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:i,phiLength:s,thetaStart:a,thetaLength:o},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));const l=Math.min(a+o,Math.PI);let c=0;const h=[],u=new C,d=new C,f=[],m=[],_=[],g=[];for(let p=0;p<=n;p++){const x=[],y=p/n;let v=0;p===0&&a===0?v=.5/t:p===n&&l===Math.PI&&(v=-.5/t);for(let A=0;A<=t;A++){const E=A/t;u.x=-e*Math.cos(i+E*s)*Math.sin(a+y*o),u.y=e*Math.cos(a+y*o),u.z=e*Math.sin(i+E*s)*Math.sin(a+y*o),m.push(u.x,u.y,u.z),d.copy(u).normalize(),_.push(d.x,d.y,d.z),g.push(E+v,1-y),x.push(c++)}h.push(x)}for(let p=0;p<n;p++)for(let x=0;x<t;x++){const y=h[p][x+1],v=h[p][x],A=h[p+1][x],E=h[p+1][x+1];(p!==0||a>0)&&f.push(y,v,E),(p!==n-1||l<Math.PI)&&f.push(v,A,E)}this.setIndex(f),this.setAttribute("position",new rt(m,3)),this.setAttribute("normal",new rt(_,3)),this.setAttribute("uv",new rt(g,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Le(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}}class Rt extends Pt{constructor(e=1,t=.4,n=12,i=48,s=Math.PI*2){super(),this.type="TorusGeometry",this.parameters={radius:e,tube:t,radialSegments:n,tubularSegments:i,arc:s},n=Math.floor(n),i=Math.floor(i);const a=[],o=[],l=[],c=[],h=new C,u=new C,d=new C;for(let f=0;f<=n;f++)for(let m=0;m<=i;m++){const _=m/i*s,g=f/n*Math.PI*2;u.x=(e+t*Math.cos(g))*Math.cos(_),u.y=(e+t*Math.cos(g))*Math.sin(_),u.z=t*Math.sin(g),o.push(u.x,u.y,u.z),h.x=e*Math.cos(_),h.y=e*Math.sin(_),d.subVectors(u,h).normalize(),l.push(d.x,d.y,d.z),c.push(m/i),c.push(f/n)}for(let f=1;f<=n;f++)for(let m=1;m<=i;m++){const _=(i+1)*f+m-1,g=(i+1)*(f-1)+m-1,p=(i+1)*(f-1)+m,x=(i+1)*f+m;a.push(_,g,x),a.push(g,p,x)}this.setIndex(a),this.setAttribute("position",new rt(o,3)),this.setAttribute("normal",new rt(l,3)),this.setAttribute("uv",new rt(c,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Rt(e.radius,e.tube,e.radialSegments,e.tubularSegments,e.arc)}}class jt extends wn{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new Te(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Te(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=xh,this.normalScale=new pe(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new bn,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class An extends jt{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new pe(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return Ve(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(t){this.ior=(1+.4*t)/(1-.4*t)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new Te(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new Te(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new Te(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}}class ff extends wn{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=Gu,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}}class pf extends wn{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}}function mr(r,e,t){return!r||!t&&r.constructor===e?r:typeof e.BYTES_PER_ELEMENT=="number"?new e(r):Array.prototype.slice.call(r)}function mf(r){return ArrayBuffer.isView(r)&&!(r instanceof DataView)}function gf(r){function e(i,s){return r[i]-r[s]}const t=r.length,n=new Array(t);for(let i=0;i!==t;++i)n[i]=i;return n.sort(e),n}function oc(r,e,t){const n=r.length,i=new r.constructor(n);for(let s=0,a=0;a!==n;++s){const o=t[s]*e;for(let l=0;l!==e;++l)i[a++]=r[o+l]}return i}function Oh(r,e,t,n){let i=1,s=r[0];for(;s!==void 0&&s[n]===void 0;)s=r[i++];if(s===void 0)return;let a=s[n];if(a!==void 0)if(Array.isArray(a))do a=s[n],a!==void 0&&(e.push(s.time),t.push.apply(t,a)),s=r[i++];while(s!==void 0);else if(a.toArray!==void 0)do a=s[n],a!==void 0&&(e.push(s.time),a.toArray(t,t.length)),s=r[i++];while(s!==void 0);else do a=s[n],a!==void 0&&(e.push(s.time),t.push(a)),s=r[i++];while(s!==void 0)}class Hs{constructor(e,t,n,i){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=i!==void 0?i:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){const t=this.parameterPositions;let n=this._cachedIndex,i=t[n],s=t[n-1];e:{t:{let a;n:{i:if(!(e<i)){for(let o=n+2;;){if(i===void 0){if(e<s)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===o)break;if(s=i,i=t[++n],e<i)break t}a=t.length;break n}if(!(e>=s)){const o=t[1];e<o&&(n=2,s=o);for(let l=n-2;;){if(s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===l)break;if(i=s,s=t[--n-1],e>=s)break t}a=n,n=0;break n}break e}for(;n<a;){const o=n+a>>>1;e<t[o]?a=o:n=o+1}if(i=t[n],s=t[n-1],s===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,s,i)}return this.interpolate_(n,s,e,i)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){const t=this.resultBuffer,n=this.sampleValues,i=this.valueSize,s=e*i;for(let a=0;a!==i;++a)t[a]=n[s+a];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}}class _f extends Hs{constructor(e,t,n,i){super(e,t,n,i),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:Bi,endingEnd:Bi}}intervalChanged_(e,t,n){const i=this.parameterPositions;let s=e-2,a=e+1,o=i[s],l=i[a];if(o===void 0)switch(this.getSettings_().endingStart){case Oi:s=e,o=2*t-n;break;case Ur:s=i.length-2,o=t+i[s]-i[s+1];break;default:s=e,o=n}if(l===void 0)switch(this.getSettings_().endingEnd){case Oi:a=e,l=2*n-t;break;case Ur:a=1,l=n+i[1]-i[0];break;default:a=e-1,l=t}const c=(n-t)*.5,h=this.valueSize;this._weightPrev=c/(t-o),this._weightNext=c/(l-n),this._offsetPrev=s*h,this._offsetNext=a*h}interpolate_(e,t,n,i){const s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,h=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,f=this._weightNext,m=(n-t)/(i-t),_=m*m,g=_*m,p=-d*g+2*d*_-d*m,x=(1+d)*g+(-1.5-2*d)*_+(-.5+d)*m+1,y=(-1-f)*g+(1.5+f)*_+.5*m,v=f*g-f*_;for(let A=0;A!==o;++A)s[A]=p*a[h+A]+x*a[c+A]+y*a[l+A]+v*a[u+A];return s}}class zh extends Hs{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e,t,n,i){const s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=e*o,c=l-o,h=(n-t)/(i-t),u=1-h;for(let d=0;d!==o;++d)s[d]=a[c+d]*u+a[l+d]*h;return s}}class xf extends Hs{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e){return this.copySampleValue_(e-1)}}class Rn{constructor(e,t,n,i){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=mr(t,this.TimeBufferType),this.values=mr(n,this.ValueBufferType),this.setInterpolation(i||this.DefaultInterpolation)}static toJSON(e){const t=e.constructor;let n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:mr(e.times,Array),values:mr(e.values,Array)};const i=e.getInterpolation();i!==e.DefaultInterpolation&&(n.interpolation=i)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new xf(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new zh(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new _f(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let t;switch(e){case Us:t=this.InterpolantFactoryMethodDiscrete;break;case ks:t=this.InterpolantFactoryMethodLinear;break;case Jr:t=this.InterpolantFactoryMethodSmooth;break}if(t===void 0){const n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return console.warn("THREE.KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Us;case this.InterpolantFactoryMethodLinear:return ks;case this.InterpolantFactoryMethodSmooth:return Jr}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){const t=this.times;for(let n=0,i=t.length;n!==i;++n)t[n]+=e}return this}scale(e){if(e!==1){const t=this.times;for(let n=0,i=t.length;n!==i;++n)t[n]*=e}return this}trim(e,t){const n=this.times,i=n.length;let s=0,a=i-1;for(;s!==i&&n[s]<e;)++s;for(;a!==-1&&n[a]>t;)--a;if(++a,s!==0||a!==i){s>=a&&(a=Math.max(a,1),s=a-1);const o=this.getValueSize();this.times=n.slice(s,a),this.values=this.values.slice(s*o,a*o)}return this}validate(){let e=!0;const t=this.getValueSize();t-Math.floor(t)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),e=!1);const n=this.times,i=this.values,s=n.length;s===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),e=!1);let a=null;for(let o=0;o!==s;o++){const l=n[o];if(typeof l=="number"&&isNaN(l)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,o,l),e=!1;break}if(a!==null&&a>l){console.error("THREE.KeyframeTrack: Out of order keys.",this,o,l,a),e=!1;break}a=l}if(i!==void 0&&mf(i))for(let o=0,l=i.length;o!==l;++o){const c=i[o];if(isNaN(c)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,o,c),e=!1;break}}return e}optimize(){const e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),i=this.getInterpolation()===Jr,s=e.length-1;let a=1;for(let o=1;o<s;++o){let l=!1;const c=e[o],h=e[o+1];if(c!==h&&(o!==1||c!==e[0]))if(i)l=!0;else{const u=o*n,d=u-n,f=u+n;for(let m=0;m!==n;++m){const _=t[u+m];if(_!==t[d+m]||_!==t[f+m]){l=!0;break}}}if(l){if(o!==a){e[a]=e[o];const u=o*n,d=a*n;for(let f=0;f!==n;++f)t[d+f]=t[u+f]}++a}}if(s>0){e[a]=e[s];for(let o=s*n,l=a*n,c=0;c!==n;++c)t[l+c]=t[o+c];++a}return a!==e.length?(this.times=e.slice(0,a),this.values=t.slice(0,a*n)):(this.times=e,this.values=t),this}clone(){const e=this.times.slice(),t=this.values.slice(),n=this.constructor,i=new n(this.name,e,t);return i.createInterpolant=this.createInterpolant,i}}Rn.prototype.TimeBufferType=Float32Array;Rn.prototype.ValueBufferType=Float32Array;Rn.prototype.DefaultInterpolation=ks;class rs extends Rn{constructor(e,t,n){super(e,t,n)}}rs.prototype.ValueTypeName="bool";rs.prototype.ValueBufferType=Array;rs.prototype.DefaultInterpolation=Us;rs.prototype.InterpolantFactoryMethodLinear=void 0;rs.prototype.InterpolantFactoryMethodSmooth=void 0;class Hh extends Rn{}Hh.prototype.ValueTypeName="color";class es extends Rn{}es.prototype.ValueTypeName="number";class vf extends Hs{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e,t,n,i){const s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=(n-t)/(i-t);let c=e*o;for(let h=c+o;c!==h;c+=4)Ct.slerpFlat(s,0,a,c-o,a,c,l);return s}}class ts extends Rn{InterpolantFactoryMethodLinear(e){return new vf(this.times,this.values,this.getValueSize(),e)}}ts.prototype.ValueTypeName="quaternion";ts.prototype.InterpolantFactoryMethodSmooth=void 0;class as extends Rn{constructor(e,t,n){super(e,t,n)}}as.prototype.ValueTypeName="string";as.prototype.ValueBufferType=Array;as.prototype.DefaultInterpolation=Us;as.prototype.InterpolantFactoryMethodLinear=void 0;as.prototype.InterpolantFactoryMethodSmooth=void 0;class ns extends Rn{}ns.prototype.ValueTypeName="vector";class Co{constructor(e="",t=-1,n=[],i=Yo){this.name=e,this.tracks=n,this.duration=t,this.blendMode=i,this.uuid=_n(),this.duration<0&&this.resetDuration()}static parse(e){const t=[],n=e.tracks,i=1/(e.fps||1);for(let a=0,o=n.length;a!==o;++a)t.push(Mf(n[a]).scale(i));const s=new this(e.name,e.duration,t,e.blendMode);return s.uuid=e.uuid,s}static toJSON(e){const t=[],n=e.tracks,i={name:e.name,duration:e.duration,tracks:t,uuid:e.uuid,blendMode:e.blendMode};for(let s=0,a=n.length;s!==a;++s)t.push(Rn.toJSON(n[s]));return i}static CreateFromMorphTargetSequence(e,t,n,i){const s=t.length,a=[];for(let o=0;o<s;o++){let l=[],c=[];l.push((o+s-1)%s,o,(o+1)%s),c.push(0,1,0);const h=gf(l);l=oc(l,1,h),c=oc(c,1,h),!i&&l[0]===0&&(l.push(s),c.push(c[0])),a.push(new es(".morphTargetInfluences["+t[o].name+"]",l,c).scale(1/n))}return new this(e,-1,a)}static findByName(e,t){let n=e;if(!Array.isArray(e)){const i=e;n=i.geometry&&i.geometry.animations||i.animations}for(let i=0;i<n.length;i++)if(n[i].name===t)return n[i];return null}static CreateClipsFromMorphTargetSequences(e,t,n){const i={},s=/^([\w-]*?)([\d]+)$/;for(let o=0,l=e.length;o<l;o++){const c=e[o],h=c.name.match(s);if(h&&h.length>1){const u=h[1];let d=i[u];d||(i[u]=d=[]),d.push(c)}}const a=[];for(const o in i)a.push(this.CreateFromMorphTargetSequence(o,i[o],t,n));return a}static parseAnimation(e,t){if(!e)return console.error("THREE.AnimationClip: No animation in JSONLoader data."),null;const n=function(u,d,f,m,_){if(f.length!==0){const g=[],p=[];Oh(f,g,p,m),g.length!==0&&_.push(new u(d,g,p))}},i=[],s=e.name||"default",a=e.fps||30,o=e.blendMode;let l=e.length||-1;const c=e.hierarchy||[];for(let u=0;u<c.length;u++){const d=c[u].keys;if(!(!d||d.length===0))if(d[0].morphTargets){const f={};let m;for(m=0;m<d.length;m++)if(d[m].morphTargets)for(let _=0;_<d[m].morphTargets.length;_++)f[d[m].morphTargets[_]]=-1;for(const _ in f){const g=[],p=[];for(let x=0;x!==d[m].morphTargets.length;++x){const y=d[m];g.push(y.time),p.push(y.morphTarget===_?1:0)}i.push(new es(".morphTargetInfluence["+_+"]",g,p))}l=f.length*a}else{const f=".bones["+t[u].name+"]";n(ns,f+".position",d,"pos",i),n(ts,f+".quaternion",d,"rot",i),n(ns,f+".scale",d,"scl",i)}}return i.length===0?null:new this(s,l,i,o)}resetDuration(){const e=this.tracks;let t=0;for(let n=0,i=e.length;n!==i;++n){const s=this.tracks[n];t=Math.max(t,s.times[s.times.length-1])}return this.duration=t,this}trim(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].trim(0,this.duration);return this}validate(){let e=!0;for(let t=0;t<this.tracks.length;t++)e=e&&this.tracks[t].validate();return e}optimize(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].optimize();return this}clone(){const e=[];for(let t=0;t<this.tracks.length;t++)e.push(this.tracks[t].clone());return new this.constructor(this.name,this.duration,e,this.blendMode)}toJSON(){return this.constructor.toJSON(this)}}function yf(r){switch(r.toLowerCase()){case"scalar":case"double":case"float":case"number":case"integer":return es;case"vector":case"vector2":case"vector3":case"vector4":return ns;case"color":return Hh;case"quaternion":return ts;case"bool":case"boolean":return rs;case"string":return as}throw new Error("THREE.KeyframeTrack: Unsupported typeName: "+r)}function Mf(r){if(r.type===void 0)throw new Error("THREE.KeyframeTrack: track type undefined, can not parse");const e=yf(r.type);if(r.times===void 0){const t=[],n=[];Oh(r.keys,t,n,"value"),r.times=t,r.values=n}return e.parse!==void 0?e.parse(r):new e(r.name,r.times,r.values,r.interpolation)}const ei={enabled:!1,files:{},add:function(r,e){this.enabled!==!1&&(this.files[r]=e)},get:function(r){if(this.enabled!==!1)return this.files[r]},remove:function(r){delete this.files[r]},clear:function(){this.files={}}};class wf{constructor(e,t,n){const i=this;let s=!1,a=0,o=0,l;const c=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this.itemStart=function(h){o++,s===!1&&i.onStart!==void 0&&i.onStart(h,a,o),s=!0},this.itemEnd=function(h){a++,i.onProgress!==void 0&&i.onProgress(h,a,o),a===o&&(s=!1,i.onLoad!==void 0&&i.onLoad())},this.itemError=function(h){i.onError!==void 0&&i.onError(h)},this.resolveURL=function(h){return l?l(h):h},this.setURLModifier=function(h){return l=h,this},this.addHandler=function(h,u){return c.push(h,u),this},this.removeHandler=function(h){const u=c.indexOf(h);return u!==-1&&c.splice(u,2),this},this.getHandler=function(h){for(let u=0,d=c.length;u<d;u+=2){const f=c[u],m=c[u+1];if(f.global&&(f.lastIndex=0),f.test(h))return m}return null}}}const bf=new wf;class os{constructor(e){this.manager=e!==void 0?e:bf,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,t){const n=this;return new Promise(function(i,s){n.load(e,i,t,s)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}}os.DEFAULT_MATERIAL_NAME="__DEFAULT";const Un={};class Sf extends Error{constructor(e,t){super(e),this.response=t}}class Vh extends os{constructor(e){super(e)}load(e,t,n,i){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);const s=ei.get(e);if(s!==void 0)return this.manager.itemStart(e),setTimeout(()=>{t&&t(s),this.manager.itemEnd(e)},0),s;if(Un[e]!==void 0){Un[e].push({onLoad:t,onProgress:n,onError:i});return}Un[e]=[],Un[e].push({onLoad:t,onProgress:n,onError:i});const a=new Request(e,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin"}),o=this.mimeType,l=this.responseType;fetch(a).then(c=>{if(c.status===200||c.status===0){if(c.status===0&&console.warn("THREE.FileLoader: HTTP Status 0 received."),typeof ReadableStream>"u"||c.body===void 0||c.body.getReader===void 0)return c;const h=Un[e],u=c.body.getReader(),d=c.headers.get("X-File-Size")||c.headers.get("Content-Length"),f=d?parseInt(d):0,m=f!==0;let _=0;const g=new ReadableStream({start(p){x();function x(){u.read().then(({done:y,value:v})=>{if(y)p.close();else{_+=v.byteLength;const A=new ProgressEvent("progress",{lengthComputable:m,loaded:_,total:f});for(let E=0,T=h.length;E<T;E++){const P=h[E];P.onProgress&&P.onProgress(A)}p.enqueue(v),x()}},y=>{p.error(y)})}}});return new Response(g)}else throw new Sf(`fetch for "${c.url}" responded with ${c.status}: ${c.statusText}`,c)}).then(c=>{switch(l){case"arraybuffer":return c.arrayBuffer();case"blob":return c.blob();case"document":return c.text().then(h=>new DOMParser().parseFromString(h,o));case"json":return c.json();default:if(o===void 0)return c.text();{const u=/charset="?([^;"\s]*)"?/i.exec(o),d=u&&u[1]?u[1].toLowerCase():void 0,f=new TextDecoder(d);return c.arrayBuffer().then(m=>f.decode(m))}}}).then(c=>{ei.add(e,c);const h=Un[e];delete Un[e];for(let u=0,d=h.length;u<d;u++){const f=h[u];f.onLoad&&f.onLoad(c)}}).catch(c=>{const h=Un[e];if(h===void 0)throw this.manager.itemError(e),c;delete Un[e];for(let u=0,d=h.length;u<d;u++){const f=h[u];f.onError&&f.onError(c)}this.manager.itemError(e)}).finally(()=>{this.manager.itemEnd(e)}),this.manager.itemStart(e)}setResponseType(e){return this.responseType=e,this}setMimeType(e){return this.mimeType=e,this}}class Ef extends os{constructor(e){super(e)}load(e,t,n,i){this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);const s=this,a=ei.get(e);if(a!==void 0)return s.manager.itemStart(e),setTimeout(function(){t&&t(a),s.manager.itemEnd(e)},0),a;const o=Fs("img");function l(){h(),ei.add(e,this),t&&t(this),s.manager.itemEnd(e)}function c(u){h(),i&&i(u),s.manager.itemError(e),s.manager.itemEnd(e)}function h(){o.removeEventListener("load",l,!1),o.removeEventListener("error",c,!1)}return o.addEventListener("load",l,!1),o.addEventListener("error",c,!1),e.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(o.crossOrigin=this.crossOrigin),s.manager.itemStart(e),o.src=e,o}}class Tf extends os{constructor(e){super(e)}load(e,t,n,i){const s=new bt,a=new Ef(this.manager);return a.setCrossOrigin(this.crossOrigin),a.setPath(this.path),a.load(e,function(o){s.image=o,s.needsUpdate=!0,t!==void 0&&t(s)},n,i),s}}class Vs extends gt{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new Te(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){const t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(t.object.target=this.target.uuid),t}}class Gh extends Vs{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(gt.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Te(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}}const Sa=new Fe,lc=new C,cc=new C;class al{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new pe(512,512),this.map=null,this.mapPass=null,this.matrix=new Fe,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Qo,this._frameExtents=new pe(1,1),this._viewportCount=1,this._viewports=[new tt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){const t=this.camera,n=this.matrix;lc.setFromMatrixPosition(e.matrixWorld),t.position.copy(lc),cc.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(cc),t.updateMatrixWorld(),Sa.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(Sa),n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(Sa)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}}class Af extends al{constructor(){super(new Bt(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1}updateMatrices(e){const t=this.camera,n=Zi*2*e.angle*this.focus,i=this.mapSize.width/this.mapSize.height,s=e.distance||t.far;(n!==t.fov||i!==t.aspect||s!==t.far)&&(t.fov=n,t.aspect=i,t.far=s,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this}}class Rf extends Vs{constructor(e,t,n=0,i=Math.PI/3,s=0,a=2){super(e,t),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(gt.DEFAULT_UP),this.updateMatrix(),this.target=new gt,this.distance=n,this.angle=i,this.penumbra=s,this.decay=a,this.map=null,this.shadow=new Af}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}const hc=new Fe,_s=new C,Ea=new C;class Cf extends al{constructor(){super(new Bt(90,1,.5,500)),this.isPointLightShadow=!0,this._frameExtents=new pe(4,2),this._viewportCount=6,this._viewports=[new tt(2,1,1,1),new tt(0,1,1,1),new tt(3,1,1,1),new tt(1,1,1,1),new tt(3,0,1,1),new tt(1,0,1,1)],this._cubeDirections=[new C(1,0,0),new C(-1,0,0),new C(0,0,1),new C(0,0,-1),new C(0,1,0),new C(0,-1,0)],this._cubeUps=[new C(0,1,0),new C(0,1,0),new C(0,1,0),new C(0,1,0),new C(0,0,1),new C(0,0,-1)]}updateMatrices(e,t=0){const n=this.camera,i=this.matrix,s=e.distance||n.far;s!==n.far&&(n.far=s,n.updateProjectionMatrix()),_s.setFromMatrixPosition(e.matrixWorld),n.position.copy(_s),Ea.copy(n.position),Ea.add(this._cubeDirections[t]),n.up.copy(this._cubeUps[t]),n.lookAt(Ea),n.updateMatrixWorld(),i.makeTranslation(-_s.x,-_s.y,-_s.z),hc.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(hc)}}class ol extends Vs{constructor(e,t,n=0,i=2){super(e,t),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=i,this.shadow=new Cf}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}}class ll extends Ah{constructor(e=-1,t=1,n=1,i=-1,s=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=i,this.near=s,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,i,s,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=i,this.view.width=s,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,i=(this.top+this.bottom)/2;let s=n-e,a=n+e,o=i+t,l=i-t;if(this.view!==null&&this.view.enabled){const c=(this.right-this.left)/this.view.fullWidth/this.zoom,h=(this.top-this.bottom)/this.view.fullHeight/this.zoom;s+=c*this.view.offsetX,a=s+c*this.view.width,o-=h*this.view.offsetY,l=o-h*this.view.height}this.projectionMatrix.makeOrthographic(s,a,o,l,this.near,this.far,this.coordinateSystem),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}}class Pf extends al{constructor(){super(new ll(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class is extends Vs{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(gt.DEFAULT_UP),this.updateMatrix(),this.target=new gt,this.shadow=new Pf}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}class cl extends Vs{constructor(e,t){super(e,t),this.isAmbientLight=!0,this.type="AmbientLight"}}class Is{static decodeText(e){if(console.warn("THREE.LoaderUtils: decodeText() has been deprecated with r165 and will be removed with r175. Use TextDecoder instead."),typeof TextDecoder<"u")return new TextDecoder().decode(e);let t="";for(let n=0,i=e.length;n<i;n++)t+=String.fromCharCode(e[n]);try{return decodeURIComponent(escape(t))}catch{return t}}static extractUrlBase(e){const t=e.lastIndexOf("/");return t===-1?"./":e.slice(0,t+1)}static resolveURL(e,t){return typeof e!="string"||e===""?"":(/^https?:\/\//i.test(t)&&/^\//.test(e)&&(t=t.replace(/(^https?:\/\/[^\/]+).*/i,"$1")),/^(https?:)?\/\//i.test(e)||/^data:.*,.*$/i.test(e)||/^blob:.*$/i.test(e)?e:t+e)}}class If extends os{constructor(e){super(e),this.isImageBitmapLoader=!0,typeof createImageBitmap>"u"&&console.warn("THREE.ImageBitmapLoader: createImageBitmap() not supported."),typeof fetch>"u"&&console.warn("THREE.ImageBitmapLoader: fetch() not supported."),this.options={premultiplyAlpha:"none"}}setOptions(e){return this.options=e,this}load(e,t,n,i){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);const s=this,a=ei.get(e);if(a!==void 0){if(s.manager.itemStart(e),a.then){a.then(c=>{t&&t(c),s.manager.itemEnd(e)}).catch(c=>{i&&i(c)});return}return setTimeout(function(){t&&t(a),s.manager.itemEnd(e)},0),a}const o={};o.credentials=this.crossOrigin==="anonymous"?"same-origin":"include",o.headers=this.requestHeader;const l=fetch(e,o).then(function(c){return c.blob()}).then(function(c){return createImageBitmap(c,Object.assign(s.options,{colorSpaceConversion:"none"}))}).then(function(c){return ei.add(e,c),t&&t(c),s.manager.itemEnd(e),c}).catch(function(c){i&&i(c),ei.remove(e),s.manager.itemError(e),s.manager.itemEnd(e)});ei.add(e,l),s.manager.itemStart(e)}}class Lf extends Bt{constructor(e=[]){super(),this.isArrayCamera=!0,this.cameras=e}}class Df{constructor(e,t,n){this.binding=e,this.valueSize=n;let i,s,a;switch(t){case"quaternion":i=this._slerp,s=this._slerpAdditive,a=this._setAdditiveIdentityQuaternion,this.buffer=new Float64Array(n*6),this._workIndex=5;break;case"string":case"bool":i=this._select,s=this._select,a=this._setAdditiveIdentityOther,this.buffer=new Array(n*5);break;default:i=this._lerp,s=this._lerpAdditive,a=this._setAdditiveIdentityNumeric,this.buffer=new Float64Array(n*5)}this._mixBufferRegion=i,this._mixBufferRegionAdditive=s,this._setIdentity=a,this._origIndex=3,this._addIndex=4,this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,this.useCount=0,this.referenceCount=0}accumulate(e,t){const n=this.buffer,i=this.valueSize,s=e*i+i;let a=this.cumulativeWeight;if(a===0){for(let o=0;o!==i;++o)n[s+o]=n[o];a=t}else{a+=t;const o=t/a;this._mixBufferRegion(n,s,0,o,i)}this.cumulativeWeight=a}accumulateAdditive(e){const t=this.buffer,n=this.valueSize,i=n*this._addIndex;this.cumulativeWeightAdditive===0&&this._setIdentity(),this._mixBufferRegionAdditive(t,i,0,e,n),this.cumulativeWeightAdditive+=e}apply(e){const t=this.valueSize,n=this.buffer,i=e*t+t,s=this.cumulativeWeight,a=this.cumulativeWeightAdditive,o=this.binding;if(this.cumulativeWeight=0,this.cumulativeWeightAdditive=0,s<1){const l=t*this._origIndex;this._mixBufferRegion(n,i,l,1-s,t)}a>0&&this._mixBufferRegionAdditive(n,i,this._addIndex*t,1,t);for(let l=t,c=t+t;l!==c;++l)if(n[l]!==n[l+t]){o.setValue(n,i);break}}saveOriginalState(){const e=this.binding,t=this.buffer,n=this.valueSize,i=n*this._origIndex;e.getValue(t,i);for(let s=n,a=i;s!==a;++s)t[s]=t[i+s%n];this._setIdentity(),this.cumulativeWeight=0,this.cumulativeWeightAdditive=0}restoreOriginalState(){const e=this.valueSize*3;this.binding.setValue(this.buffer,e)}_setAdditiveIdentityNumeric(){const e=this._addIndex*this.valueSize,t=e+this.valueSize;for(let n=e;n<t;n++)this.buffer[n]=0}_setAdditiveIdentityQuaternion(){this._setAdditiveIdentityNumeric(),this.buffer[this._addIndex*this.valueSize+3]=1}_setAdditiveIdentityOther(){const e=this._origIndex*this.valueSize,t=this._addIndex*this.valueSize;for(let n=0;n<this.valueSize;n++)this.buffer[t+n]=this.buffer[e+n]}_select(e,t,n,i,s){if(i>=.5)for(let a=0;a!==s;++a)e[t+a]=e[n+a]}_slerp(e,t,n,i){Ct.slerpFlat(e,t,e,t,e,n,i)}_slerpAdditive(e,t,n,i,s){const a=this._workIndex*s;Ct.multiplyQuaternionsFlat(e,a,e,t,e,n),Ct.slerpFlat(e,t,e,t,e,a,i)}_lerp(e,t,n,i,s){const a=1-i;for(let o=0;o!==s;++o){const l=t+o;e[l]=e[l]*a+e[n+o]*i}}_lerpAdditive(e,t,n,i,s){for(let a=0;a!==s;++a){const o=t+a;e[o]=e[o]+e[n+a]*i}}}const hl="\\[\\]\\.:\\/",Nf=new RegExp("["+hl+"]","g"),ul="[^"+hl+"]",Uf="[^"+hl.replace("\\.","")+"]",kf=/((?:WC+[\/:])*)/.source.replace("WC",ul),Ff=/(WCOD+)?/.source.replace("WCOD",Uf),Bf=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",ul),Of=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",ul),zf=new RegExp("^"+kf+Ff+Bf+Of+"$"),Hf=["material","materials","bones","map"];class Vf{constructor(e,t,n){const i=n||st.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,i)}getValue(e,t){this.bind();const n=this._targetGroup.nCachedObjects_,i=this._bindings[n];i!==void 0&&i.getValue(e,t)}setValue(e,t){const n=this._bindings;for(let i=this._targetGroup.nCachedObjects_,s=n.length;i!==s;++i)n[i].setValue(e,t)}bind(){const e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){const e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}}class st{constructor(e,t,n){this.path=t,this.parsedPath=n||st.parseTrackName(t),this.node=st.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new st.Composite(e,t,n):new st(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(Nf,"")}static parseTrackName(e){const t=zf.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);const n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},i=n.nodeName&&n.nodeName.lastIndexOf(".");if(i!==void 0&&i!==-1){const s=n.nodeName.substring(i+1);Hf.indexOf(s)!==-1&&(n.nodeName=n.nodeName.substring(0,i),n.objectName=s)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){const n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){const n=function(s){for(let a=0;a<s.length;a++){const o=s[a];if(o.name===t||o.uuid===t)return o;const l=n(o.children);if(l)return l}return null},i=n(e.children);if(i)return i}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){const n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)e[t++]=n[i]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){const n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=e[t++]}_setValue_array_setNeedsUpdate(e,t){const n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){const n=this.resolvedProperty;for(let i=0,s=n.length;i!==s;++i)n[i]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node;const t=this.parsedPath,n=t.objectName,i=t.propertyName;let s=t.propertyIndex;if(e||(e=st.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let c=t.objectIndex;switch(n){case"materials":if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let h=0;h<e.length;h++)if(e[h].name===c){c=h;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(c!==void 0){if(e[c]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[c]}}const a=e[i];if(a===void 0){const c=t.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+c+"."+i+" but it wasn't found.",e);return}let o=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?o=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(o=this.Versioning.MatrixWorldNeedsUpdate);let l=this.BindingType.Direct;if(s!==void 0){if(i==="morphTargetInfluences"){if(!e.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[s]!==void 0&&(s=e.morphTargetDictionary[s])}l=this.BindingType.ArrayElement,this.resolvedProperty=a,this.propertyIndex=s}else a.fromArray!==void 0&&a.toArray!==void 0?(l=this.BindingType.HasFromToArray,this.resolvedProperty=a):Array.isArray(a)?(l=this.BindingType.EntireArray,this.resolvedProperty=a):this.propertyName=i;this.getValue=this.GetterByBindingType[l],this.setValue=this.SetterByBindingTypeAndVersioning[l][o]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}}st.Composite=Vf;st.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};st.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};st.prototype.GetterByBindingType=[st.prototype._getValue_direct,st.prototype._getValue_array,st.prototype._getValue_arrayElement,st.prototype._getValue_toArray];st.prototype.SetterByBindingTypeAndVersioning=[[st.prototype._setValue_direct,st.prototype._setValue_direct_setNeedsUpdate,st.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[st.prototype._setValue_array,st.prototype._setValue_array_setNeedsUpdate,st.prototype._setValue_array_setMatrixWorldNeedsUpdate],[st.prototype._setValue_arrayElement,st.prototype._setValue_arrayElement_setNeedsUpdate,st.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[st.prototype._setValue_fromArray,st.prototype._setValue_fromArray_setNeedsUpdate,st.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];class Gf{constructor(e,t,n=null,i=t.blendMode){this._mixer=e,this._clip=t,this._localRoot=n,this.blendMode=i;const s=t.tracks,a=s.length,o=new Array(a),l={endingStart:Bi,endingEnd:Bi};for(let c=0;c!==a;++c){const h=s[c].createInterpolant(null);o[c]=h,h.settings=l}this._interpolantSettings=l,this._interpolants=o,this._propertyBindings=new Array(a),this._cacheIndex=null,this._byClipCacheIndex=null,this._timeScaleInterpolant=null,this._weightInterpolant=null,this.loop=Ou,this._loopCount=-1,this._startTime=null,this.time=0,this.timeScale=1,this._effectiveTimeScale=1,this.weight=1,this._effectiveWeight=1,this.repetitions=1/0,this.paused=!1,this.enabled=!0,this.clampWhenFinished=!1,this.zeroSlopeAtStart=!0,this.zeroSlopeAtEnd=!0}play(){return this._mixer._activateAction(this),this}stop(){return this._mixer._deactivateAction(this),this.reset()}reset(){return this.paused=!1,this.enabled=!0,this.time=0,this._loopCount=-1,this._startTime=null,this.stopFading().stopWarping()}isRunning(){return this.enabled&&!this.paused&&this.timeScale!==0&&this._startTime===null&&this._mixer._isActiveAction(this)}isScheduled(){return this._mixer._isActiveAction(this)}startAt(e){return this._startTime=e,this}setLoop(e,t){return this.loop=e,this.repetitions=t,this}setEffectiveWeight(e){return this.weight=e,this._effectiveWeight=this.enabled?e:0,this.stopFading()}getEffectiveWeight(){return this._effectiveWeight}fadeIn(e){return this._scheduleFading(e,0,1)}fadeOut(e){return this._scheduleFading(e,1,0)}crossFadeFrom(e,t,n){if(e.fadeOut(t),this.fadeIn(t),n){const i=this._clip.duration,s=e._clip.duration,a=s/i,o=i/s;e.warp(1,a,t),this.warp(o,1,t)}return this}crossFadeTo(e,t,n){return e.crossFadeFrom(this,t,n)}stopFading(){const e=this._weightInterpolant;return e!==null&&(this._weightInterpolant=null,this._mixer._takeBackControlInterpolant(e)),this}setEffectiveTimeScale(e){return this.timeScale=e,this._effectiveTimeScale=this.paused?0:e,this.stopWarping()}getEffectiveTimeScale(){return this._effectiveTimeScale}setDuration(e){return this.timeScale=this._clip.duration/e,this.stopWarping()}syncWith(e){return this.time=e.time,this.timeScale=e.timeScale,this.stopWarping()}halt(e){return this.warp(this._effectiveTimeScale,0,e)}warp(e,t,n){const i=this._mixer,s=i.time,a=this.timeScale;let o=this._timeScaleInterpolant;o===null&&(o=i._lendControlInterpolant(),this._timeScaleInterpolant=o);const l=o.parameterPositions,c=o.sampleValues;return l[0]=s,l[1]=s+n,c[0]=e/a,c[1]=t/a,this}stopWarping(){const e=this._timeScaleInterpolant;return e!==null&&(this._timeScaleInterpolant=null,this._mixer._takeBackControlInterpolant(e)),this}getMixer(){return this._mixer}getClip(){return this._clip}getRoot(){return this._localRoot||this._mixer._root}_update(e,t,n,i){if(!this.enabled){this._updateWeight(e);return}const s=this._startTime;if(s!==null){const l=(e-s)*n;l<0||n===0?t=0:(this._startTime=null,t=n*l)}t*=this._updateTimeScale(e);const a=this._updateTime(t),o=this._updateWeight(e);if(o>0){const l=this._interpolants,c=this._propertyBindings;switch(this.blendMode){case Hu:for(let h=0,u=l.length;h!==u;++h)l[h].evaluate(a),c[h].accumulateAdditive(o);break;case Yo:default:for(let h=0,u=l.length;h!==u;++h)l[h].evaluate(a),c[h].accumulate(i,o)}}}_updateWeight(e){let t=0;if(this.enabled){t=this.weight;const n=this._weightInterpolant;if(n!==null){const i=n.evaluate(e)[0];t*=i,e>n.parameterPositions[1]&&(this.stopFading(),i===0&&(this.enabled=!1))}}return this._effectiveWeight=t,t}_updateTimeScale(e){let t=0;if(!this.paused){t=this.timeScale;const n=this._timeScaleInterpolant;if(n!==null){const i=n.evaluate(e)[0];t*=i,e>n.parameterPositions[1]&&(this.stopWarping(),t===0?this.paused=!0:this.timeScale=t)}}return this._effectiveTimeScale=t,t}_updateTime(e){const t=this._clip.duration,n=this.loop;let i=this.time+e,s=this._loopCount;const a=n===zu;if(e===0)return s===-1?i:a&&(s&1)===1?t-i:i;if(n===gh){s===-1&&(this._loopCount=0,this._setEndings(!0,!0,!1));e:{if(i>=t)i=t;else if(i<0)i=0;else{this.time=i;break e}this.clampWhenFinished?this.paused=!0:this.enabled=!1,this.time=i,this._mixer.dispatchEvent({type:"finished",action:this,direction:e<0?-1:1})}}else{if(s===-1&&(e>=0?(s=0,this._setEndings(!0,this.repetitions===0,a)):this._setEndings(this.repetitions===0,!0,a)),i>=t||i<0){const o=Math.floor(i/t);i-=t*o,s+=Math.abs(o);const l=this.repetitions-s;if(l<=0)this.clampWhenFinished?this.paused=!0:this.enabled=!1,i=e>0?t:0,this.time=i,this._mixer.dispatchEvent({type:"finished",action:this,direction:e>0?1:-1});else{if(l===1){const c=e<0;this._setEndings(c,!c,a)}else this._setEndings(!1,!1,a);this._loopCount=s,this.time=i,this._mixer.dispatchEvent({type:"loop",action:this,loopDelta:o})}}else this.time=i;if(a&&(s&1)===1)return t-i}return i}_setEndings(e,t,n){const i=this._interpolantSettings;n?(i.endingStart=Oi,i.endingEnd=Oi):(e?i.endingStart=this.zeroSlopeAtStart?Oi:Bi:i.endingStart=Ur,t?i.endingEnd=this.zeroSlopeAtEnd?Oi:Bi:i.endingEnd=Ur)}_scheduleFading(e,t,n){const i=this._mixer,s=i.time;let a=this._weightInterpolant;a===null&&(a=i._lendControlInterpolant(),this._weightInterpolant=a);const o=a.parameterPositions,l=a.sampleValues;return o[0]=s,l[0]=t,o[1]=s+e,l[1]=n,this}}const Wf=new Float32Array(1);class Xf extends vi{constructor(e){super(),this._root=e,this._initMemoryManager(),this._accuIndex=0,this.time=0,this.timeScale=1}_bindAction(e,t){const n=e._localRoot||this._root,i=e._clip.tracks,s=i.length,a=e._propertyBindings,o=e._interpolants,l=n.uuid,c=this._bindingsByRootAndName;let h=c[l];h===void 0&&(h={},c[l]=h);for(let u=0;u!==s;++u){const d=i[u],f=d.name;let m=h[f];if(m!==void 0)++m.referenceCount,a[u]=m;else{if(m=a[u],m!==void 0){m._cacheIndex===null&&(++m.referenceCount,this._addInactiveBinding(m,l,f));continue}const _=t&&t._propertyBindings[u].binding.parsedPath;m=new Df(st.create(n,f,_),d.ValueTypeName,d.getValueSize()),++m.referenceCount,this._addInactiveBinding(m,l,f),a[u]=m}o[u].resultBuffer=m.buffer}}_activateAction(e){if(!this._isActiveAction(e)){if(e._cacheIndex===null){const n=(e._localRoot||this._root).uuid,i=e._clip.uuid,s=this._actionsByClip[i];this._bindAction(e,s&&s.knownActions[0]),this._addInactiveAction(e,i,n)}const t=e._propertyBindings;for(let n=0,i=t.length;n!==i;++n){const s=t[n];s.useCount++===0&&(this._lendBinding(s),s.saveOriginalState())}this._lendAction(e)}}_deactivateAction(e){if(this._isActiveAction(e)){const t=e._propertyBindings;for(let n=0,i=t.length;n!==i;++n){const s=t[n];--s.useCount===0&&(s.restoreOriginalState(),this._takeBackBinding(s))}this._takeBackAction(e)}}_initMemoryManager(){this._actions=[],this._nActiveActions=0,this._actionsByClip={},this._bindings=[],this._nActiveBindings=0,this._bindingsByRootAndName={},this._controlInterpolants=[],this._nActiveControlInterpolants=0;const e=this;this.stats={actions:{get total(){return e._actions.length},get inUse(){return e._nActiveActions}},bindings:{get total(){return e._bindings.length},get inUse(){return e._nActiveBindings}},controlInterpolants:{get total(){return e._controlInterpolants.length},get inUse(){return e._nActiveControlInterpolants}}}}_isActiveAction(e){const t=e._cacheIndex;return t!==null&&t<this._nActiveActions}_addInactiveAction(e,t,n){const i=this._actions,s=this._actionsByClip;let a=s[t];if(a===void 0)a={knownActions:[e],actionByRoot:{}},e._byClipCacheIndex=0,s[t]=a;else{const o=a.knownActions;e._byClipCacheIndex=o.length,o.push(e)}e._cacheIndex=i.length,i.push(e),a.actionByRoot[n]=e}_removeInactiveAction(e){const t=this._actions,n=t[t.length-1],i=e._cacheIndex;n._cacheIndex=i,t[i]=n,t.pop(),e._cacheIndex=null;const s=e._clip.uuid,a=this._actionsByClip,o=a[s],l=o.knownActions,c=l[l.length-1],h=e._byClipCacheIndex;c._byClipCacheIndex=h,l[h]=c,l.pop(),e._byClipCacheIndex=null;const u=o.actionByRoot,d=(e._localRoot||this._root).uuid;delete u[d],l.length===0&&delete a[s],this._removeInactiveBindingsForAction(e)}_removeInactiveBindingsForAction(e){const t=e._propertyBindings;for(let n=0,i=t.length;n!==i;++n){const s=t[n];--s.referenceCount===0&&this._removeInactiveBinding(s)}}_lendAction(e){const t=this._actions,n=e._cacheIndex,i=this._nActiveActions++,s=t[i];e._cacheIndex=i,t[i]=e,s._cacheIndex=n,t[n]=s}_takeBackAction(e){const t=this._actions,n=e._cacheIndex,i=--this._nActiveActions,s=t[i];e._cacheIndex=i,t[i]=e,s._cacheIndex=n,t[n]=s}_addInactiveBinding(e,t,n){const i=this._bindingsByRootAndName,s=this._bindings;let a=i[t];a===void 0&&(a={},i[t]=a),a[n]=e,e._cacheIndex=s.length,s.push(e)}_removeInactiveBinding(e){const t=this._bindings,n=e.binding,i=n.rootNode.uuid,s=n.path,a=this._bindingsByRootAndName,o=a[i],l=t[t.length-1],c=e._cacheIndex;l._cacheIndex=c,t[c]=l,t.pop(),delete o[s],Object.keys(o).length===0&&delete a[i]}_lendBinding(e){const t=this._bindings,n=e._cacheIndex,i=this._nActiveBindings++,s=t[i];e._cacheIndex=i,t[i]=e,s._cacheIndex=n,t[n]=s}_takeBackBinding(e){const t=this._bindings,n=e._cacheIndex,i=--this._nActiveBindings,s=t[i];e._cacheIndex=i,t[i]=e,s._cacheIndex=n,t[n]=s}_lendControlInterpolant(){const e=this._controlInterpolants,t=this._nActiveControlInterpolants++;let n=e[t];return n===void 0&&(n=new zh(new Float32Array(2),new Float32Array(2),1,Wf),n.__cacheIndex=t,e[t]=n),n}_takeBackControlInterpolant(e){const t=this._controlInterpolants,n=e.__cacheIndex,i=--this._nActiveControlInterpolants,s=t[i];e.__cacheIndex=i,t[i]=e,s.__cacheIndex=n,t[n]=s}clipAction(e,t,n){const i=t||this._root,s=i.uuid;let a=typeof e=="string"?Co.findByName(i,e):e;const o=a!==null?a.uuid:e,l=this._actionsByClip[o];let c=null;if(n===void 0&&(a!==null?n=a.blendMode:n=Yo),l!==void 0){const u=l.actionByRoot[s];if(u!==void 0&&u.blendMode===n)return u;c=l.knownActions[0],a===null&&(a=c._clip)}if(a===null)return null;const h=new Gf(this,a,t,n);return this._bindAction(h,c),this._addInactiveAction(h,o,s),h}existingAction(e,t){const n=t||this._root,i=n.uuid,s=typeof e=="string"?Co.findByName(n,e):e,a=s?s.uuid:e,o=this._actionsByClip[a];return o!==void 0&&o.actionByRoot[i]||null}stopAllAction(){const e=this._actions,t=this._nActiveActions;for(let n=t-1;n>=0;--n)e[n].stop();return this}update(e){e*=this.timeScale;const t=this._actions,n=this._nActiveActions,i=this.time+=e,s=Math.sign(e),a=this._accuIndex^=1;for(let c=0;c!==n;++c)t[c]._update(i,e,s,a);const o=this._bindings,l=this._nActiveBindings;for(let c=0;c!==l;++c)o[c].apply(a);return this}setTime(e){this.time=0;for(let t=0;t<this._actions.length;t++)this._actions[t].time=0;return this.update(e)}getRoot(){return this._root}uncacheClip(e){const t=this._actions,n=e.uuid,i=this._actionsByClip,s=i[n];if(s!==void 0){const a=s.knownActions;for(let o=0,l=a.length;o!==l;++o){const c=a[o];this._deactivateAction(c);const h=c._cacheIndex,u=t[t.length-1];c._cacheIndex=null,c._byClipCacheIndex=null,u._cacheIndex=h,t[h]=u,t.pop(),this._removeInactiveBindingsForAction(c)}delete i[n]}}uncacheRoot(e){const t=e.uuid,n=this._actionsByClip;for(const a in n){const o=n[a].actionByRoot,l=o[t];l!==void 0&&(this._deactivateAction(l),this._removeInactiveAction(l))}const i=this._bindingsByRootAndName,s=i[t];if(s!==void 0)for(const a in s){const o=s[a];o.restoreOriginalState(),this._removeInactiveBinding(o)}}uncacheAction(e,t){const n=this.existingAction(e,t);n!==null&&(this._deactivateAction(n),this._removeInactiveAction(n))}}const uc=new Fe;class qf{constructor(e,t,n=0,i=1/0){this.ray=new zs(e,t),this.near=n,this.far=i,this.camera=null,this.layers=new jo,this.params={Mesh:{},Line:{threshold:1},LOD:{},Points:{threshold:1},Sprite:{}}}set(e,t){this.ray.set(e,t)}setFromCamera(e,t){t.isPerspectiveCamera?(this.ray.origin.setFromMatrixPosition(t.matrixWorld),this.ray.direction.set(e.x,e.y,.5).unproject(t).sub(this.ray.origin).normalize(),this.camera=t):t.isOrthographicCamera?(this.ray.origin.set(e.x,e.y,(t.near+t.far)/(t.near-t.far)).unproject(t),this.ray.direction.set(0,0,-1).transformDirection(t.matrixWorld),this.camera=t):console.error("THREE.Raycaster: Unsupported camera type: "+t.type)}setFromXRController(e){return uc.identity().extractRotation(e.matrixWorld),this.ray.origin.setFromMatrixPosition(e.matrixWorld),this.ray.direction.set(0,0,-1).applyMatrix4(uc),this}intersectObject(e,t=!0,n=[]){return Po(e,this,n,t),n.sort(dc),n}intersectObjects(e,t=!0,n=[]){for(let i=0,s=e.length;i<s;i++)Po(e[i],this,n,t);return n.sort(dc),n}}function dc(r,e){return r.distance-e.distance}function Po(r,e,t,n){let i=!0;if(r.layers.test(e.layers)&&r.raycast(e,t)===!1&&(i=!1),i===!0&&n===!0){const s=r.children;for(let a=0,o=s.length;a<o;a++)Po(s[a],e,t,!0)}}function fc(r,e,t,n){const i=Yf(n);switch(t){case hh:return r*e;case dh:return r*e;case fh:return r*e*2;case Go:return r*e/i.components*i.byteLength;case Wo:return r*e/i.components*i.byteLength;case ph:return r*e*2/i.components*i.byteLength;case Xo:return r*e*2/i.components*i.byteLength;case uh:return r*e*3/i.components*i.byteLength;case an:return r*e*4/i.components*i.byteLength;case qo:return r*e*4/i.components*i.byteLength;case Er:case Tr:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*8;case Ar:case Rr:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*16;case Qa:case to:return Math.max(r,16)*Math.max(e,8)/4;case Za:case eo:return Math.max(r,8)*Math.max(e,8)/2;case no:case io:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*8;case so:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*16;case ro:return Math.floor((r+3)/4)*Math.floor((e+3)/4)*16;case ao:return Math.floor((r+4)/5)*Math.floor((e+3)/4)*16;case oo:return Math.floor((r+4)/5)*Math.floor((e+4)/5)*16;case lo:return Math.floor((r+5)/6)*Math.floor((e+4)/5)*16;case co:return Math.floor((r+5)/6)*Math.floor((e+5)/6)*16;case ho:return Math.floor((r+7)/8)*Math.floor((e+4)/5)*16;case uo:return Math.floor((r+7)/8)*Math.floor((e+5)/6)*16;case fo:return Math.floor((r+7)/8)*Math.floor((e+7)/8)*16;case po:return Math.floor((r+9)/10)*Math.floor((e+4)/5)*16;case mo:return Math.floor((r+9)/10)*Math.floor((e+5)/6)*16;case go:return Math.floor((r+9)/10)*Math.floor((e+7)/8)*16;case _o:return Math.floor((r+9)/10)*Math.floor((e+9)/10)*16;case xo:return Math.floor((r+11)/12)*Math.floor((e+9)/10)*16;case vo:return Math.floor((r+11)/12)*Math.floor((e+11)/12)*16;case Cr:case yo:case Mo:return Math.ceil(r/4)*Math.ceil(e/4)*16;case mh:case wo:return Math.ceil(r/4)*Math.ceil(e/4)*8;case bo:case So:return Math.ceil(r/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function Yf(r){switch(r){case Gn:case oh:return{byteLength:1,components:1};case Ns:case lh:case Os:return{byteLength:2,components:1};case Ho:case Vo:return{byteLength:2,components:4};case gi:case zo:case mn:return{byteLength:4,components:1};case ch:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${r}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:Oo}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=Oo);/**
 * @license
 * Copyright 2010-2024 Three.js Authors
 * SPDX-License-Identifier: MIT
 */function Wh(){let r=null,e=!1,t=null,n=null;function i(s,a){t(s,a),n=r.requestAnimationFrame(i)}return{start:function(){e!==!0&&t!==null&&(n=r.requestAnimationFrame(i),e=!0)},stop:function(){r.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(s){t=s},setContext:function(s){r=s}}}function $f(r){const e=new WeakMap;function t(o,l){const c=o.array,h=o.usage,u=c.byteLength,d=r.createBuffer();r.bindBuffer(l,d),r.bufferData(l,c,h),o.onUploadCallback();let f;if(c instanceof Float32Array)f=r.FLOAT;else if(c instanceof Uint16Array)o.isFloat16BufferAttribute?f=r.HALF_FLOAT:f=r.UNSIGNED_SHORT;else if(c instanceof Int16Array)f=r.SHORT;else if(c instanceof Uint32Array)f=r.UNSIGNED_INT;else if(c instanceof Int32Array)f=r.INT;else if(c instanceof Int8Array)f=r.BYTE;else if(c instanceof Uint8Array)f=r.UNSIGNED_BYTE;else if(c instanceof Uint8ClampedArray)f=r.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+c);return{buffer:d,type:f,bytesPerElement:c.BYTES_PER_ELEMENT,version:o.version,size:u}}function n(o,l,c){const h=l.array,u=l.updateRanges;if(r.bindBuffer(c,o),u.length===0)r.bufferSubData(c,0,h);else{u.sort((f,m)=>f.start-m.start);let d=0;for(let f=1;f<u.length;f++){const m=u[d],_=u[f];_.start<=m.start+m.count+1?m.count=Math.max(m.count,_.start+_.count-m.start):(++d,u[d]=_)}u.length=d+1;for(let f=0,m=u.length;f<m;f++){const _=u[f];r.bufferSubData(c,_.start*h.BYTES_PER_ELEMENT,h,_.start,_.count)}l.clearUpdateRanges()}l.onUploadCallback()}function i(o){return o.isInterleavedBufferAttribute&&(o=o.data),e.get(o)}function s(o){o.isInterleavedBufferAttribute&&(o=o.data);const l=e.get(o);l&&(r.deleteBuffer(l.buffer),e.delete(o))}function a(o,l){if(o.isInterleavedBufferAttribute&&(o=o.data),o.isGLBufferAttribute){const h=e.get(o);(!h||h.version<o.version)&&e.set(o,{buffer:o.buffer,type:o.type,bytesPerElement:o.elementSize,version:o.version});return}const c=e.get(o);if(c===void 0)e.set(o,t(o,l));else if(c.version<o.version){if(c.size!==o.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(c.buffer,o,l),c.version=o.version}}return{get:i,remove:s,update:a}}var jf=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Kf=`#ifdef USE_ALPHAHASH
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
#endif`,Jf=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Zf=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Qf=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,ep=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,tp=`#ifdef USE_AOMAP
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
#endif`,np=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,ip=`#ifdef USE_BATCHING
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
#endif`,sp=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,rp=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,ap=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,op=`float G_BlinnPhong_Implicit( ) {
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
} // validated`,lp=`#ifdef USE_IRIDESCENCE
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
#endif`,cp=`#ifdef USE_BUMPMAP
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
#endif`,hp=`#if NUM_CLIPPING_PLANES > 0
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
#endif`,up=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,dp=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,fp=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,pp=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,mp=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,gp=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,_p=`#if defined( USE_COLOR_ALPHA )
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
#endif`,xp=`#define PI 3.141592653589793
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
} // validated`,vp=`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,yp=`vec3 transformedNormal = objectNormal;
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
#endif`,Mp=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,wp=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,bp=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,Sp=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,Ep="gl_FragColor = linearToOutputTexel( gl_FragColor );",Tp=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,Ap=`#ifdef USE_ENVMAP
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
#endif`,Rp=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,Cp=`#ifdef USE_ENVMAP
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
#endif`,Pp=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Ip=`#ifdef USE_ENVMAP
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
#endif`,Lp=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,Dp=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,Np=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,Up=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,kp=`#ifdef USE_GRADIENTMAP
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
}`,Fp=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,Bp=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,Op=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,zp=`uniform bool receiveShadow;
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
#endif`,Hp=`#ifdef USE_ENVMAP
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
#endif`,Vp=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,Gp=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,Wp=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,Xp=`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,qp=`PhysicalMaterial material;
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
#endif`,Yp=`struct PhysicalMaterial {
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
}`,$p=`
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
#endif`,jp=`#if defined( RE_IndirectDiffuse )
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
#endif`,Kp=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,Jp=`#if defined( USE_LOGDEPTHBUF )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,Zp=`#if defined( USE_LOGDEPTHBUF )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,Qp=`#ifdef USE_LOGDEPTHBUF
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,em=`#ifdef USE_LOGDEPTHBUF
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,tm=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,nm=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,im=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,sm=`#if defined( USE_POINTS_UV )
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
#endif`,rm=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,am=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,om=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,lm=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,cm=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,hm=`#ifdef USE_MORPHTARGETS
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
#endif`,um=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,dm=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
vec3 nonPerturbedNormal = normal;`,fm=`#ifdef USE_NORMALMAP_OBJECTSPACE
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
#endif`,pm=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,mm=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,gm=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,_m=`#ifdef USE_NORMALMAP
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
#endif`,xm=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,vm=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,ym=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,Mm=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,wm=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,bm=`vec3 packNormalToRGB( const in vec3 normal ) {
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
}`,Sm=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,Em=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,Tm=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,Am=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,Rm=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,Cm=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,Pm=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,Im=`#if NUM_SPOT_LIGHT_COORDS > 0
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
#endif`,Lm=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
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
#endif`,Dm=`float getShadowMask() {
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
}`,Nm=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,Um=`#ifdef USE_SKINNING
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
#endif`,km=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,Fm=`#ifdef USE_SKINNING
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
#endif`,Bm=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,Om=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,zm=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,Hm=`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,Vm=`#ifdef USE_TRANSMISSION
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
#endif`,Gm=`#ifdef USE_TRANSMISSION
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
#endif`,Wm=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Xm=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,qm=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,Ym=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const $m=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,jm=`uniform sampler2D t2D;
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
}`,Km=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Jm=`#ifdef ENVMAP_TYPE_CUBE
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
}`,Zm=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,Qm=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,e0=`#include <common>
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
}`,t0=`#if DEPTH_PACKING == 3200
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
}`,n0=`#define DISTANCE
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
}`,i0=`#define DISTANCE
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
}`,s0=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,r0=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,a0=`uniform float scale;
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
}`,o0=`uniform vec3 diffuse;
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
}`,l0=`#include <common>
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
}`,c0=`uniform vec3 diffuse;
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
}`,h0=`#define LAMBERT
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
}`,u0=`#define LAMBERT
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
}`,d0=`#define MATCAP
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
}`,f0=`#define MATCAP
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
}`,p0=`#define NORMAL
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
}`,m0=`#define NORMAL
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
}`,g0=`#define PHONG
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
}`,_0=`#define PHONG
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
}`,x0=`#define STANDARD
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
}`,v0=`#define STANDARD
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
}`,y0=`#define TOON
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
}`,M0=`#define TOON
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
}`,w0=`uniform float size;
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
}`,b0=`uniform vec3 diffuse;
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
}`,S0=`#include <common>
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
}`,E0=`uniform vec3 color;
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
}`,T0=`uniform float rotation;
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
}`,A0=`uniform vec3 diffuse;
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
}`,He={alphahash_fragment:jf,alphahash_pars_fragment:Kf,alphamap_fragment:Jf,alphamap_pars_fragment:Zf,alphatest_fragment:Qf,alphatest_pars_fragment:ep,aomap_fragment:tp,aomap_pars_fragment:np,batching_pars_vertex:ip,batching_vertex:sp,begin_vertex:rp,beginnormal_vertex:ap,bsdfs:op,iridescence_fragment:lp,bumpmap_pars_fragment:cp,clipping_planes_fragment:hp,clipping_planes_pars_fragment:up,clipping_planes_pars_vertex:dp,clipping_planes_vertex:fp,color_fragment:pp,color_pars_fragment:mp,color_pars_vertex:gp,color_vertex:_p,common:xp,cube_uv_reflection_fragment:vp,defaultnormal_vertex:yp,displacementmap_pars_vertex:Mp,displacementmap_vertex:wp,emissivemap_fragment:bp,emissivemap_pars_fragment:Sp,colorspace_fragment:Ep,colorspace_pars_fragment:Tp,envmap_fragment:Ap,envmap_common_pars_fragment:Rp,envmap_pars_fragment:Cp,envmap_pars_vertex:Pp,envmap_physical_pars_fragment:Hp,envmap_vertex:Ip,fog_vertex:Lp,fog_pars_vertex:Dp,fog_fragment:Np,fog_pars_fragment:Up,gradientmap_pars_fragment:kp,lightmap_pars_fragment:Fp,lights_lambert_fragment:Bp,lights_lambert_pars_fragment:Op,lights_pars_begin:zp,lights_toon_fragment:Vp,lights_toon_pars_fragment:Gp,lights_phong_fragment:Wp,lights_phong_pars_fragment:Xp,lights_physical_fragment:qp,lights_physical_pars_fragment:Yp,lights_fragment_begin:$p,lights_fragment_maps:jp,lights_fragment_end:Kp,logdepthbuf_fragment:Jp,logdepthbuf_pars_fragment:Zp,logdepthbuf_pars_vertex:Qp,logdepthbuf_vertex:em,map_fragment:tm,map_pars_fragment:nm,map_particle_fragment:im,map_particle_pars_fragment:sm,metalnessmap_fragment:rm,metalnessmap_pars_fragment:am,morphinstance_vertex:om,morphcolor_vertex:lm,morphnormal_vertex:cm,morphtarget_pars_vertex:hm,morphtarget_vertex:um,normal_fragment_begin:dm,normal_fragment_maps:fm,normal_pars_fragment:pm,normal_pars_vertex:mm,normal_vertex:gm,normalmap_pars_fragment:_m,clearcoat_normal_fragment_begin:xm,clearcoat_normal_fragment_maps:vm,clearcoat_pars_fragment:ym,iridescence_pars_fragment:Mm,opaque_fragment:wm,packing:bm,premultiplied_alpha_fragment:Sm,project_vertex:Em,dithering_fragment:Tm,dithering_pars_fragment:Am,roughnessmap_fragment:Rm,roughnessmap_pars_fragment:Cm,shadowmap_pars_fragment:Pm,shadowmap_pars_vertex:Im,shadowmap_vertex:Lm,shadowmask_pars_fragment:Dm,skinbase_vertex:Nm,skinning_pars_vertex:Um,skinning_vertex:km,skinnormal_vertex:Fm,specularmap_fragment:Bm,specularmap_pars_fragment:Om,tonemapping_fragment:zm,tonemapping_pars_fragment:Hm,transmission_fragment:Vm,transmission_pars_fragment:Gm,uv_pars_fragment:Wm,uv_pars_vertex:Xm,uv_vertex:qm,worldpos_vertex:Ym,background_vert:$m,background_frag:jm,backgroundCube_vert:Km,backgroundCube_frag:Jm,cube_vert:Zm,cube_frag:Qm,depth_vert:e0,depth_frag:t0,distanceRGBA_vert:n0,distanceRGBA_frag:i0,equirect_vert:s0,equirect_frag:r0,linedashed_vert:a0,linedashed_frag:o0,meshbasic_vert:l0,meshbasic_frag:c0,meshlambert_vert:h0,meshlambert_frag:u0,meshmatcap_vert:d0,meshmatcap_frag:f0,meshnormal_vert:p0,meshnormal_frag:m0,meshphong_vert:g0,meshphong_frag:_0,meshphysical_vert:x0,meshphysical_frag:v0,meshtoon_vert:y0,meshtoon_frag:M0,points_vert:w0,points_frag:b0,shadow_vert:S0,shadow_frag:E0,sprite_vert:T0,sprite_frag:A0},oe={common:{diffuse:{value:new Te(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Oe},alphaMap:{value:null},alphaMapTransform:{value:new Oe},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Oe}},envmap:{envMap:{value:null},envMapRotation:{value:new Oe},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Oe}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Oe}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Oe},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Oe},normalScale:{value:new pe(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Oe},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Oe}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Oe}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Oe}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Te(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new Te(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Oe},alphaTest:{value:0},uvTransform:{value:new Oe}},sprite:{diffuse:{value:new Te(16777215)},opacity:{value:1},center:{value:new pe(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Oe},alphaMap:{value:null},alphaMapTransform:{value:new Oe},alphaTest:{value:0}}},vn={basic:{uniforms:Vt([oe.common,oe.specularmap,oe.envmap,oe.aomap,oe.lightmap,oe.fog]),vertexShader:He.meshbasic_vert,fragmentShader:He.meshbasic_frag},lambert:{uniforms:Vt([oe.common,oe.specularmap,oe.envmap,oe.aomap,oe.lightmap,oe.emissivemap,oe.bumpmap,oe.normalmap,oe.displacementmap,oe.fog,oe.lights,{emissive:{value:new Te(0)}}]),vertexShader:He.meshlambert_vert,fragmentShader:He.meshlambert_frag},phong:{uniforms:Vt([oe.common,oe.specularmap,oe.envmap,oe.aomap,oe.lightmap,oe.emissivemap,oe.bumpmap,oe.normalmap,oe.displacementmap,oe.fog,oe.lights,{emissive:{value:new Te(0)},specular:{value:new Te(1118481)},shininess:{value:30}}]),vertexShader:He.meshphong_vert,fragmentShader:He.meshphong_frag},standard:{uniforms:Vt([oe.common,oe.envmap,oe.aomap,oe.lightmap,oe.emissivemap,oe.bumpmap,oe.normalmap,oe.displacementmap,oe.roughnessmap,oe.metalnessmap,oe.fog,oe.lights,{emissive:{value:new Te(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:He.meshphysical_vert,fragmentShader:He.meshphysical_frag},toon:{uniforms:Vt([oe.common,oe.aomap,oe.lightmap,oe.emissivemap,oe.bumpmap,oe.normalmap,oe.displacementmap,oe.gradientmap,oe.fog,oe.lights,{emissive:{value:new Te(0)}}]),vertexShader:He.meshtoon_vert,fragmentShader:He.meshtoon_frag},matcap:{uniforms:Vt([oe.common,oe.bumpmap,oe.normalmap,oe.displacementmap,oe.fog,{matcap:{value:null}}]),vertexShader:He.meshmatcap_vert,fragmentShader:He.meshmatcap_frag},points:{uniforms:Vt([oe.points,oe.fog]),vertexShader:He.points_vert,fragmentShader:He.points_frag},dashed:{uniforms:Vt([oe.common,oe.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:He.linedashed_vert,fragmentShader:He.linedashed_frag},depth:{uniforms:Vt([oe.common,oe.displacementmap]),vertexShader:He.depth_vert,fragmentShader:He.depth_frag},normal:{uniforms:Vt([oe.common,oe.bumpmap,oe.normalmap,oe.displacementmap,{opacity:{value:1}}]),vertexShader:He.meshnormal_vert,fragmentShader:He.meshnormal_frag},sprite:{uniforms:Vt([oe.sprite,oe.fog]),vertexShader:He.sprite_vert,fragmentShader:He.sprite_frag},background:{uniforms:{uvTransform:{value:new Oe},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:He.background_vert,fragmentShader:He.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Oe}},vertexShader:He.backgroundCube_vert,fragmentShader:He.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:He.cube_vert,fragmentShader:He.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:He.equirect_vert,fragmentShader:He.equirect_frag},distanceRGBA:{uniforms:Vt([oe.common,oe.displacementmap,{referencePosition:{value:new C},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:He.distanceRGBA_vert,fragmentShader:He.distanceRGBA_frag},shadow:{uniforms:Vt([oe.lights,oe.fog,{color:{value:new Te(0)},opacity:{value:1}}]),vertexShader:He.shadow_vert,fragmentShader:He.shadow_frag}};vn.physical={uniforms:Vt([vn.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Oe},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Oe},clearcoatNormalScale:{value:new pe(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Oe},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Oe},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Oe},sheen:{value:0},sheenColor:{value:new Te(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Oe},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Oe},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Oe},transmissionSamplerSize:{value:new pe},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Oe},attenuationDistance:{value:0},attenuationColor:{value:new Te(0)},specularColor:{value:new Te(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Oe},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Oe},anisotropyVector:{value:new pe},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Oe}}]),vertexShader:He.meshphysical_vert,fragmentShader:He.meshphysical_frag};const gr={r:0,b:0,g:0},ci=new bn,R0=new Fe;function C0(r,e,t,n,i,s,a){const o=new Te(0);let l=s===!0?0:1,c,h,u=null,d=0,f=null;function m(y){let v=y.isScene===!0?y.background:null;return v&&v.isTexture&&(v=(y.backgroundBlurriness>0?t:e).get(v)),v}function _(y){let v=!1;const A=m(y);A===null?p(o,l):A&&A.isColor&&(p(A,1),v=!0);const E=r.xr.getEnvironmentBlendMode();E==="additive"?n.buffers.color.setClear(0,0,0,1,a):E==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,a),(r.autoClear||v)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),r.clear(r.autoClearColor,r.autoClearDepth,r.autoClearStencil))}function g(y,v){const A=m(v);A&&(A.isCubeTexture||A.mapping===qr)?(h===void 0&&(h=new D(new We(1,1,1),new Sn({name:"BackgroundCubeMaterial",uniforms:Qi(vn.backgroundCube.uniforms),vertexShader:vn.backgroundCube.vertexShader,fragmentShader:vn.backgroundCube.fragmentShader,side:Gt,depthTest:!1,depthWrite:!1,fog:!1})),h.geometry.deleteAttribute("normal"),h.geometry.deleteAttribute("uv"),h.onBeforeRender=function(E,T,P){this.matrixWorld.copyPosition(P.matrixWorld)},Object.defineProperty(h.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(h)),ci.copy(v.backgroundRotation),ci.x*=-1,ci.y*=-1,ci.z*=-1,A.isCubeTexture&&A.isRenderTargetTexture===!1&&(ci.y*=-1,ci.z*=-1),h.material.uniforms.envMap.value=A,h.material.uniforms.flipEnvMap.value=A.isCubeTexture&&A.isRenderTargetTexture===!1?-1:1,h.material.uniforms.backgroundBlurriness.value=v.backgroundBlurriness,h.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,h.material.uniforms.backgroundRotation.value.setFromMatrix4(R0.makeRotationFromEuler(ci)),h.material.toneMapped=Je.getTransfer(A.colorSpace)!==lt,(u!==A||d!==A.version||f!==r.toneMapping)&&(h.material.needsUpdate=!0,u=A,d=A.version,f=r.toneMapping),h.layers.enableAll(),y.unshift(h,h.geometry,h.material,0,0,null)):A&&A.isTexture&&(c===void 0&&(c=new D(new Qt(2,2),new Sn({name:"BackgroundMaterial",uniforms:Qi(vn.background.uniforms),vertexShader:vn.background.vertexShader,fragmentShader:vn.background.fragmentShader,side:Vn,depthTest:!1,depthWrite:!1,fog:!1})),c.geometry.deleteAttribute("normal"),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(c)),c.material.uniforms.t2D.value=A,c.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,c.material.toneMapped=Je.getTransfer(A.colorSpace)!==lt,A.matrixAutoUpdate===!0&&A.updateMatrix(),c.material.uniforms.uvTransform.value.copy(A.matrix),(u!==A||d!==A.version||f!==r.toneMapping)&&(c.material.needsUpdate=!0,u=A,d=A.version,f=r.toneMapping),c.layers.enableAll(),y.unshift(c,c.geometry,c.material,0,0,null))}function p(y,v){y.getRGB(gr,Th(r)),n.buffers.color.setClear(gr.r,gr.g,gr.b,v,a)}function x(){h!==void 0&&(h.geometry.dispose(),h.material.dispose()),c!==void 0&&(c.geometry.dispose(),c.material.dispose())}return{getClearColor:function(){return o},setClearColor:function(y,v=1){o.set(y),l=v,p(o,l)},getClearAlpha:function(){return l},setClearAlpha:function(y){l=y,p(o,l)},render:_,addToRenderList:g,dispose:x}}function P0(r,e){const t=r.getParameter(r.MAX_VERTEX_ATTRIBS),n={},i=d(null);let s=i,a=!1;function o(M,I,B,z,V){let q=!1;const j=u(z,B,I);s!==j&&(s=j,c(s.object)),q=f(M,z,B,V),q&&m(M,z,B,V),V!==null&&e.update(V,r.ELEMENT_ARRAY_BUFFER),(q||a)&&(a=!1,v(M,I,B,z),V!==null&&r.bindBuffer(r.ELEMENT_ARRAY_BUFFER,e.get(V).buffer))}function l(){return r.createVertexArray()}function c(M){return r.bindVertexArray(M)}function h(M){return r.deleteVertexArray(M)}function u(M,I,B){const z=B.wireframe===!0;let V=n[M.id];V===void 0&&(V={},n[M.id]=V);let q=V[I.id];q===void 0&&(q={},V[I.id]=q);let j=q[z];return j===void 0&&(j=d(l()),q[z]=j),j}function d(M){const I=[],B=[],z=[];for(let V=0;V<t;V++)I[V]=0,B[V]=0,z[V]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:I,enabledAttributes:B,attributeDivisors:z,object:M,attributes:{},index:null}}function f(M,I,B,z){const V=s.attributes,q=I.attributes;let j=0;const Q=B.getAttributes();for(const N in Q)if(Q[N].location>=0){const W=V[N];let re=q[N];if(re===void 0&&(N==="instanceMatrix"&&M.instanceMatrix&&(re=M.instanceMatrix),N==="instanceColor"&&M.instanceColor&&(re=M.instanceColor)),W===void 0||W.attribute!==re||re&&W.data!==re.data)return!0;j++}return s.attributesNum!==j||s.index!==z}function m(M,I,B,z){const V={},q=I.attributes;let j=0;const Q=B.getAttributes();for(const N in Q)if(Q[N].location>=0){let W=q[N];W===void 0&&(N==="instanceMatrix"&&M.instanceMatrix&&(W=M.instanceMatrix),N==="instanceColor"&&M.instanceColor&&(W=M.instanceColor));const re={};re.attribute=W,W&&W.data&&(re.data=W.data),V[N]=re,j++}s.attributes=V,s.attributesNum=j,s.index=z}function _(){const M=s.newAttributes;for(let I=0,B=M.length;I<B;I++)M[I]=0}function g(M){p(M,0)}function p(M,I){const B=s.newAttributes,z=s.enabledAttributes,V=s.attributeDivisors;B[M]=1,z[M]===0&&(r.enableVertexAttribArray(M),z[M]=1),V[M]!==I&&(r.vertexAttribDivisor(M,I),V[M]=I)}function x(){const M=s.newAttributes,I=s.enabledAttributes;for(let B=0,z=I.length;B<z;B++)I[B]!==M[B]&&(r.disableVertexAttribArray(B),I[B]=0)}function y(M,I,B,z,V,q,j){j===!0?r.vertexAttribIPointer(M,I,B,V,q):r.vertexAttribPointer(M,I,B,z,V,q)}function v(M,I,B,z){_();const V=z.attributes,q=B.getAttributes(),j=I.defaultAttributeValues;for(const Q in q){const N=q[Q];if(N.location>=0){let $=V[Q];if($===void 0&&(Q==="instanceMatrix"&&M.instanceMatrix&&($=M.instanceMatrix),Q==="instanceColor"&&M.instanceColor&&($=M.instanceColor)),$!==void 0){const W=$.normalized,re=$.itemSize,me=e.get($);if(me===void 0)continue;const Ue=me.buffer,X=me.type,ee=me.bytesPerElement,le=X===r.INT||X===r.UNSIGNED_INT||$.gpuType===zo;if($.isInterleavedBufferAttribute){const ae=$.data,be=ae.stride,we=$.offset;if(ae.isInstancedInterleavedBuffer){for(let Ie=0;Ie<N.locationSize;Ie++)p(N.location+Ie,ae.meshPerAttribute);M.isInstancedMesh!==!0&&z._maxInstanceCount===void 0&&(z._maxInstanceCount=ae.meshPerAttribute*ae.count)}else for(let Ie=0;Ie<N.locationSize;Ie++)g(N.location+Ie);r.bindBuffer(r.ARRAY_BUFFER,Ue);for(let Ie=0;Ie<N.locationSize;Ie++)y(N.location+Ie,re/N.locationSize,X,W,be*ee,(we+re/N.locationSize*Ie)*ee,le)}else{if($.isInstancedBufferAttribute){for(let ae=0;ae<N.locationSize;ae++)p(N.location+ae,$.meshPerAttribute);M.isInstancedMesh!==!0&&z._maxInstanceCount===void 0&&(z._maxInstanceCount=$.meshPerAttribute*$.count)}else for(let ae=0;ae<N.locationSize;ae++)g(N.location+ae);r.bindBuffer(r.ARRAY_BUFFER,Ue);for(let ae=0;ae<N.locationSize;ae++)y(N.location+ae,re/N.locationSize,X,W,re*ee,re/N.locationSize*ae*ee,le)}}else if(j!==void 0){const W=j[Q];if(W!==void 0)switch(W.length){case 2:r.vertexAttrib2fv(N.location,W);break;case 3:r.vertexAttrib3fv(N.location,W);break;case 4:r.vertexAttrib4fv(N.location,W);break;default:r.vertexAttrib1fv(N.location,W)}}}}x()}function A(){P();for(const M in n){const I=n[M];for(const B in I){const z=I[B];for(const V in z)h(z[V].object),delete z[V];delete I[B]}delete n[M]}}function E(M){if(n[M.id]===void 0)return;const I=n[M.id];for(const B in I){const z=I[B];for(const V in z)h(z[V].object),delete z[V];delete I[B]}delete n[M.id]}function T(M){for(const I in n){const B=n[I];if(B[M.id]===void 0)continue;const z=B[M.id];for(const V in z)h(z[V].object),delete z[V];delete B[M.id]}}function P(){b(),a=!0,s!==i&&(s=i,c(s.object))}function b(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:o,reset:P,resetDefaultState:b,dispose:A,releaseStatesOfGeometry:E,releaseStatesOfProgram:T,initAttributes:_,enableAttribute:g,disableUnusedAttributes:x}}function I0(r,e,t){let n;function i(c){n=c}function s(c,h){r.drawArrays(n,c,h),t.update(h,n,1)}function a(c,h,u){u!==0&&(r.drawArraysInstanced(n,c,h,u),t.update(h,n,u))}function o(c,h,u){if(u===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,c,0,h,0,u);let f=0;for(let m=0;m<u;m++)f+=h[m];t.update(f,n,1)}function l(c,h,u,d){if(u===0)return;const f=e.get("WEBGL_multi_draw");if(f===null)for(let m=0;m<c.length;m++)a(c[m],h[m],d[m]);else{f.multiDrawArraysInstancedWEBGL(n,c,0,h,0,d,0,u);let m=0;for(let _=0;_<u;_++)m+=h[_]*d[_];t.update(m,n,1)}}this.setMode=i,this.render=s,this.renderInstances=a,this.renderMultiDraw=o,this.renderMultiDrawInstances=l}function L0(r,e,t,n){let i;function s(){if(i!==void 0)return i;if(e.has("EXT_texture_filter_anisotropic")===!0){const T=e.get("EXT_texture_filter_anisotropic");i=r.getParameter(T.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function a(T){return!(T!==an&&n.convert(T)!==r.getParameter(r.IMPLEMENTATION_COLOR_READ_FORMAT))}function o(T){const P=T===Os&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(T!==Gn&&n.convert(T)!==r.getParameter(r.IMPLEMENTATION_COLOR_READ_TYPE)&&T!==mn&&!P)}function l(T){if(T==="highp"){if(r.getShaderPrecisionFormat(r.VERTEX_SHADER,r.HIGH_FLOAT).precision>0&&r.getShaderPrecisionFormat(r.FRAGMENT_SHADER,r.HIGH_FLOAT).precision>0)return"highp";T="mediump"}return T==="mediump"&&r.getShaderPrecisionFormat(r.VERTEX_SHADER,r.MEDIUM_FLOAT).precision>0&&r.getShaderPrecisionFormat(r.FRAGMENT_SHADER,r.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let c=t.precision!==void 0?t.precision:"highp";const h=l(c);h!==c&&(console.warn("THREE.WebGLRenderer:",c,"not supported, using",h,"instead."),c=h);const u=t.logarithmicDepthBuffer===!0,d=t.reverseDepthBuffer===!0&&e.has("EXT_clip_control"),f=r.getParameter(r.MAX_TEXTURE_IMAGE_UNITS),m=r.getParameter(r.MAX_VERTEX_TEXTURE_IMAGE_UNITS),_=r.getParameter(r.MAX_TEXTURE_SIZE),g=r.getParameter(r.MAX_CUBE_MAP_TEXTURE_SIZE),p=r.getParameter(r.MAX_VERTEX_ATTRIBS),x=r.getParameter(r.MAX_VERTEX_UNIFORM_VECTORS),y=r.getParameter(r.MAX_VARYING_VECTORS),v=r.getParameter(r.MAX_FRAGMENT_UNIFORM_VECTORS),A=m>0,E=r.getParameter(r.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:s,getMaxPrecision:l,textureFormatReadable:a,textureTypeReadable:o,precision:c,logarithmicDepthBuffer:u,reverseDepthBuffer:d,maxTextures:f,maxVertexTextures:m,maxTextureSize:_,maxCubemapSize:g,maxAttributes:p,maxVertexUniforms:x,maxVaryings:y,maxFragmentUniforms:v,vertexTextures:A,maxSamples:E}}function D0(r){const e=this;let t=null,n=0,i=!1,s=!1;const a=new Jn,o=new Oe,l={value:null,needsUpdate:!1};this.uniform=l,this.numPlanes=0,this.numIntersection=0,this.init=function(u,d){const f=u.length!==0||d||n!==0||i;return i=d,n=u.length,f},this.beginShadows=function(){s=!0,h(null)},this.endShadows=function(){s=!1},this.setGlobalState=function(u,d){t=h(u,d,0)},this.setState=function(u,d,f){const m=u.clippingPlanes,_=u.clipIntersection,g=u.clipShadows,p=r.get(u);if(!i||m===null||m.length===0||s&&!g)s?h(null):c();else{const x=s?0:n,y=x*4;let v=p.clippingState||null;l.value=v,v=h(m,d,y,f);for(let A=0;A!==y;++A)v[A]=t[A];p.clippingState=v,this.numIntersection=_?this.numPlanes:0,this.numPlanes+=x}};function c(){l.value!==t&&(l.value=t,l.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function h(u,d,f,m){const _=u!==null?u.length:0;let g=null;if(_!==0){if(g=l.value,m!==!0||g===null){const p=f+_*4,x=d.matrixWorldInverse;o.getNormalMatrix(x),(g===null||g.length<p)&&(g=new Float32Array(p));for(let y=0,v=f;y!==_;++y,v+=4)a.copy(u[y]).applyMatrix4(x,o),a.normal.toArray(g,v),g[v+3]=a.constant}l.value=g,l.needsUpdate=!0}return e.numPlanes=_,e.numIntersection=0,g}}function N0(r){let e=new WeakMap;function t(a,o){return o===Ka?a.mapping=Yi:o===Ja&&(a.mapping=$i),a}function n(a){if(a&&a.isTexture){const o=a.mapping;if(o===Ka||o===Ja)if(e.has(a)){const l=e.get(a).texture;return t(l,a.mapping)}else{const l=a.image;if(l&&l.height>0){const c=new Hd(l.height);return c.fromEquirectangularTexture(r,a),e.set(a,c),a.addEventListener("dispose",i),t(c.texture,a.mapping)}else return null}}return a}function i(a){const o=a.target;o.removeEventListener("dispose",i);const l=e.get(o);l!==void 0&&(e.delete(o),l.dispose())}function s(){e=new WeakMap}return{get:n,dispose:s}}const zi=4,pc=[.125,.215,.35,.446,.526,.582],mi=20,Ta=new ll,mc=new Te;let Aa=null,Ra=0,Ca=0,Pa=!1;const fi=(1+Math.sqrt(5))/2,ki=1/fi,gc=[new C(-fi,ki,0),new C(fi,ki,0),new C(-ki,0,fi),new C(ki,0,fi),new C(0,fi,-ki),new C(0,fi,ki),new C(-1,1,-1),new C(1,1,-1),new C(-1,1,1),new C(1,1,1)];class _c{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,i=100){Aa=this._renderer.getRenderTarget(),Ra=this._renderer.getActiveCubeFace(),Ca=this._renderer.getActiveMipmapLevel(),Pa=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(256);const s=this._allocateTargets();return s.depthBuffer=!0,this._sceneToCubeUV(e,n,i,s),t>0&&this._blur(s,0,0,t),this._applyPMREM(s),this._cleanup(s),s}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=yc(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=vc(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(Aa,Ra,Ca),this._renderer.xr.enabled=Pa,e.scissorTest=!1,_r(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===Yi||e.mapping===$i?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),Aa=this._renderer.getRenderTarget(),Ra=this._renderer.getActiveCubeFace(),Ca=this._renderer.getActiveMipmapLevel(),Pa=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:Dt,minFilter:Dt,generateMipmaps:!1,type:Os,format:an,colorSpace:qt,depthBuffer:!1},i=xc(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=xc(e,t,n);const{_lodMax:s}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=U0(s)),this._blurMaterial=k0(s,e,t)}return i}_compileMaterial(e){const t=new D(this._lodPlanes[0],e);this._renderer.compile(t,Ta)}_sceneToCubeUV(e,t,n,i){const o=new Bt(90,1,t,n),l=[1,-1,1,1,1,1],c=[1,1,1,-1,-1,-1],h=this._renderer,u=h.autoClear,d=h.toneMapping;h.getClearColor(mc),h.toneMapping=ni,h.autoClear=!1;const f=new ut({name:"PMREM.Background",side:Gt,depthWrite:!1,depthTest:!1}),m=new D(new We,f);let _=!1;const g=e.background;g?g.isColor&&(f.color.copy(g),e.background=null,_=!0):(f.color.copy(mc),_=!0);for(let p=0;p<6;p++){const x=p%3;x===0?(o.up.set(0,l[p],0),o.lookAt(c[p],0,0)):x===1?(o.up.set(0,0,l[p]),o.lookAt(0,c[p],0)):(o.up.set(0,l[p],0),o.lookAt(0,0,c[p]));const y=this._cubeSize;_r(i,x*y,p>2?y:0,y,y),h.setRenderTarget(i),_&&h.render(m,o),h.render(e,o)}m.geometry.dispose(),m.material.dispose(),h.toneMapping=d,h.autoClear=u,e.background=g}_textureToCubeUV(e,t){const n=this._renderer,i=e.mapping===Yi||e.mapping===$i;i?(this._cubemapMaterial===null&&(this._cubemapMaterial=yc()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=vc());const s=i?this._cubemapMaterial:this._equirectMaterial,a=new D(this._lodPlanes[0],s),o=s.uniforms;o.envMap.value=e;const l=this._cubeSize;_r(t,0,0,3*l,2*l),n.setRenderTarget(t),n.render(a,Ta)}_applyPMREM(e){const t=this._renderer,n=t.autoClear;t.autoClear=!1;const i=this._lodPlanes.length;for(let s=1;s<i;s++){const a=Math.sqrt(this._sigmas[s]*this._sigmas[s]-this._sigmas[s-1]*this._sigmas[s-1]),o=gc[(i-s-1)%gc.length];this._blur(e,s-1,s,a,o)}t.autoClear=n}_blur(e,t,n,i,s){const a=this._pingPongRenderTarget;this._halfBlur(e,a,t,n,i,"latitudinal",s),this._halfBlur(a,e,n,n,i,"longitudinal",s)}_halfBlur(e,t,n,i,s,a,o){const l=this._renderer,c=this._blurMaterial;a!=="latitudinal"&&a!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const h=3,u=new D(this._lodPlanes[i],c),d=c.uniforms,f=this._sizeLods[n]-1,m=isFinite(s)?Math.PI/(2*f):2*Math.PI/(2*mi-1),_=s/m,g=isFinite(s)?1+Math.floor(h*_):mi;g>mi&&console.warn(`sigmaRadians, ${s}, is too large and will clip, as it requested ${g} samples when the maximum is set to ${mi}`);const p=[];let x=0;for(let T=0;T<mi;++T){const P=T/_,b=Math.exp(-P*P/2);p.push(b),T===0?x+=b:T<g&&(x+=2*b)}for(let T=0;T<p.length;T++)p[T]=p[T]/x;d.envMap.value=e.texture,d.samples.value=g,d.weights.value=p,d.latitudinal.value=a==="latitudinal",o&&(d.poleAxis.value=o);const{_lodMax:y}=this;d.dTheta.value=m,d.mipInt.value=y-n;const v=this._sizeLods[i],A=3*v*(i>y-zi?i-y+zi:0),E=4*(this._cubeSize-v);_r(t,A,E,3*v,2*v),l.setRenderTarget(t),l.render(u,Ta)}}function U0(r){const e=[],t=[],n=[];let i=r;const s=r-zi+1+pc.length;for(let a=0;a<s;a++){const o=Math.pow(2,i);t.push(o);let l=1/o;a>r-zi?l=pc[a-r+zi-1]:a===0&&(l=0),n.push(l);const c=1/(o-2),h=-c,u=1+c,d=[h,h,u,h,u,u,h,h,u,u,h,u],f=6,m=6,_=3,g=2,p=1,x=new Float32Array(_*m*f),y=new Float32Array(g*m*f),v=new Float32Array(p*m*f);for(let E=0;E<f;E++){const T=E%3*2/3-1,P=E>2?0:-1,b=[T,P,0,T+2/3,P,0,T+2/3,P+1,0,T,P,0,T+2/3,P+1,0,T,P+1,0];x.set(b,_*m*E),y.set(d,g*m*E);const M=[E,E,E,E,E,E];v.set(M,p*m*E)}const A=new Pt;A.setAttribute("position",new Ot(x,_)),A.setAttribute("uv",new Ot(y,g)),A.setAttribute("faceIndex",new Ot(v,p)),e.push(A),i>zi&&i--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function xc(r,e,t){const n=new _i(r,e,t);return n.texture.mapping=qr,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function _r(r,e,t,n,i){r.viewport.set(e,t,n,i),r.scissor.set(e,t,n,i)}function k0(r,e,t){const n=new Float32Array(mi),i=new C(0,1,0);return new Sn({name:"SphericalGaussianBlur",defines:{n:mi,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${r}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:i}},vertexShader:dl(),fragmentShader:`

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
		`,blending:ti,depthTest:!1,depthWrite:!1})}function vc(){return new Sn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:dl(),fragmentShader:`

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
		`,blending:ti,depthTest:!1,depthWrite:!1})}function yc(){return new Sn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:dl(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:ti,depthTest:!1,depthWrite:!1})}function dl(){return`

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
	`}function F0(r){let e=new WeakMap,t=null;function n(o){if(o&&o.isTexture){const l=o.mapping,c=l===Ka||l===Ja,h=l===Yi||l===$i;if(c||h){let u=e.get(o);const d=u!==void 0?u.texture.pmremVersion:0;if(o.isRenderTargetTexture&&o.pmremVersion!==d)return t===null&&(t=new _c(r)),u=c?t.fromEquirectangular(o,u):t.fromCubemap(o,u),u.texture.pmremVersion=o.pmremVersion,e.set(o,u),u.texture;if(u!==void 0)return u.texture;{const f=o.image;return c&&f&&f.height>0||h&&f&&i(f)?(t===null&&(t=new _c(r)),u=c?t.fromEquirectangular(o):t.fromCubemap(o),u.texture.pmremVersion=o.pmremVersion,e.set(o,u),o.addEventListener("dispose",s),u.texture):null}}}return o}function i(o){let l=0;const c=6;for(let h=0;h<c;h++)o[h]!==void 0&&l++;return l===c}function s(o){const l=o.target;l.removeEventListener("dispose",s);const c=e.get(l);c!==void 0&&(e.delete(l),c.dispose())}function a(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:a}}function B0(r){const e={};function t(n){if(e[n]!==void 0)return e[n];let i;switch(n){case"WEBGL_depth_texture":i=r.getExtension("WEBGL_depth_texture")||r.getExtension("MOZ_WEBGL_depth_texture")||r.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":i=r.getExtension("EXT_texture_filter_anisotropic")||r.getExtension("MOZ_EXT_texture_filter_anisotropic")||r.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":i=r.getExtension("WEBGL_compressed_texture_s3tc")||r.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||r.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":i=r.getExtension("WEBGL_compressed_texture_pvrtc")||r.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:i=r.getExtension(n)}return e[n]=i,i}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){const i=t(n);return i===null&&Fi("THREE.WebGLRenderer: "+n+" extension not supported."),i}}}function O0(r,e,t,n){const i={},s=new WeakMap;function a(u){const d=u.target;d.index!==null&&e.remove(d.index);for(const m in d.attributes)e.remove(d.attributes[m]);d.removeEventListener("dispose",a),delete i[d.id];const f=s.get(d);f&&(e.remove(f),s.delete(d)),n.releaseStatesOfGeometry(d),d.isInstancedBufferGeometry===!0&&delete d._maxInstanceCount,t.memory.geometries--}function o(u,d){return i[d.id]===!0||(d.addEventListener("dispose",a),i[d.id]=!0,t.memory.geometries++),d}function l(u){const d=u.attributes;for(const f in d)e.update(d[f],r.ARRAY_BUFFER)}function c(u){const d=[],f=u.index,m=u.attributes.position;let _=0;if(f!==null){const x=f.array;_=f.version;for(let y=0,v=x.length;y<v;y+=3){const A=x[y+0],E=x[y+1],T=x[y+2];d.push(A,E,E,T,T,A)}}else if(m!==void 0){const x=m.array;_=m.version;for(let y=0,v=x.length/3-1;y<v;y+=3){const A=y+0,E=y+1,T=y+2;d.push(A,E,E,T,T,A)}}else return;const g=new(yh(d)?Eh:Sh)(d,1);g.version=_;const p=s.get(u);p&&e.remove(p),s.set(u,g)}function h(u){const d=s.get(u);if(d){const f=u.index;f!==null&&d.version<f.version&&c(u)}else c(u);return s.get(u)}return{get:o,update:l,getWireframeAttribute:h}}function z0(r,e,t){let n;function i(d){n=d}let s,a;function o(d){s=d.type,a=d.bytesPerElement}function l(d,f){r.drawElements(n,f,s,d*a),t.update(f,n,1)}function c(d,f,m){m!==0&&(r.drawElementsInstanced(n,f,s,d*a,m),t.update(f,n,m))}function h(d,f,m){if(m===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,f,0,s,d,0,m);let g=0;for(let p=0;p<m;p++)g+=f[p];t.update(g,n,1)}function u(d,f,m,_){if(m===0)return;const g=e.get("WEBGL_multi_draw");if(g===null)for(let p=0;p<d.length;p++)c(d[p]/a,f[p],_[p]);else{g.multiDrawElementsInstancedWEBGL(n,f,0,s,d,0,_,0,m);let p=0;for(let x=0;x<m;x++)p+=f[x]*_[x];t.update(p,n,1)}}this.setMode=i,this.setIndex=o,this.render=l,this.renderInstances=c,this.renderMultiDraw=h,this.renderMultiDrawInstances=u}function H0(r){const e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(s,a,o){switch(t.calls++,a){case r.TRIANGLES:t.triangles+=o*(s/3);break;case r.LINES:t.lines+=o*(s/2);break;case r.LINE_STRIP:t.lines+=o*(s-1);break;case r.LINE_LOOP:t.lines+=o*s;break;case r.POINTS:t.points+=o*s;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",a);break}}function i(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:i,update:n}}function V0(r,e,t){const n=new WeakMap,i=new tt;function s(a,o,l){const c=a.morphTargetInfluences,h=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=h!==void 0?h.length:0;let d=n.get(o);if(d===void 0||d.count!==u){let M=function(){P.dispose(),n.delete(o),o.removeEventListener("dispose",M)};var f=M;d!==void 0&&d.texture.dispose();const m=o.morphAttributes.position!==void 0,_=o.morphAttributes.normal!==void 0,g=o.morphAttributes.color!==void 0,p=o.morphAttributes.position||[],x=o.morphAttributes.normal||[],y=o.morphAttributes.color||[];let v=0;m===!0&&(v=1),_===!0&&(v=2),g===!0&&(v=3);let A=o.attributes.position.count*v,E=1;A>e.maxTextureSize&&(E=Math.ceil(A/e.maxTextureSize),A=e.maxTextureSize);const T=new Float32Array(A*E*4*u),P=new wh(T,A,E,u);P.type=mn,P.needsUpdate=!0;const b=v*4;for(let I=0;I<u;I++){const B=p[I],z=x[I],V=y[I],q=A*E*4*I;for(let j=0;j<B.count;j++){const Q=j*b;m===!0&&(i.fromBufferAttribute(B,j),T[q+Q+0]=i.x,T[q+Q+1]=i.y,T[q+Q+2]=i.z,T[q+Q+3]=0),_===!0&&(i.fromBufferAttribute(z,j),T[q+Q+4]=i.x,T[q+Q+5]=i.y,T[q+Q+6]=i.z,T[q+Q+7]=0),g===!0&&(i.fromBufferAttribute(V,j),T[q+Q+8]=i.x,T[q+Q+9]=i.y,T[q+Q+10]=i.z,T[q+Q+11]=V.itemSize===4?i.w:1)}}d={count:u,texture:P,size:new pe(A,E)},n.set(o,d),o.addEventListener("dispose",M)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)l.getUniforms().setValue(r,"morphTexture",a.morphTexture,t);else{let m=0;for(let g=0;g<c.length;g++)m+=c[g];const _=o.morphTargetsRelative?1:1-m;l.getUniforms().setValue(r,"morphTargetBaseInfluence",_),l.getUniforms().setValue(r,"morphTargetInfluences",c)}l.getUniforms().setValue(r,"morphTargetsTexture",d.texture,t),l.getUniforms().setValue(r,"morphTargetsTextureSize",d.size)}return{update:s}}function G0(r,e,t,n){let i=new WeakMap;function s(l){const c=n.render.frame,h=l.geometry,u=e.get(l,h);if(i.get(u)!==c&&(e.update(u),i.set(u,c)),l.isInstancedMesh&&(l.hasEventListener("dispose",o)===!1&&l.addEventListener("dispose",o),i.get(l)!==c&&(t.update(l.instanceMatrix,r.ARRAY_BUFFER),l.instanceColor!==null&&t.update(l.instanceColor,r.ARRAY_BUFFER),i.set(l,c))),l.isSkinnedMesh){const d=l.skeleton;i.get(d)!==c&&(d.update(),i.set(d,c))}return u}function a(){i=new WeakMap}function o(l){const c=l.target;c.removeEventListener("dispose",o),t.remove(c.instanceMatrix),c.instanceColor!==null&&t.remove(c.instanceColor)}return{update:s,dispose:a}}const Xh=new bt,Mc=new Nh(1,1),qh=new wh,Yh=new Ed,$h=new Rh,wc=[],bc=[],Sc=new Float32Array(16),Ec=new Float32Array(9),Tc=new Float32Array(4);function ls(r,e,t){const n=r[0];if(n<=0||n>0)return r;const i=e*t;let s=wc[i];if(s===void 0&&(s=new Float32Array(i),wc[i]=s),e!==0){n.toArray(s,0);for(let a=1,o=0;a!==e;++a)o+=t,r[a].toArray(s,o)}return s}function St(r,e){if(r.length!==e.length)return!1;for(let t=0,n=r.length;t<n;t++)if(r[t]!==e[t])return!1;return!0}function Et(r,e){for(let t=0,n=e.length;t<n;t++)r[t]=e[t]}function Yr(r,e){let t=bc[e];t===void 0&&(t=new Int32Array(e),bc[e]=t);for(let n=0;n!==e;++n)t[n]=r.allocateTextureUnit();return t}function W0(r,e){const t=this.cache;t[0]!==e&&(r.uniform1f(this.addr,e),t[0]=e)}function X0(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(r.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(St(t,e))return;r.uniform2fv(this.addr,e),Et(t,e)}}function q0(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(r.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(r.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(St(t,e))return;r.uniform3fv(this.addr,e),Et(t,e)}}function Y0(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(r.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(St(t,e))return;r.uniform4fv(this.addr,e),Et(t,e)}}function $0(r,e){const t=this.cache,n=e.elements;if(n===void 0){if(St(t,e))return;r.uniformMatrix2fv(this.addr,!1,e),Et(t,e)}else{if(St(t,n))return;Tc.set(n),r.uniformMatrix2fv(this.addr,!1,Tc),Et(t,n)}}function j0(r,e){const t=this.cache,n=e.elements;if(n===void 0){if(St(t,e))return;r.uniformMatrix3fv(this.addr,!1,e),Et(t,e)}else{if(St(t,n))return;Ec.set(n),r.uniformMatrix3fv(this.addr,!1,Ec),Et(t,n)}}function K0(r,e){const t=this.cache,n=e.elements;if(n===void 0){if(St(t,e))return;r.uniformMatrix4fv(this.addr,!1,e),Et(t,e)}else{if(St(t,n))return;Sc.set(n),r.uniformMatrix4fv(this.addr,!1,Sc),Et(t,n)}}function J0(r,e){const t=this.cache;t[0]!==e&&(r.uniform1i(this.addr,e),t[0]=e)}function Z0(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(r.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(St(t,e))return;r.uniform2iv(this.addr,e),Et(t,e)}}function Q0(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(r.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(St(t,e))return;r.uniform3iv(this.addr,e),Et(t,e)}}function eg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(r.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(St(t,e))return;r.uniform4iv(this.addr,e),Et(t,e)}}function tg(r,e){const t=this.cache;t[0]!==e&&(r.uniform1ui(this.addr,e),t[0]=e)}function ng(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(r.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(St(t,e))return;r.uniform2uiv(this.addr,e),Et(t,e)}}function ig(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(r.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(St(t,e))return;r.uniform3uiv(this.addr,e),Et(t,e)}}function sg(r,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(r.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(St(t,e))return;r.uniform4uiv(this.addr,e),Et(t,e)}}function rg(r,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i);let s;this.type===r.SAMPLER_2D_SHADOW?(Mc.compareFunction=vh,s=Mc):s=Xh,t.setTexture2D(e||s,i)}function ag(r,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i),t.setTexture3D(e||Yh,i)}function og(r,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i),t.setTextureCube(e||$h,i)}function lg(r,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(r.uniform1i(this.addr,i),n[0]=i),t.setTexture2DArray(e||qh,i)}function cg(r){switch(r){case 5126:return W0;case 35664:return X0;case 35665:return q0;case 35666:return Y0;case 35674:return $0;case 35675:return j0;case 35676:return K0;case 5124:case 35670:return J0;case 35667:case 35671:return Z0;case 35668:case 35672:return Q0;case 35669:case 35673:return eg;case 5125:return tg;case 36294:return ng;case 36295:return ig;case 36296:return sg;case 35678:case 36198:case 36298:case 36306:case 35682:return rg;case 35679:case 36299:case 36307:return ag;case 35680:case 36300:case 36308:case 36293:return og;case 36289:case 36303:case 36311:case 36292:return lg}}function hg(r,e){r.uniform1fv(this.addr,e)}function ug(r,e){const t=ls(e,this.size,2);r.uniform2fv(this.addr,t)}function dg(r,e){const t=ls(e,this.size,3);r.uniform3fv(this.addr,t)}function fg(r,e){const t=ls(e,this.size,4);r.uniform4fv(this.addr,t)}function pg(r,e){const t=ls(e,this.size,4);r.uniformMatrix2fv(this.addr,!1,t)}function mg(r,e){const t=ls(e,this.size,9);r.uniformMatrix3fv(this.addr,!1,t)}function gg(r,e){const t=ls(e,this.size,16);r.uniformMatrix4fv(this.addr,!1,t)}function _g(r,e){r.uniform1iv(this.addr,e)}function xg(r,e){r.uniform2iv(this.addr,e)}function vg(r,e){r.uniform3iv(this.addr,e)}function yg(r,e){r.uniform4iv(this.addr,e)}function Mg(r,e){r.uniform1uiv(this.addr,e)}function wg(r,e){r.uniform2uiv(this.addr,e)}function bg(r,e){r.uniform3uiv(this.addr,e)}function Sg(r,e){r.uniform4uiv(this.addr,e)}function Eg(r,e,t){const n=this.cache,i=e.length,s=Yr(t,i);St(n,s)||(r.uniform1iv(this.addr,s),Et(n,s));for(let a=0;a!==i;++a)t.setTexture2D(e[a]||Xh,s[a])}function Tg(r,e,t){const n=this.cache,i=e.length,s=Yr(t,i);St(n,s)||(r.uniform1iv(this.addr,s),Et(n,s));for(let a=0;a!==i;++a)t.setTexture3D(e[a]||Yh,s[a])}function Ag(r,e,t){const n=this.cache,i=e.length,s=Yr(t,i);St(n,s)||(r.uniform1iv(this.addr,s),Et(n,s));for(let a=0;a!==i;++a)t.setTextureCube(e[a]||$h,s[a])}function Rg(r,e,t){const n=this.cache,i=e.length,s=Yr(t,i);St(n,s)||(r.uniform1iv(this.addr,s),Et(n,s));for(let a=0;a!==i;++a)t.setTexture2DArray(e[a]||qh,s[a])}function Cg(r){switch(r){case 5126:return hg;case 35664:return ug;case 35665:return dg;case 35666:return fg;case 35674:return pg;case 35675:return mg;case 35676:return gg;case 5124:case 35670:return _g;case 35667:case 35671:return xg;case 35668:case 35672:return vg;case 35669:case 35673:return yg;case 5125:return Mg;case 36294:return wg;case 36295:return bg;case 36296:return Sg;case 35678:case 36198:case 36298:case 36306:case 35682:return Eg;case 35679:case 36299:case 36307:return Tg;case 35680:case 36300:case 36308:case 36293:return Ag;case 36289:case 36303:case 36311:case 36292:return Rg}}class Pg{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=cg(t.type)}}class Ig{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Cg(t.type)}}class Lg{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){const i=this.seq;for(let s=0,a=i.length;s!==a;++s){const o=i[s];o.setValue(e,t[o.id],n)}}}const Ia=/(\w+)(\])?(\[|\.)?/g;function Ac(r,e){r.seq.push(e),r.map[e.id]=e}function Dg(r,e,t){const n=r.name,i=n.length;for(Ia.lastIndex=0;;){const s=Ia.exec(n),a=Ia.lastIndex;let o=s[1];const l=s[2]==="]",c=s[3];if(l&&(o=o|0),c===void 0||c==="["&&a+2===i){Ac(t,c===void 0?new Pg(o,r,e):new Ig(o,r,e));break}else{let u=t.map[o];u===void 0&&(u=new Lg(o),Ac(t,u)),t=u}}}class Pr{constructor(e,t){this.seq=[],this.map={};const n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let i=0;i<n;++i){const s=e.getActiveUniform(t,i),a=e.getUniformLocation(t,s.name);Dg(s,a,this)}}setValue(e,t,n,i){const s=this.map[t];s!==void 0&&s.setValue(e,n,i)}setOptional(e,t,n){const i=t[n];i!==void 0&&this.setValue(e,n,i)}static upload(e,t,n,i){for(let s=0,a=t.length;s!==a;++s){const o=t[s],l=n[o.id];l.needsUpdate!==!1&&o.setValue(e,l.value,i)}}static seqWithValue(e,t){const n=[];for(let i=0,s=e.length;i!==s;++i){const a=e[i];a.id in t&&n.push(a)}return n}}function Rc(r,e,t){const n=r.createShader(e);return r.shaderSource(n,t),r.compileShader(n),n}const Ng=37297;let Ug=0;function kg(r,e){const t=r.split(`
`),n=[],i=Math.max(e-6,0),s=Math.min(e+6,t.length);for(let a=i;a<s;a++){const o=a+1;n.push(`${o===e?">":" "} ${o}: ${t[a]}`)}return n.join(`
`)}const Cc=new Oe;function Fg(r){Je._getMatrix(Cc,Je.workingColorSpace,r);const e=`mat3( ${Cc.elements.map(t=>t.toFixed(4))} )`;switch(Je.getTransfer(r)){case kr:return[e,"LinearTransferOETF"];case lt:return[e,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",r),[e,"LinearTransferOETF"]}}function Pc(r,e,t){const n=r.getShaderParameter(e,r.COMPILE_STATUS),i=r.getShaderInfoLog(e).trim();if(n&&i==="")return"";const s=/ERROR: 0:(\d+)/.exec(i);if(s){const a=parseInt(s[1]);return t.toUpperCase()+`

`+i+`

`+kg(r.getShaderSource(e),a)}else return i}function Bg(r,e){const t=Fg(e);return[`vec4 ${r}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}function Og(r,e){let t;switch(e){case Lu:t="Linear";break;case Du:t="Reinhard";break;case Nu:t="Cineon";break;case sh:t="ACESFilmic";break;case ku:t="AgX";break;case Fu:t="Neutral";break;case Uu:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+r+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}const xr=new C;function zg(){Je.getLuminanceCoefficients(xr);const r=xr.x.toFixed(4),e=xr.y.toFixed(4),t=xr.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${r}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function Hg(r){return[r.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",r.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(Es).join(`
`)}function Vg(r){const e=[];for(const t in r){const n=r[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function Gg(r,e){const t={},n=r.getProgramParameter(e,r.ACTIVE_ATTRIBUTES);for(let i=0;i<n;i++){const s=r.getActiveAttrib(e,i),a=s.name;let o=1;s.type===r.FLOAT_MAT2&&(o=2),s.type===r.FLOAT_MAT3&&(o=3),s.type===r.FLOAT_MAT4&&(o=4),t[a]={type:s.type,location:r.getAttribLocation(e,a),locationSize:o}}return t}function Es(r){return r!==""}function Ic(r,e){const t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return r.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function Lc(r,e){return r.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}const Wg=/^[ \t]*#include +<([\w\d./]+)>/gm;function Io(r){return r.replace(Wg,qg)}const Xg=new Map;function qg(r,e){let t=He[e];if(t===void 0){const n=Xg.get(e);if(n!==void 0)t=He[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return Io(t)}const Yg=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Dc(r){return r.replace(Yg,$g)}function $g(r,e,t,n){let i="";for(let s=parseInt(e);s<parseInt(t);s++)i+=n.replace(/\[\s*i\s*\]/g,"[ "+s+" ]").replace(/UNROLLED_LOOP_INDEX/g,s);return i}function Nc(r){let e=`precision ${r.precision} float;
	precision ${r.precision} int;
	precision ${r.precision} sampler2D;
	precision ${r.precision} samplerCube;
	precision ${r.precision} sampler3D;
	precision ${r.precision} sampler2DArray;
	precision ${r.precision} sampler2DShadow;
	precision ${r.precision} samplerCubeShadow;
	precision ${r.precision} sampler2DArrayShadow;
	precision ${r.precision} isampler2D;
	precision ${r.precision} isampler3D;
	precision ${r.precision} isamplerCube;
	precision ${r.precision} isampler2DArray;
	precision ${r.precision} usampler2D;
	precision ${r.precision} usampler3D;
	precision ${r.precision} usamplerCube;
	precision ${r.precision} usampler2DArray;
	`;return r.precision==="highp"?e+=`
#define HIGH_PRECISION`:r.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:r.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function jg(r){let e="SHADOWMAP_TYPE_BASIC";return r.shadowMapType===th?e="SHADOWMAP_TYPE_PCF":r.shadowMapType===nh?e="SHADOWMAP_TYPE_PCF_SOFT":r.shadowMapType===Fn&&(e="SHADOWMAP_TYPE_VSM"),e}function Kg(r){let e="ENVMAP_TYPE_CUBE";if(r.envMap)switch(r.envMapMode){case Yi:case $i:e="ENVMAP_TYPE_CUBE";break;case qr:e="ENVMAP_TYPE_CUBE_UV";break}return e}function Jg(r){let e="ENVMAP_MODE_REFLECTION";if(r.envMap)switch(r.envMapMode){case $i:e="ENVMAP_MODE_REFRACTION";break}return e}function Zg(r){let e="ENVMAP_BLENDING_NONE";if(r.envMap)switch(r.combine){case ih:e="ENVMAP_BLENDING_MULTIPLY";break;case Pu:e="ENVMAP_BLENDING_MIX";break;case Iu:e="ENVMAP_BLENDING_ADD";break}return e}function Qg(r){const e=r.envMapCubeUVHeight;if(e===null)return null;const t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),112)),texelHeight:n,maxMip:t}}function e_(r,e,t,n){const i=r.getContext(),s=t.defines;let a=t.vertexShader,o=t.fragmentShader;const l=jg(t),c=Kg(t),h=Jg(t),u=Zg(t),d=Qg(t),f=Hg(t),m=Vg(s),_=i.createProgram();let g,p,x=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(g=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m].filter(Es).join(`
`),g.length>0&&(g+=`
`),p=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m].filter(Es).join(`
`),p.length>0&&(p+=`
`)):(g=[Nc(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+h:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(Es).join(`
`),p=[Nc(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+c:"",t.envMap?"#define "+h:"",t.envMap?"#define "+u:"",d?"#define CUBEUV_TEXEL_WIDTH "+d.texelWidth:"",d?"#define CUBEUV_TEXEL_HEIGHT "+d.texelHeight:"",d?"#define CUBEUV_MAX_MIP "+d.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor||t.batchingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+l:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGDEPTHBUF":"",t.reverseDepthBuffer?"#define USE_REVERSEDEPTHBUF":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==ni?"#define TONE_MAPPING":"",t.toneMapping!==ni?He.tonemapping_pars_fragment:"",t.toneMapping!==ni?Og("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",He.colorspace_pars_fragment,Bg("linearToOutputTexel",t.outputColorSpace),zg(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(Es).join(`
`)),a=Io(a),a=Ic(a,t),a=Lc(a,t),o=Io(o),o=Ic(o,t),o=Lc(o,t),a=Dc(a),o=Dc(o),t.isRawShaderMaterial!==!0&&(x=`#version 300 es
`,g=[f,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+g,p=["#define varying in",t.glslVersion===El?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===El?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+p);const y=x+g+a,v=x+p+o,A=Rc(i,i.VERTEX_SHADER,y),E=Rc(i,i.FRAGMENT_SHADER,v);i.attachShader(_,A),i.attachShader(_,E),t.index0AttributeName!==void 0?i.bindAttribLocation(_,0,t.index0AttributeName):t.morphTargets===!0&&i.bindAttribLocation(_,0,"position"),i.linkProgram(_);function T(I){if(r.debug.checkShaderErrors){const B=i.getProgramInfoLog(_).trim(),z=i.getShaderInfoLog(A).trim(),V=i.getShaderInfoLog(E).trim();let q=!0,j=!0;if(i.getProgramParameter(_,i.LINK_STATUS)===!1)if(q=!1,typeof r.debug.onShaderError=="function")r.debug.onShaderError(i,_,A,E);else{const Q=Pc(i,A,"vertex"),N=Pc(i,E,"fragment");console.error("THREE.WebGLProgram: Shader Error "+i.getError()+" - VALIDATE_STATUS "+i.getProgramParameter(_,i.VALIDATE_STATUS)+`

Material Name: `+I.name+`
Material Type: `+I.type+`

Program Info Log: `+B+`
`+Q+`
`+N)}else B!==""?console.warn("THREE.WebGLProgram: Program Info Log:",B):(z===""||V==="")&&(j=!1);j&&(I.diagnostics={runnable:q,programLog:B,vertexShader:{log:z,prefix:g},fragmentShader:{log:V,prefix:p}})}i.deleteShader(A),i.deleteShader(E),P=new Pr(i,_),b=Gg(i,_)}let P;this.getUniforms=function(){return P===void 0&&T(this),P};let b;this.getAttributes=function(){return b===void 0&&T(this),b};let M=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return M===!1&&(M=i.getProgramParameter(_,Ng)),M},this.destroy=function(){n.releaseStatesOfProgram(this),i.deleteProgram(_),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=Ug++,this.cacheKey=e,this.usedTimes=1,this.program=_,this.vertexShader=A,this.fragmentShader=E,this}let t_=0;class n_{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){const t=e.vertexShader,n=e.fragmentShader,i=this._getShaderStage(t),s=this._getShaderStage(n),a=this._getShaderCacheForMaterial(e);return a.has(i)===!1&&(a.add(i),i.usedTimes++),a.has(s)===!1&&(a.add(s),s.usedTimes++),this}remove(e){const t=this.materialCache.get(e);for(const n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){const t=this.materialCache;let n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){const t=this.shaderCache;let n=t.get(e);return n===void 0&&(n=new i_(e),t.set(e,n)),n}}class i_{constructor(e){this.id=t_++,this.code=e,this.usedTimes=0}}function s_(r,e,t,n,i,s,a){const o=new jo,l=new n_,c=new Set,h=[],u=i.logarithmicDepthBuffer,d=i.vertexTextures;let f=i.precision;const m={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function _(b){return c.add(b),b===0?"uv":`uv${b}`}function g(b,M,I,B,z){const V=B.fog,q=z.geometry,j=b.isMeshStandardMaterial?B.environment:null,Q=(b.isMeshStandardMaterial?t:e).get(b.envMap||j),N=Q&&Q.mapping===qr?Q.image.height:null,$=m[b.type];b.precision!==null&&(f=i.getMaxPrecision(b.precision),f!==b.precision&&console.warn("THREE.WebGLProgram.getParameters:",b.precision,"not supported, using",f,"instead."));const W=q.morphAttributes.position||q.morphAttributes.normal||q.morphAttributes.color,re=W!==void 0?W.length:0;let me=0;q.morphAttributes.position!==void 0&&(me=1),q.morphAttributes.normal!==void 0&&(me=2),q.morphAttributes.color!==void 0&&(me=3);let Ue,X,ee,le;if($){const at=vn[$];Ue=at.vertexShader,X=at.fragmentShader}else Ue=b.vertexShader,X=b.fragmentShader,l.update(b),ee=l.getVertexShaderID(b),le=l.getFragmentShaderID(b);const ae=r.getRenderTarget(),be=r.state.buffers.depth.getReversed(),we=z.isInstancedMesh===!0,Ie=z.isBatchedMesh===!0,$e=!!b.map,Xe=!!b.matcap,pt=!!Q,L=!!b.aoMap,Nt=!!b.lightMap,qe=!!b.bumpMap,je=!!b.normalMap,Ae=!!b.displacementMap,dt=!!b.emissiveMap,Ee=!!b.metalnessMap,R=!!b.roughnessMap,w=b.anisotropy>0,O=b.clearcoat>0,J=b.dispersion>0,te=b.iridescence>0,K=b.sheen>0,Se=b.transmission>0,ue=w&&!!b.anisotropyMap,xe=O&&!!b.clearcoatMap,Ze=O&&!!b.clearcoatNormalMap,se=O&&!!b.clearcoatRoughnessMap,ve=te&&!!b.iridescenceMap,Pe=te&&!!b.iridescenceThicknessMap,De=K&&!!b.sheenColorMap,ye=K&&!!b.sheenRoughnessMap,Ke=!!b.specularMap,ze=!!b.specularColorMap,ct=!!b.specularIntensityMap,U=Se&&!!b.transmissionMap,ce=Se&&!!b.thicknessMap,Y=!!b.gradientMap,Z=!!b.alphaMap,fe=b.alphaTest>0,de=!!b.alphaHash,Be=!!b.extensions;let _t=ni;b.toneMapped&&(ae===null||ae.isXRRenderTarget===!0)&&(_t=r.toneMapping);const Ut={shaderID:$,shaderType:b.type,shaderName:b.name,vertexShader:Ue,fragmentShader:X,defines:b.defines,customVertexShaderID:ee,customFragmentShaderID:le,isRawShaderMaterial:b.isRawShaderMaterial===!0,glslVersion:b.glslVersion,precision:f,batching:Ie,batchingColor:Ie&&z._colorsTexture!==null,instancing:we,instancingColor:we&&z.instanceColor!==null,instancingMorph:we&&z.morphTexture!==null,supportsVertexTextures:d,outputColorSpace:ae===null?r.outputColorSpace:ae.isXRRenderTarget===!0?ae.texture.colorSpace:qt,alphaToCoverage:!!b.alphaToCoverage,map:$e,matcap:Xe,envMap:pt,envMapMode:pt&&Q.mapping,envMapCubeUVHeight:N,aoMap:L,lightMap:Nt,bumpMap:qe,normalMap:je,displacementMap:d&&Ae,emissiveMap:dt,normalMapObjectSpace:je&&b.normalMapType===Xu,normalMapTangentSpace:je&&b.normalMapType===xh,metalnessMap:Ee,roughnessMap:R,anisotropy:w,anisotropyMap:ue,clearcoat:O,clearcoatMap:xe,clearcoatNormalMap:Ze,clearcoatRoughnessMap:se,dispersion:J,iridescence:te,iridescenceMap:ve,iridescenceThicknessMap:Pe,sheen:K,sheenColorMap:De,sheenRoughnessMap:ye,specularMap:Ke,specularColorMap:ze,specularIntensityMap:ct,transmission:Se,transmissionMap:U,thicknessMap:ce,gradientMap:Y,opaque:b.transparent===!1&&b.blending===Hi&&b.alphaToCoverage===!1,alphaMap:Z,alphaTest:fe,alphaHash:de,combine:b.combine,mapUv:$e&&_(b.map.channel),aoMapUv:L&&_(b.aoMap.channel),lightMapUv:Nt&&_(b.lightMap.channel),bumpMapUv:qe&&_(b.bumpMap.channel),normalMapUv:je&&_(b.normalMap.channel),displacementMapUv:Ae&&_(b.displacementMap.channel),emissiveMapUv:dt&&_(b.emissiveMap.channel),metalnessMapUv:Ee&&_(b.metalnessMap.channel),roughnessMapUv:R&&_(b.roughnessMap.channel),anisotropyMapUv:ue&&_(b.anisotropyMap.channel),clearcoatMapUv:xe&&_(b.clearcoatMap.channel),clearcoatNormalMapUv:Ze&&_(b.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:se&&_(b.clearcoatRoughnessMap.channel),iridescenceMapUv:ve&&_(b.iridescenceMap.channel),iridescenceThicknessMapUv:Pe&&_(b.iridescenceThicknessMap.channel),sheenColorMapUv:De&&_(b.sheenColorMap.channel),sheenRoughnessMapUv:ye&&_(b.sheenRoughnessMap.channel),specularMapUv:Ke&&_(b.specularMap.channel),specularColorMapUv:ze&&_(b.specularColorMap.channel),specularIntensityMapUv:ct&&_(b.specularIntensityMap.channel),transmissionMapUv:U&&_(b.transmissionMap.channel),thicknessMapUv:ce&&_(b.thicknessMap.channel),alphaMapUv:Z&&_(b.alphaMap.channel),vertexTangents:!!q.attributes.tangent&&(je||w),vertexColors:b.vertexColors,vertexAlphas:b.vertexColors===!0&&!!q.attributes.color&&q.attributes.color.itemSize===4,pointsUvs:z.isPoints===!0&&!!q.attributes.uv&&($e||Z),fog:!!V,useFog:b.fog===!0,fogExp2:!!V&&V.isFogExp2,flatShading:b.flatShading===!0,sizeAttenuation:b.sizeAttenuation===!0,logarithmicDepthBuffer:u,reverseDepthBuffer:be,skinning:z.isSkinnedMesh===!0,morphTargets:q.morphAttributes.position!==void 0,morphNormals:q.morphAttributes.normal!==void 0,morphColors:q.morphAttributes.color!==void 0,morphTargetsCount:re,morphTextureStride:me,numDirLights:M.directional.length,numPointLights:M.point.length,numSpotLights:M.spot.length,numSpotLightMaps:M.spotLightMap.length,numRectAreaLights:M.rectArea.length,numHemiLights:M.hemi.length,numDirLightShadows:M.directionalShadowMap.length,numPointLightShadows:M.pointShadowMap.length,numSpotLightShadows:M.spotShadowMap.length,numSpotLightShadowsWithMaps:M.numSpotLightShadowsWithMaps,numLightProbes:M.numLightProbes,numClippingPlanes:a.numPlanes,numClipIntersection:a.numIntersection,dithering:b.dithering,shadowMapEnabled:r.shadowMap.enabled&&I.length>0,shadowMapType:r.shadowMap.type,toneMapping:_t,decodeVideoTexture:$e&&b.map.isVideoTexture===!0&&Je.getTransfer(b.map.colorSpace)===lt,decodeVideoTextureEmissive:dt&&b.emissiveMap.isVideoTexture===!0&&Je.getTransfer(b.emissiveMap.colorSpace)===lt,premultipliedAlpha:b.premultipliedAlpha,doubleSided:b.side===rn,flipSided:b.side===Gt,useDepthPacking:b.depthPacking>=0,depthPacking:b.depthPacking||0,index0AttributeName:b.index0AttributeName,extensionClipCullDistance:Be&&b.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Be&&b.extensions.multiDraw===!0||Ie)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:b.customProgramCacheKey()};return Ut.vertexUv1s=c.has(1),Ut.vertexUv2s=c.has(2),Ut.vertexUv3s=c.has(3),c.clear(),Ut}function p(b){const M=[];if(b.shaderID?M.push(b.shaderID):(M.push(b.customVertexShaderID),M.push(b.customFragmentShaderID)),b.defines!==void 0)for(const I in b.defines)M.push(I),M.push(b.defines[I]);return b.isRawShaderMaterial===!1&&(x(M,b),y(M,b),M.push(r.outputColorSpace)),M.push(b.customProgramCacheKey),M.join()}function x(b,M){b.push(M.precision),b.push(M.outputColorSpace),b.push(M.envMapMode),b.push(M.envMapCubeUVHeight),b.push(M.mapUv),b.push(M.alphaMapUv),b.push(M.lightMapUv),b.push(M.aoMapUv),b.push(M.bumpMapUv),b.push(M.normalMapUv),b.push(M.displacementMapUv),b.push(M.emissiveMapUv),b.push(M.metalnessMapUv),b.push(M.roughnessMapUv),b.push(M.anisotropyMapUv),b.push(M.clearcoatMapUv),b.push(M.clearcoatNormalMapUv),b.push(M.clearcoatRoughnessMapUv),b.push(M.iridescenceMapUv),b.push(M.iridescenceThicknessMapUv),b.push(M.sheenColorMapUv),b.push(M.sheenRoughnessMapUv),b.push(M.specularMapUv),b.push(M.specularColorMapUv),b.push(M.specularIntensityMapUv),b.push(M.transmissionMapUv),b.push(M.thicknessMapUv),b.push(M.combine),b.push(M.fogExp2),b.push(M.sizeAttenuation),b.push(M.morphTargetsCount),b.push(M.morphAttributeCount),b.push(M.numDirLights),b.push(M.numPointLights),b.push(M.numSpotLights),b.push(M.numSpotLightMaps),b.push(M.numHemiLights),b.push(M.numRectAreaLights),b.push(M.numDirLightShadows),b.push(M.numPointLightShadows),b.push(M.numSpotLightShadows),b.push(M.numSpotLightShadowsWithMaps),b.push(M.numLightProbes),b.push(M.shadowMapType),b.push(M.toneMapping),b.push(M.numClippingPlanes),b.push(M.numClipIntersection),b.push(M.depthPacking)}function y(b,M){o.disableAll(),M.supportsVertexTextures&&o.enable(0),M.instancing&&o.enable(1),M.instancingColor&&o.enable(2),M.instancingMorph&&o.enable(3),M.matcap&&o.enable(4),M.envMap&&o.enable(5),M.normalMapObjectSpace&&o.enable(6),M.normalMapTangentSpace&&o.enable(7),M.clearcoat&&o.enable(8),M.iridescence&&o.enable(9),M.alphaTest&&o.enable(10),M.vertexColors&&o.enable(11),M.vertexAlphas&&o.enable(12),M.vertexUv1s&&o.enable(13),M.vertexUv2s&&o.enable(14),M.vertexUv3s&&o.enable(15),M.vertexTangents&&o.enable(16),M.anisotropy&&o.enable(17),M.alphaHash&&o.enable(18),M.batching&&o.enable(19),M.dispersion&&o.enable(20),M.batchingColor&&o.enable(21),b.push(o.mask),o.disableAll(),M.fog&&o.enable(0),M.useFog&&o.enable(1),M.flatShading&&o.enable(2),M.logarithmicDepthBuffer&&o.enable(3),M.reverseDepthBuffer&&o.enable(4),M.skinning&&o.enable(5),M.morphTargets&&o.enable(6),M.morphNormals&&o.enable(7),M.morphColors&&o.enable(8),M.premultipliedAlpha&&o.enable(9),M.shadowMapEnabled&&o.enable(10),M.doubleSided&&o.enable(11),M.flipSided&&o.enable(12),M.useDepthPacking&&o.enable(13),M.dithering&&o.enable(14),M.transmission&&o.enable(15),M.sheen&&o.enable(16),M.opaque&&o.enable(17),M.pointsUvs&&o.enable(18),M.decodeVideoTexture&&o.enable(19),M.decodeVideoTextureEmissive&&o.enable(20),M.alphaToCoverage&&o.enable(21),b.push(o.mask)}function v(b){const M=m[b.type];let I;if(M){const B=vn[M];I=Fd.clone(B.uniforms)}else I=b.uniforms;return I}function A(b,M){let I;for(let B=0,z=h.length;B<z;B++){const V=h[B];if(V.cacheKey===M){I=V,++I.usedTimes;break}}return I===void 0&&(I=new e_(r,M,b,s),h.push(I)),I}function E(b){if(--b.usedTimes===0){const M=h.indexOf(b);h[M]=h[h.length-1],h.pop(),b.destroy()}}function T(b){l.remove(b)}function P(){l.dispose()}return{getParameters:g,getProgramCacheKey:p,getUniforms:v,acquireProgram:A,releaseProgram:E,releaseShaderCache:T,programs:h,dispose:P}}function r_(){let r=new WeakMap;function e(a){return r.has(a)}function t(a){let o=r.get(a);return o===void 0&&(o={},r.set(a,o)),o}function n(a){r.delete(a)}function i(a,o,l){r.get(a)[o]=l}function s(){r=new WeakMap}return{has:e,get:t,remove:n,update:i,dispose:s}}function a_(r,e){return r.groupOrder!==e.groupOrder?r.groupOrder-e.groupOrder:r.renderOrder!==e.renderOrder?r.renderOrder-e.renderOrder:r.material.id!==e.material.id?r.material.id-e.material.id:r.z!==e.z?r.z-e.z:r.id-e.id}function Uc(r,e){return r.groupOrder!==e.groupOrder?r.groupOrder-e.groupOrder:r.renderOrder!==e.renderOrder?r.renderOrder-e.renderOrder:r.z!==e.z?e.z-r.z:r.id-e.id}function kc(){const r=[];let e=0;const t=[],n=[],i=[];function s(){e=0,t.length=0,n.length=0,i.length=0}function a(u,d,f,m,_,g){let p=r[e];return p===void 0?(p={id:u.id,object:u,geometry:d,material:f,groupOrder:m,renderOrder:u.renderOrder,z:_,group:g},r[e]=p):(p.id=u.id,p.object=u,p.geometry=d,p.material=f,p.groupOrder=m,p.renderOrder=u.renderOrder,p.z=_,p.group=g),e++,p}function o(u,d,f,m,_,g){const p=a(u,d,f,m,_,g);f.transmission>0?n.push(p):f.transparent===!0?i.push(p):t.push(p)}function l(u,d,f,m,_,g){const p=a(u,d,f,m,_,g);f.transmission>0?n.unshift(p):f.transparent===!0?i.unshift(p):t.unshift(p)}function c(u,d){t.length>1&&t.sort(u||a_),n.length>1&&n.sort(d||Uc),i.length>1&&i.sort(d||Uc)}function h(){for(let u=e,d=r.length;u<d;u++){const f=r[u];if(f.id===null)break;f.id=null,f.object=null,f.geometry=null,f.material=null,f.group=null}}return{opaque:t,transmissive:n,transparent:i,init:s,push:o,unshift:l,finish:h,sort:c}}function o_(){let r=new WeakMap;function e(n,i){const s=r.get(n);let a;return s===void 0?(a=new kc,r.set(n,[a])):i>=s.length?(a=new kc,s.push(a)):a=s[i],a}function t(){r=new WeakMap}return{get:e,dispose:t}}function l_(){const r={};return{get:function(e){if(r[e.id]!==void 0)return r[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new C,color:new Te};break;case"SpotLight":t={position:new C,direction:new C,color:new Te,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new C,color:new Te,distance:0,decay:0};break;case"HemisphereLight":t={direction:new C,skyColor:new Te,groundColor:new Te};break;case"RectAreaLight":t={color:new Te,position:new C,halfWidth:new C,halfHeight:new C};break}return r[e.id]=t,t}}}function c_(){const r={};return{get:function(e){if(r[e.id]!==void 0)return r[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new pe};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new pe};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new pe,shadowCameraNear:1,shadowCameraFar:1e3};break}return r[e.id]=t,t}}}let h_=0;function u_(r,e){return(e.castShadow?2:0)-(r.castShadow?2:0)+(e.map?1:0)-(r.map?1:0)}function d_(r){const e=new l_,t=c_(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let c=0;c<9;c++)n.probe.push(new C);const i=new C,s=new Fe,a=new Fe;function o(c){let h=0,u=0,d=0;for(let b=0;b<9;b++)n.probe[b].set(0,0,0);let f=0,m=0,_=0,g=0,p=0,x=0,y=0,v=0,A=0,E=0,T=0;c.sort(u_);for(let b=0,M=c.length;b<M;b++){const I=c[b],B=I.color,z=I.intensity,V=I.distance,q=I.shadow&&I.shadow.map?I.shadow.map.texture:null;if(I.isAmbientLight)h+=B.r*z,u+=B.g*z,d+=B.b*z;else if(I.isLightProbe){for(let j=0;j<9;j++)n.probe[j].addScaledVector(I.sh.coefficients[j],z);T++}else if(I.isDirectionalLight){const j=e.get(I);if(j.color.copy(I.color).multiplyScalar(I.intensity),I.castShadow){const Q=I.shadow,N=t.get(I);N.shadowIntensity=Q.intensity,N.shadowBias=Q.bias,N.shadowNormalBias=Q.normalBias,N.shadowRadius=Q.radius,N.shadowMapSize=Q.mapSize,n.directionalShadow[f]=N,n.directionalShadowMap[f]=q,n.directionalShadowMatrix[f]=I.shadow.matrix,x++}n.directional[f]=j,f++}else if(I.isSpotLight){const j=e.get(I);j.position.setFromMatrixPosition(I.matrixWorld),j.color.copy(B).multiplyScalar(z),j.distance=V,j.coneCos=Math.cos(I.angle),j.penumbraCos=Math.cos(I.angle*(1-I.penumbra)),j.decay=I.decay,n.spot[_]=j;const Q=I.shadow;if(I.map&&(n.spotLightMap[A]=I.map,A++,Q.updateMatrices(I),I.castShadow&&E++),n.spotLightMatrix[_]=Q.matrix,I.castShadow){const N=t.get(I);N.shadowIntensity=Q.intensity,N.shadowBias=Q.bias,N.shadowNormalBias=Q.normalBias,N.shadowRadius=Q.radius,N.shadowMapSize=Q.mapSize,n.spotShadow[_]=N,n.spotShadowMap[_]=q,v++}_++}else if(I.isRectAreaLight){const j=e.get(I);j.color.copy(B).multiplyScalar(z),j.halfWidth.set(I.width*.5,0,0),j.halfHeight.set(0,I.height*.5,0),n.rectArea[g]=j,g++}else if(I.isPointLight){const j=e.get(I);if(j.color.copy(I.color).multiplyScalar(I.intensity),j.distance=I.distance,j.decay=I.decay,I.castShadow){const Q=I.shadow,N=t.get(I);N.shadowIntensity=Q.intensity,N.shadowBias=Q.bias,N.shadowNormalBias=Q.normalBias,N.shadowRadius=Q.radius,N.shadowMapSize=Q.mapSize,N.shadowCameraNear=Q.camera.near,N.shadowCameraFar=Q.camera.far,n.pointShadow[m]=N,n.pointShadowMap[m]=q,n.pointShadowMatrix[m]=I.shadow.matrix,y++}n.point[m]=j,m++}else if(I.isHemisphereLight){const j=e.get(I);j.skyColor.copy(I.color).multiplyScalar(z),j.groundColor.copy(I.groundColor).multiplyScalar(z),n.hemi[p]=j,p++}}g>0&&(r.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=oe.LTC_FLOAT_1,n.rectAreaLTC2=oe.LTC_FLOAT_2):(n.rectAreaLTC1=oe.LTC_HALF_1,n.rectAreaLTC2=oe.LTC_HALF_2)),n.ambient[0]=h,n.ambient[1]=u,n.ambient[2]=d;const P=n.hash;(P.directionalLength!==f||P.pointLength!==m||P.spotLength!==_||P.rectAreaLength!==g||P.hemiLength!==p||P.numDirectionalShadows!==x||P.numPointShadows!==y||P.numSpotShadows!==v||P.numSpotMaps!==A||P.numLightProbes!==T)&&(n.directional.length=f,n.spot.length=_,n.rectArea.length=g,n.point.length=m,n.hemi.length=p,n.directionalShadow.length=x,n.directionalShadowMap.length=x,n.pointShadow.length=y,n.pointShadowMap.length=y,n.spotShadow.length=v,n.spotShadowMap.length=v,n.directionalShadowMatrix.length=x,n.pointShadowMatrix.length=y,n.spotLightMatrix.length=v+A-E,n.spotLightMap.length=A,n.numSpotLightShadowsWithMaps=E,n.numLightProbes=T,P.directionalLength=f,P.pointLength=m,P.spotLength=_,P.rectAreaLength=g,P.hemiLength=p,P.numDirectionalShadows=x,P.numPointShadows=y,P.numSpotShadows=v,P.numSpotMaps=A,P.numLightProbes=T,n.version=h_++)}function l(c,h){let u=0,d=0,f=0,m=0,_=0;const g=h.matrixWorldInverse;for(let p=0,x=c.length;p<x;p++){const y=c[p];if(y.isDirectionalLight){const v=n.directional[u];v.direction.setFromMatrixPosition(y.matrixWorld),i.setFromMatrixPosition(y.target.matrixWorld),v.direction.sub(i),v.direction.transformDirection(g),u++}else if(y.isSpotLight){const v=n.spot[f];v.position.setFromMatrixPosition(y.matrixWorld),v.position.applyMatrix4(g),v.direction.setFromMatrixPosition(y.matrixWorld),i.setFromMatrixPosition(y.target.matrixWorld),v.direction.sub(i),v.direction.transformDirection(g),f++}else if(y.isRectAreaLight){const v=n.rectArea[m];v.position.setFromMatrixPosition(y.matrixWorld),v.position.applyMatrix4(g),a.identity(),s.copy(y.matrixWorld),s.premultiply(g),a.extractRotation(s),v.halfWidth.set(y.width*.5,0,0),v.halfHeight.set(0,y.height*.5,0),v.halfWidth.applyMatrix4(a),v.halfHeight.applyMatrix4(a),m++}else if(y.isPointLight){const v=n.point[d];v.position.setFromMatrixPosition(y.matrixWorld),v.position.applyMatrix4(g),d++}else if(y.isHemisphereLight){const v=n.hemi[_];v.direction.setFromMatrixPosition(y.matrixWorld),v.direction.transformDirection(g),_++}}}return{setup:o,setupView:l,state:n}}function Fc(r){const e=new d_(r),t=[],n=[];function i(h){c.camera=h,t.length=0,n.length=0}function s(h){t.push(h)}function a(h){n.push(h)}function o(){e.setup(t)}function l(h){e.setupView(t,h)}const c={lightsArray:t,shadowsArray:n,camera:null,lights:e,transmissionRenderTarget:{}};return{init:i,state:c,setupLights:o,setupLightsView:l,pushLight:s,pushShadow:a}}function f_(r){let e=new WeakMap;function t(i,s=0){const a=e.get(i);let o;return a===void 0?(o=new Fc(r),e.set(i,[o])):s>=a.length?(o=new Fc(r),a.push(o)):o=a[s],o}function n(){e=new WeakMap}return{get:t,dispose:n}}const p_=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,m_=`uniform sampler2D shadow_pass;
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
}`;function g_(r,e,t){let n=new Qo;const i=new pe,s=new pe,a=new tt,o=new ff({depthPacking:Wu}),l=new pf,c={},h=t.maxTextureSize,u={[Vn]:Gt,[Gt]:Vn,[rn]:rn},d=new Sn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new pe},radius:{value:4}},vertexShader:p_,fragmentShader:m_}),f=d.clone();f.defines.HORIZONTAL_PASS=1;const m=new Pt;m.setAttribute("position",new Ot(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const _=new D(m,d),g=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=th;let p=this.type;this.render=function(E,T,P){if(g.enabled===!1||g.autoUpdate===!1&&g.needsUpdate===!1||E.length===0)return;const b=r.getRenderTarget(),M=r.getActiveCubeFace(),I=r.getActiveMipmapLevel(),B=r.state;B.setBlending(ti),B.buffers.color.setClear(1,1,1,1),B.buffers.depth.setTest(!0),B.setScissorTest(!1);const z=p!==Fn&&this.type===Fn,V=p===Fn&&this.type!==Fn;for(let q=0,j=E.length;q<j;q++){const Q=E[q],N=Q.shadow;if(N===void 0){console.warn("THREE.WebGLShadowMap:",Q,"has no shadow.");continue}if(N.autoUpdate===!1&&N.needsUpdate===!1)continue;i.copy(N.mapSize);const $=N.getFrameExtents();if(i.multiply($),s.copy(N.mapSize),(i.x>h||i.y>h)&&(i.x>h&&(s.x=Math.floor(h/$.x),i.x=s.x*$.x,N.mapSize.x=s.x),i.y>h&&(s.y=Math.floor(h/$.y),i.y=s.y*$.y,N.mapSize.y=s.y)),N.map===null||z===!0||V===!0){const re=this.type!==Fn?{minFilter:Wt,magFilter:Wt}:{};N.map!==null&&N.map.dispose(),N.map=new _i(i.x,i.y,re),N.map.texture.name=Q.name+".shadowMap",N.camera.updateProjectionMatrix()}r.setRenderTarget(N.map),r.clear();const W=N.getViewportCount();for(let re=0;re<W;re++){const me=N.getViewport(re);a.set(s.x*me.x,s.y*me.y,s.x*me.z,s.y*me.w),B.viewport(a),N.updateMatrices(Q,re),n=N.getFrustum(),v(T,P,N.camera,Q,this.type)}N.isPointLightShadow!==!0&&this.type===Fn&&x(N,P),N.needsUpdate=!1}p=this.type,g.needsUpdate=!1,r.setRenderTarget(b,M,I)};function x(E,T){const P=e.update(_);d.defines.VSM_SAMPLES!==E.blurSamples&&(d.defines.VSM_SAMPLES=E.blurSamples,f.defines.VSM_SAMPLES=E.blurSamples,d.needsUpdate=!0,f.needsUpdate=!0),E.mapPass===null&&(E.mapPass=new _i(i.x,i.y)),d.uniforms.shadow_pass.value=E.map.texture,d.uniforms.resolution.value=E.mapSize,d.uniforms.radius.value=E.radius,r.setRenderTarget(E.mapPass),r.clear(),r.renderBufferDirect(T,null,P,d,_,null),f.uniforms.shadow_pass.value=E.mapPass.texture,f.uniforms.resolution.value=E.mapSize,f.uniforms.radius.value=E.radius,r.setRenderTarget(E.map),r.clear(),r.renderBufferDirect(T,null,P,f,_,null)}function y(E,T,P,b){let M=null;const I=P.isPointLight===!0?E.customDistanceMaterial:E.customDepthMaterial;if(I!==void 0)M=I;else if(M=P.isPointLight===!0?l:o,r.localClippingEnabled&&T.clipShadows===!0&&Array.isArray(T.clippingPlanes)&&T.clippingPlanes.length!==0||T.displacementMap&&T.displacementScale!==0||T.alphaMap&&T.alphaTest>0||T.map&&T.alphaTest>0){const B=M.uuid,z=T.uuid;let V=c[B];V===void 0&&(V={},c[B]=V);let q=V[z];q===void 0&&(q=M.clone(),V[z]=q,T.addEventListener("dispose",A)),M=q}if(M.visible=T.visible,M.wireframe=T.wireframe,b===Fn?M.side=T.shadowSide!==null?T.shadowSide:T.side:M.side=T.shadowSide!==null?T.shadowSide:u[T.side],M.alphaMap=T.alphaMap,M.alphaTest=T.alphaTest,M.map=T.map,M.clipShadows=T.clipShadows,M.clippingPlanes=T.clippingPlanes,M.clipIntersection=T.clipIntersection,M.displacementMap=T.displacementMap,M.displacementScale=T.displacementScale,M.displacementBias=T.displacementBias,M.wireframeLinewidth=T.wireframeLinewidth,M.linewidth=T.linewidth,P.isPointLight===!0&&M.isMeshDistanceMaterial===!0){const B=r.properties.get(M);B.light=P}return M}function v(E,T,P,b,M){if(E.visible===!1)return;if(E.layers.test(T.layers)&&(E.isMesh||E.isLine||E.isPoints)&&(E.castShadow||E.receiveShadow&&M===Fn)&&(!E.frustumCulled||n.intersectsObject(E))){E.modelViewMatrix.multiplyMatrices(P.matrixWorldInverse,E.matrixWorld);const z=e.update(E),V=E.material;if(Array.isArray(V)){const q=z.groups;for(let j=0,Q=q.length;j<Q;j++){const N=q[j],$=V[N.materialIndex];if($&&$.visible){const W=y(E,$,b,M);E.onBeforeShadow(r,E,T,P,z,W,N),r.renderBufferDirect(P,null,z,W,E,N),E.onAfterShadow(r,E,T,P,z,W,N)}}}else if(V.visible){const q=y(E,V,b,M);E.onBeforeShadow(r,E,T,P,z,q,null),r.renderBufferDirect(P,null,z,q,E,null),E.onAfterShadow(r,E,T,P,z,q,null)}}const B=E.children;for(let z=0,V=B.length;z<V;z++)v(B[z],T,P,b,M)}function A(E){E.target.removeEventListener("dispose",A);for(const P in c){const b=c[P],M=E.target.uuid;M in b&&(b[M].dispose(),delete b[M])}}}const __={[Ga]:Wa,[Xa]:$a,[qa]:ja,[qi]:Ya,[Wa]:Ga,[$a]:Xa,[ja]:qa,[Ya]:qi};function x_(r,e){function t(){let U=!1;const ce=new tt;let Y=null;const Z=new tt(0,0,0,0);return{setMask:function(fe){Y!==fe&&!U&&(r.colorMask(fe,fe,fe,fe),Y=fe)},setLocked:function(fe){U=fe},setClear:function(fe,de,Be,_t,Ut){Ut===!0&&(fe*=_t,de*=_t,Be*=_t),ce.set(fe,de,Be,_t),Z.equals(ce)===!1&&(r.clearColor(fe,de,Be,_t),Z.copy(ce))},reset:function(){U=!1,Y=null,Z.set(-1,0,0,0)}}}function n(){let U=!1,ce=!1,Y=null,Z=null,fe=null;return{setReversed:function(de){if(ce!==de){const Be=e.get("EXT_clip_control");ce?Be.clipControlEXT(Be.LOWER_LEFT_EXT,Be.ZERO_TO_ONE_EXT):Be.clipControlEXT(Be.LOWER_LEFT_EXT,Be.NEGATIVE_ONE_TO_ONE_EXT);const _t=fe;fe=null,this.setClear(_t)}ce=de},getReversed:function(){return ce},setTest:function(de){de?ae(r.DEPTH_TEST):be(r.DEPTH_TEST)},setMask:function(de){Y!==de&&!U&&(r.depthMask(de),Y=de)},setFunc:function(de){if(ce&&(de=__[de]),Z!==de){switch(de){case Ga:r.depthFunc(r.NEVER);break;case Wa:r.depthFunc(r.ALWAYS);break;case Xa:r.depthFunc(r.LESS);break;case qi:r.depthFunc(r.LEQUAL);break;case qa:r.depthFunc(r.EQUAL);break;case Ya:r.depthFunc(r.GEQUAL);break;case $a:r.depthFunc(r.GREATER);break;case ja:r.depthFunc(r.NOTEQUAL);break;default:r.depthFunc(r.LEQUAL)}Z=de}},setLocked:function(de){U=de},setClear:function(de){fe!==de&&(ce&&(de=1-de),r.clearDepth(de),fe=de)},reset:function(){U=!1,Y=null,Z=null,fe=null,ce=!1}}}function i(){let U=!1,ce=null,Y=null,Z=null,fe=null,de=null,Be=null,_t=null,Ut=null;return{setTest:function(at){U||(at?ae(r.STENCIL_TEST):be(r.STENCIL_TEST))},setMask:function(at){ce!==at&&!U&&(r.stencilMask(at),ce=at)},setFunc:function(at,ln,Cn){(Y!==at||Z!==ln||fe!==Cn)&&(r.stencilFunc(at,ln,Cn),Y=at,Z=ln,fe=Cn)},setOp:function(at,ln,Cn){(de!==at||Be!==ln||_t!==Cn)&&(r.stencilOp(at,ln,Cn),de=at,Be=ln,_t=Cn)},setLocked:function(at){U=at},setClear:function(at){Ut!==at&&(r.clearStencil(at),Ut=at)},reset:function(){U=!1,ce=null,Y=null,Z=null,fe=null,de=null,Be=null,_t=null,Ut=null}}}const s=new t,a=new n,o=new i,l=new WeakMap,c=new WeakMap;let h={},u={},d=new WeakMap,f=[],m=null,_=!1,g=null,p=null,x=null,y=null,v=null,A=null,E=null,T=new Te(0,0,0),P=0,b=!1,M=null,I=null,B=null,z=null,V=null;const q=r.getParameter(r.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let j=!1,Q=0;const N=r.getParameter(r.VERSION);N.indexOf("WebGL")!==-1?(Q=parseFloat(/^WebGL (\d)/.exec(N)[1]),j=Q>=1):N.indexOf("OpenGL ES")!==-1&&(Q=parseFloat(/^OpenGL ES (\d)/.exec(N)[1]),j=Q>=2);let $=null,W={};const re=r.getParameter(r.SCISSOR_BOX),me=r.getParameter(r.VIEWPORT),Ue=new tt().fromArray(re),X=new tt().fromArray(me);function ee(U,ce,Y,Z){const fe=new Uint8Array(4),de=r.createTexture();r.bindTexture(U,de),r.texParameteri(U,r.TEXTURE_MIN_FILTER,r.NEAREST),r.texParameteri(U,r.TEXTURE_MAG_FILTER,r.NEAREST);for(let Be=0;Be<Y;Be++)U===r.TEXTURE_3D||U===r.TEXTURE_2D_ARRAY?r.texImage3D(ce,0,r.RGBA,1,1,Z,0,r.RGBA,r.UNSIGNED_BYTE,fe):r.texImage2D(ce+Be,0,r.RGBA,1,1,0,r.RGBA,r.UNSIGNED_BYTE,fe);return de}const le={};le[r.TEXTURE_2D]=ee(r.TEXTURE_2D,r.TEXTURE_2D,1),le[r.TEXTURE_CUBE_MAP]=ee(r.TEXTURE_CUBE_MAP,r.TEXTURE_CUBE_MAP_POSITIVE_X,6),le[r.TEXTURE_2D_ARRAY]=ee(r.TEXTURE_2D_ARRAY,r.TEXTURE_2D_ARRAY,1,1),le[r.TEXTURE_3D]=ee(r.TEXTURE_3D,r.TEXTURE_3D,1,1),s.setClear(0,0,0,1),a.setClear(1),o.setClear(0),ae(r.DEPTH_TEST),a.setFunc(qi),qe(!1),je(yl),ae(r.CULL_FACE),L(ti);function ae(U){h[U]!==!0&&(r.enable(U),h[U]=!0)}function be(U){h[U]!==!1&&(r.disable(U),h[U]=!1)}function we(U,ce){return u[U]!==ce?(r.bindFramebuffer(U,ce),u[U]=ce,U===r.DRAW_FRAMEBUFFER&&(u[r.FRAMEBUFFER]=ce),U===r.FRAMEBUFFER&&(u[r.DRAW_FRAMEBUFFER]=ce),!0):!1}function Ie(U,ce){let Y=f,Z=!1;if(U){Y=d.get(ce),Y===void 0&&(Y=[],d.set(ce,Y));const fe=U.textures;if(Y.length!==fe.length||Y[0]!==r.COLOR_ATTACHMENT0){for(let de=0,Be=fe.length;de<Be;de++)Y[de]=r.COLOR_ATTACHMENT0+de;Y.length=fe.length,Z=!0}}else Y[0]!==r.BACK&&(Y[0]=r.BACK,Z=!0);Z&&r.drawBuffers(Y)}function $e(U){return m!==U?(r.useProgram(U),m=U,!0):!1}const Xe={[pi]:r.FUNC_ADD,[fu]:r.FUNC_SUBTRACT,[pu]:r.FUNC_REVERSE_SUBTRACT};Xe[mu]=r.MIN,Xe[gu]=r.MAX;const pt={[_u]:r.ZERO,[xu]:r.ONE,[vu]:r.SRC_COLOR,[Ha]:r.SRC_ALPHA,[Eu]:r.SRC_ALPHA_SATURATE,[bu]:r.DST_COLOR,[Mu]:r.DST_ALPHA,[yu]:r.ONE_MINUS_SRC_COLOR,[Va]:r.ONE_MINUS_SRC_ALPHA,[Su]:r.ONE_MINUS_DST_COLOR,[wu]:r.ONE_MINUS_DST_ALPHA,[Tu]:r.CONSTANT_COLOR,[Au]:r.ONE_MINUS_CONSTANT_COLOR,[Ru]:r.CONSTANT_ALPHA,[Cu]:r.ONE_MINUS_CONSTANT_ALPHA};function L(U,ce,Y,Z,fe,de,Be,_t,Ut,at){if(U===ti){_===!0&&(be(r.BLEND),_=!1);return}if(_===!1&&(ae(r.BLEND),_=!0),U!==du){if(U!==g||at!==b){if((p!==pi||v!==pi)&&(r.blendEquation(r.FUNC_ADD),p=pi,v=pi),at)switch(U){case Hi:r.blendFuncSeparate(r.ONE,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);break;case gn:r.blendFunc(r.ONE,r.ONE);break;case Ml:r.blendFuncSeparate(r.ZERO,r.ONE_MINUS_SRC_COLOR,r.ZERO,r.ONE);break;case wl:r.blendFuncSeparate(r.ZERO,r.SRC_COLOR,r.ZERO,r.SRC_ALPHA);break;default:console.error("THREE.WebGLState: Invalid blending: ",U);break}else switch(U){case Hi:r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);break;case gn:r.blendFunc(r.SRC_ALPHA,r.ONE);break;case Ml:r.blendFuncSeparate(r.ZERO,r.ONE_MINUS_SRC_COLOR,r.ZERO,r.ONE);break;case wl:r.blendFunc(r.ZERO,r.SRC_COLOR);break;default:console.error("THREE.WebGLState: Invalid blending: ",U);break}x=null,y=null,A=null,E=null,T.set(0,0,0),P=0,g=U,b=at}return}fe=fe||ce,de=de||Y,Be=Be||Z,(ce!==p||fe!==v)&&(r.blendEquationSeparate(Xe[ce],Xe[fe]),p=ce,v=fe),(Y!==x||Z!==y||de!==A||Be!==E)&&(r.blendFuncSeparate(pt[Y],pt[Z],pt[de],pt[Be]),x=Y,y=Z,A=de,E=Be),(_t.equals(T)===!1||Ut!==P)&&(r.blendColor(_t.r,_t.g,_t.b,Ut),T.copy(_t),P=Ut),g=U,b=!1}function Nt(U,ce){U.side===rn?be(r.CULL_FACE):ae(r.CULL_FACE);let Y=U.side===Gt;ce&&(Y=!Y),qe(Y),U.blending===Hi&&U.transparent===!1?L(ti):L(U.blending,U.blendEquation,U.blendSrc,U.blendDst,U.blendEquationAlpha,U.blendSrcAlpha,U.blendDstAlpha,U.blendColor,U.blendAlpha,U.premultipliedAlpha),a.setFunc(U.depthFunc),a.setTest(U.depthTest),a.setMask(U.depthWrite),s.setMask(U.colorWrite);const Z=U.stencilWrite;o.setTest(Z),Z&&(o.setMask(U.stencilWriteMask),o.setFunc(U.stencilFunc,U.stencilRef,U.stencilFuncMask),o.setOp(U.stencilFail,U.stencilZFail,U.stencilZPass)),dt(U.polygonOffset,U.polygonOffsetFactor,U.polygonOffsetUnits),U.alphaToCoverage===!0?ae(r.SAMPLE_ALPHA_TO_COVERAGE):be(r.SAMPLE_ALPHA_TO_COVERAGE)}function qe(U){M!==U&&(U?r.frontFace(r.CW):r.frontFace(r.CCW),M=U)}function je(U){U!==hu?(ae(r.CULL_FACE),U!==I&&(U===yl?r.cullFace(r.BACK):U===uu?r.cullFace(r.FRONT):r.cullFace(r.FRONT_AND_BACK))):be(r.CULL_FACE),I=U}function Ae(U){U!==B&&(j&&r.lineWidth(U),B=U)}function dt(U,ce,Y){U?(ae(r.POLYGON_OFFSET_FILL),(z!==ce||V!==Y)&&(r.polygonOffset(ce,Y),z=ce,V=Y)):be(r.POLYGON_OFFSET_FILL)}function Ee(U){U?ae(r.SCISSOR_TEST):be(r.SCISSOR_TEST)}function R(U){U===void 0&&(U=r.TEXTURE0+q-1),$!==U&&(r.activeTexture(U),$=U)}function w(U,ce,Y){Y===void 0&&($===null?Y=r.TEXTURE0+q-1:Y=$);let Z=W[Y];Z===void 0&&(Z={type:void 0,texture:void 0},W[Y]=Z),(Z.type!==U||Z.texture!==ce)&&($!==Y&&(r.activeTexture(Y),$=Y),r.bindTexture(U,ce||le[U]),Z.type=U,Z.texture=ce)}function O(){const U=W[$];U!==void 0&&U.type!==void 0&&(r.bindTexture(U.type,null),U.type=void 0,U.texture=void 0)}function J(){try{r.compressedTexImage2D.apply(r,arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function te(){try{r.compressedTexImage3D.apply(r,arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function K(){try{r.texSubImage2D.apply(r,arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function Se(){try{r.texSubImage3D.apply(r,arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function ue(){try{r.compressedTexSubImage2D.apply(r,arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function xe(){try{r.compressedTexSubImage3D.apply(r,arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function Ze(){try{r.texStorage2D.apply(r,arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function se(){try{r.texStorage3D.apply(r,arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function ve(){try{r.texImage2D.apply(r,arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function Pe(){try{r.texImage3D.apply(r,arguments)}catch(U){console.error("THREE.WebGLState:",U)}}function De(U){Ue.equals(U)===!1&&(r.scissor(U.x,U.y,U.z,U.w),Ue.copy(U))}function ye(U){X.equals(U)===!1&&(r.viewport(U.x,U.y,U.z,U.w),X.copy(U))}function Ke(U,ce){let Y=c.get(ce);Y===void 0&&(Y=new WeakMap,c.set(ce,Y));let Z=Y.get(U);Z===void 0&&(Z=r.getUniformBlockIndex(ce,U.name),Y.set(U,Z))}function ze(U,ce){const Z=c.get(ce).get(U);l.get(ce)!==Z&&(r.uniformBlockBinding(ce,Z,U.__bindingPointIndex),l.set(ce,Z))}function ct(){r.disable(r.BLEND),r.disable(r.CULL_FACE),r.disable(r.DEPTH_TEST),r.disable(r.POLYGON_OFFSET_FILL),r.disable(r.SCISSOR_TEST),r.disable(r.STENCIL_TEST),r.disable(r.SAMPLE_ALPHA_TO_COVERAGE),r.blendEquation(r.FUNC_ADD),r.blendFunc(r.ONE,r.ZERO),r.blendFuncSeparate(r.ONE,r.ZERO,r.ONE,r.ZERO),r.blendColor(0,0,0,0),r.colorMask(!0,!0,!0,!0),r.clearColor(0,0,0,0),r.depthMask(!0),r.depthFunc(r.LESS),a.setReversed(!1),r.clearDepth(1),r.stencilMask(4294967295),r.stencilFunc(r.ALWAYS,0,4294967295),r.stencilOp(r.KEEP,r.KEEP,r.KEEP),r.clearStencil(0),r.cullFace(r.BACK),r.frontFace(r.CCW),r.polygonOffset(0,0),r.activeTexture(r.TEXTURE0),r.bindFramebuffer(r.FRAMEBUFFER,null),r.bindFramebuffer(r.DRAW_FRAMEBUFFER,null),r.bindFramebuffer(r.READ_FRAMEBUFFER,null),r.useProgram(null),r.lineWidth(1),r.scissor(0,0,r.canvas.width,r.canvas.height),r.viewport(0,0,r.canvas.width,r.canvas.height),h={},$=null,W={},u={},d=new WeakMap,f=[],m=null,_=!1,g=null,p=null,x=null,y=null,v=null,A=null,E=null,T=new Te(0,0,0),P=0,b=!1,M=null,I=null,B=null,z=null,V=null,Ue.set(0,0,r.canvas.width,r.canvas.height),X.set(0,0,r.canvas.width,r.canvas.height),s.reset(),a.reset(),o.reset()}return{buffers:{color:s,depth:a,stencil:o},enable:ae,disable:be,bindFramebuffer:we,drawBuffers:Ie,useProgram:$e,setBlending:L,setMaterial:Nt,setFlipSided:qe,setCullFace:je,setLineWidth:Ae,setPolygonOffset:dt,setScissorTest:Ee,activeTexture:R,bindTexture:w,unbindTexture:O,compressedTexImage2D:J,compressedTexImage3D:te,texImage2D:ve,texImage3D:Pe,updateUBOMapping:Ke,uniformBlockBinding:ze,texStorage2D:Ze,texStorage3D:se,texSubImage2D:K,texSubImage3D:Se,compressedTexSubImage2D:ue,compressedTexSubImage3D:xe,scissor:De,viewport:ye,reset:ct}}function v_(r,e,t,n,i,s,a){const o=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,l=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),c=new pe,h=new WeakMap;let u;const d=new WeakMap;let f=!1;try{f=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function m(R,w){return f?new OffscreenCanvas(R,w):Fs("canvas")}function _(R,w,O){let J=1;const te=Ee(R);if((te.width>O||te.height>O)&&(J=O/Math.max(te.width,te.height)),J<1)if(typeof HTMLImageElement<"u"&&R instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&R instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&R instanceof ImageBitmap||typeof VideoFrame<"u"&&R instanceof VideoFrame){const K=Math.floor(J*te.width),Se=Math.floor(J*te.height);u===void 0&&(u=m(K,Se));const ue=w?m(K,Se):u;return ue.width=K,ue.height=Se,ue.getContext("2d").drawImage(R,0,0,K,Se),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+te.width+"x"+te.height+") to ("+K+"x"+Se+")."),ue}else return"data"in R&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+te.width+"x"+te.height+")."),R;return R}function g(R){return R.generateMipmaps}function p(R){r.generateMipmap(R)}function x(R){return R.isWebGLCubeRenderTarget?r.TEXTURE_CUBE_MAP:R.isWebGL3DRenderTarget?r.TEXTURE_3D:R.isWebGLArrayRenderTarget||R.isCompressedArrayTexture?r.TEXTURE_2D_ARRAY:r.TEXTURE_2D}function y(R,w,O,J,te=!1){if(R!==null){if(r[R]!==void 0)return r[R];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+R+"'")}let K=w;if(w===r.RED&&(O===r.FLOAT&&(K=r.R32F),O===r.HALF_FLOAT&&(K=r.R16F),O===r.UNSIGNED_BYTE&&(K=r.R8)),w===r.RED_INTEGER&&(O===r.UNSIGNED_BYTE&&(K=r.R8UI),O===r.UNSIGNED_SHORT&&(K=r.R16UI),O===r.UNSIGNED_INT&&(K=r.R32UI),O===r.BYTE&&(K=r.R8I),O===r.SHORT&&(K=r.R16I),O===r.INT&&(K=r.R32I)),w===r.RG&&(O===r.FLOAT&&(K=r.RG32F),O===r.HALF_FLOAT&&(K=r.RG16F),O===r.UNSIGNED_BYTE&&(K=r.RG8)),w===r.RG_INTEGER&&(O===r.UNSIGNED_BYTE&&(K=r.RG8UI),O===r.UNSIGNED_SHORT&&(K=r.RG16UI),O===r.UNSIGNED_INT&&(K=r.RG32UI),O===r.BYTE&&(K=r.RG8I),O===r.SHORT&&(K=r.RG16I),O===r.INT&&(K=r.RG32I)),w===r.RGB_INTEGER&&(O===r.UNSIGNED_BYTE&&(K=r.RGB8UI),O===r.UNSIGNED_SHORT&&(K=r.RGB16UI),O===r.UNSIGNED_INT&&(K=r.RGB32UI),O===r.BYTE&&(K=r.RGB8I),O===r.SHORT&&(K=r.RGB16I),O===r.INT&&(K=r.RGB32I)),w===r.RGBA_INTEGER&&(O===r.UNSIGNED_BYTE&&(K=r.RGBA8UI),O===r.UNSIGNED_SHORT&&(K=r.RGBA16UI),O===r.UNSIGNED_INT&&(K=r.RGBA32UI),O===r.BYTE&&(K=r.RGBA8I),O===r.SHORT&&(K=r.RGBA16I),O===r.INT&&(K=r.RGBA32I)),w===r.RGB&&O===r.UNSIGNED_INT_5_9_9_9_REV&&(K=r.RGB9_E5),w===r.RGBA){const Se=te?kr:Je.getTransfer(J);O===r.FLOAT&&(K=r.RGBA32F),O===r.HALF_FLOAT&&(K=r.RGBA16F),O===r.UNSIGNED_BYTE&&(K=Se===lt?r.SRGB8_ALPHA8:r.RGBA8),O===r.UNSIGNED_SHORT_4_4_4_4&&(K=r.RGBA4),O===r.UNSIGNED_SHORT_5_5_5_1&&(K=r.RGB5_A1)}return(K===r.R16F||K===r.R32F||K===r.RG16F||K===r.RG32F||K===r.RGBA16F||K===r.RGBA32F)&&e.get("EXT_color_buffer_float"),K}function v(R,w){let O;return R?w===null||w===gi||w===Ki?O=r.DEPTH24_STENCIL8:w===mn?O=r.DEPTH32F_STENCIL8:w===Ns&&(O=r.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):w===null||w===gi||w===Ki?O=r.DEPTH_COMPONENT24:w===mn?O=r.DEPTH_COMPONENT32F:w===Ns&&(O=r.DEPTH_COMPONENT16),O}function A(R,w){return g(R)===!0||R.isFramebufferTexture&&R.minFilter!==Wt&&R.minFilter!==Dt?Math.log2(Math.max(w.width,w.height))+1:R.mipmaps!==void 0&&R.mipmaps.length>0?R.mipmaps.length:R.isCompressedTexture&&Array.isArray(R.image)?w.mipmaps.length:1}function E(R){const w=R.target;w.removeEventListener("dispose",E),P(w),w.isVideoTexture&&h.delete(w)}function T(R){const w=R.target;w.removeEventListener("dispose",T),M(w)}function P(R){const w=n.get(R);if(w.__webglInit===void 0)return;const O=R.source,J=d.get(O);if(J){const te=J[w.__cacheKey];te.usedTimes--,te.usedTimes===0&&b(R),Object.keys(J).length===0&&d.delete(O)}n.remove(R)}function b(R){const w=n.get(R);r.deleteTexture(w.__webglTexture);const O=R.source,J=d.get(O);delete J[w.__cacheKey],a.memory.textures--}function M(R){const w=n.get(R);if(R.depthTexture&&(R.depthTexture.dispose(),n.remove(R.depthTexture)),R.isWebGLCubeRenderTarget)for(let J=0;J<6;J++){if(Array.isArray(w.__webglFramebuffer[J]))for(let te=0;te<w.__webglFramebuffer[J].length;te++)r.deleteFramebuffer(w.__webglFramebuffer[J][te]);else r.deleteFramebuffer(w.__webglFramebuffer[J]);w.__webglDepthbuffer&&r.deleteRenderbuffer(w.__webglDepthbuffer[J])}else{if(Array.isArray(w.__webglFramebuffer))for(let J=0;J<w.__webglFramebuffer.length;J++)r.deleteFramebuffer(w.__webglFramebuffer[J]);else r.deleteFramebuffer(w.__webglFramebuffer);if(w.__webglDepthbuffer&&r.deleteRenderbuffer(w.__webglDepthbuffer),w.__webglMultisampledFramebuffer&&r.deleteFramebuffer(w.__webglMultisampledFramebuffer),w.__webglColorRenderbuffer)for(let J=0;J<w.__webglColorRenderbuffer.length;J++)w.__webglColorRenderbuffer[J]&&r.deleteRenderbuffer(w.__webglColorRenderbuffer[J]);w.__webglDepthRenderbuffer&&r.deleteRenderbuffer(w.__webglDepthRenderbuffer)}const O=R.textures;for(let J=0,te=O.length;J<te;J++){const K=n.get(O[J]);K.__webglTexture&&(r.deleteTexture(K.__webglTexture),a.memory.textures--),n.remove(O[J])}n.remove(R)}let I=0;function B(){I=0}function z(){const R=I;return R>=i.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+R+" texture units while this GPU supports only "+i.maxTextures),I+=1,R}function V(R){const w=[];return w.push(R.wrapS),w.push(R.wrapT),w.push(R.wrapR||0),w.push(R.magFilter),w.push(R.minFilter),w.push(R.anisotropy),w.push(R.internalFormat),w.push(R.format),w.push(R.type),w.push(R.generateMipmaps),w.push(R.premultiplyAlpha),w.push(R.flipY),w.push(R.unpackAlignment),w.push(R.colorSpace),w.join()}function q(R,w){const O=n.get(R);if(R.isVideoTexture&&Ae(R),R.isRenderTargetTexture===!1&&R.version>0&&O.__version!==R.version){const J=R.image;if(J===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(J.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{X(O,R,w);return}}t.bindTexture(r.TEXTURE_2D,O.__webglTexture,r.TEXTURE0+w)}function j(R,w){const O=n.get(R);if(R.version>0&&O.__version!==R.version){X(O,R,w);return}t.bindTexture(r.TEXTURE_2D_ARRAY,O.__webglTexture,r.TEXTURE0+w)}function Q(R,w){const O=n.get(R);if(R.version>0&&O.__version!==R.version){X(O,R,w);return}t.bindTexture(r.TEXTURE_3D,O.__webglTexture,r.TEXTURE0+w)}function N(R,w){const O=n.get(R);if(R.version>0&&O.__version!==R.version){ee(O,R,w);return}t.bindTexture(r.TEXTURE_CUBE_MAP,O.__webglTexture,r.TEXTURE0+w)}const $={[ji]:r.REPEAT,[yn]:r.CLAMP_TO_EDGE,[Nr]:r.MIRRORED_REPEAT},W={[Wt]:r.NEAREST,[ah]:r.NEAREST_MIPMAP_NEAREST,[Ss]:r.NEAREST_MIPMAP_LINEAR,[Dt]:r.LINEAR,[Sr]:r.LINEAR_MIPMAP_NEAREST,[On]:r.LINEAR_MIPMAP_LINEAR},re={[qu]:r.NEVER,[Zu]:r.ALWAYS,[Yu]:r.LESS,[vh]:r.LEQUAL,[$u]:r.EQUAL,[Ju]:r.GEQUAL,[ju]:r.GREATER,[Ku]:r.NOTEQUAL};function me(R,w){if(w.type===mn&&e.has("OES_texture_float_linear")===!1&&(w.magFilter===Dt||w.magFilter===Sr||w.magFilter===Ss||w.magFilter===On||w.minFilter===Dt||w.minFilter===Sr||w.minFilter===Ss||w.minFilter===On)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),r.texParameteri(R,r.TEXTURE_WRAP_S,$[w.wrapS]),r.texParameteri(R,r.TEXTURE_WRAP_T,$[w.wrapT]),(R===r.TEXTURE_3D||R===r.TEXTURE_2D_ARRAY)&&r.texParameteri(R,r.TEXTURE_WRAP_R,$[w.wrapR]),r.texParameteri(R,r.TEXTURE_MAG_FILTER,W[w.magFilter]),r.texParameteri(R,r.TEXTURE_MIN_FILTER,W[w.minFilter]),w.compareFunction&&(r.texParameteri(R,r.TEXTURE_COMPARE_MODE,r.COMPARE_REF_TO_TEXTURE),r.texParameteri(R,r.TEXTURE_COMPARE_FUNC,re[w.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(w.magFilter===Wt||w.minFilter!==Ss&&w.minFilter!==On||w.type===mn&&e.has("OES_texture_float_linear")===!1)return;if(w.anisotropy>1||n.get(w).__currentAnisotropy){const O=e.get("EXT_texture_filter_anisotropic");r.texParameterf(R,O.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(w.anisotropy,i.getMaxAnisotropy())),n.get(w).__currentAnisotropy=w.anisotropy}}}function Ue(R,w){let O=!1;R.__webglInit===void 0&&(R.__webglInit=!0,w.addEventListener("dispose",E));const J=w.source;let te=d.get(J);te===void 0&&(te={},d.set(J,te));const K=V(w);if(K!==R.__cacheKey){te[K]===void 0&&(te[K]={texture:r.createTexture(),usedTimes:0},a.memory.textures++,O=!0),te[K].usedTimes++;const Se=te[R.__cacheKey];Se!==void 0&&(te[R.__cacheKey].usedTimes--,Se.usedTimes===0&&b(w)),R.__cacheKey=K,R.__webglTexture=te[K].texture}return O}function X(R,w,O){let J=r.TEXTURE_2D;(w.isDataArrayTexture||w.isCompressedArrayTexture)&&(J=r.TEXTURE_2D_ARRAY),w.isData3DTexture&&(J=r.TEXTURE_3D);const te=Ue(R,w),K=w.source;t.bindTexture(J,R.__webglTexture,r.TEXTURE0+O);const Se=n.get(K);if(K.version!==Se.__version||te===!0){t.activeTexture(r.TEXTURE0+O);const ue=Je.getPrimaries(Je.workingColorSpace),xe=w.colorSpace===Zn?null:Je.getPrimaries(w.colorSpace),Ze=w.colorSpace===Zn||ue===xe?r.NONE:r.BROWSER_DEFAULT_WEBGL;r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,w.flipY),r.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,w.premultiplyAlpha),r.pixelStorei(r.UNPACK_ALIGNMENT,w.unpackAlignment),r.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,Ze);let se=_(w.image,!1,i.maxTextureSize);se=dt(w,se);const ve=s.convert(w.format,w.colorSpace),Pe=s.convert(w.type);let De=y(w.internalFormat,ve,Pe,w.colorSpace,w.isVideoTexture);me(J,w);let ye;const Ke=w.mipmaps,ze=w.isVideoTexture!==!0,ct=Se.__version===void 0||te===!0,U=K.dataReady,ce=A(w,se);if(w.isDepthTexture)De=v(w.format===Ji,w.type),ct&&(ze?t.texStorage2D(r.TEXTURE_2D,1,De,se.width,se.height):t.texImage2D(r.TEXTURE_2D,0,De,se.width,se.height,0,ve,Pe,null));else if(w.isDataTexture)if(Ke.length>0){ze&&ct&&t.texStorage2D(r.TEXTURE_2D,ce,De,Ke[0].width,Ke[0].height);for(let Y=0,Z=Ke.length;Y<Z;Y++)ye=Ke[Y],ze?U&&t.texSubImage2D(r.TEXTURE_2D,Y,0,0,ye.width,ye.height,ve,Pe,ye.data):t.texImage2D(r.TEXTURE_2D,Y,De,ye.width,ye.height,0,ve,Pe,ye.data);w.generateMipmaps=!1}else ze?(ct&&t.texStorage2D(r.TEXTURE_2D,ce,De,se.width,se.height),U&&t.texSubImage2D(r.TEXTURE_2D,0,0,0,se.width,se.height,ve,Pe,se.data)):t.texImage2D(r.TEXTURE_2D,0,De,se.width,se.height,0,ve,Pe,se.data);else if(w.isCompressedTexture)if(w.isCompressedArrayTexture){ze&&ct&&t.texStorage3D(r.TEXTURE_2D_ARRAY,ce,De,Ke[0].width,Ke[0].height,se.depth);for(let Y=0,Z=Ke.length;Y<Z;Y++)if(ye=Ke[Y],w.format!==an)if(ve!==null)if(ze){if(U)if(w.layerUpdates.size>0){const fe=fc(ye.width,ye.height,w.format,w.type);for(const de of w.layerUpdates){const Be=ye.data.subarray(de*fe/ye.data.BYTES_PER_ELEMENT,(de+1)*fe/ye.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(r.TEXTURE_2D_ARRAY,Y,0,0,de,ye.width,ye.height,1,ve,Be)}w.clearLayerUpdates()}else t.compressedTexSubImage3D(r.TEXTURE_2D_ARRAY,Y,0,0,0,ye.width,ye.height,se.depth,ve,ye.data)}else t.compressedTexImage3D(r.TEXTURE_2D_ARRAY,Y,De,ye.width,ye.height,se.depth,0,ye.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else ze?U&&t.texSubImage3D(r.TEXTURE_2D_ARRAY,Y,0,0,0,ye.width,ye.height,se.depth,ve,Pe,ye.data):t.texImage3D(r.TEXTURE_2D_ARRAY,Y,De,ye.width,ye.height,se.depth,0,ve,Pe,ye.data)}else{ze&&ct&&t.texStorage2D(r.TEXTURE_2D,ce,De,Ke[0].width,Ke[0].height);for(let Y=0,Z=Ke.length;Y<Z;Y++)ye=Ke[Y],w.format!==an?ve!==null?ze?U&&t.compressedTexSubImage2D(r.TEXTURE_2D,Y,0,0,ye.width,ye.height,ve,ye.data):t.compressedTexImage2D(r.TEXTURE_2D,Y,De,ye.width,ye.height,0,ye.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):ze?U&&t.texSubImage2D(r.TEXTURE_2D,Y,0,0,ye.width,ye.height,ve,Pe,ye.data):t.texImage2D(r.TEXTURE_2D,Y,De,ye.width,ye.height,0,ve,Pe,ye.data)}else if(w.isDataArrayTexture)if(ze){if(ct&&t.texStorage3D(r.TEXTURE_2D_ARRAY,ce,De,se.width,se.height,se.depth),U)if(w.layerUpdates.size>0){const Y=fc(se.width,se.height,w.format,w.type);for(const Z of w.layerUpdates){const fe=se.data.subarray(Z*Y/se.data.BYTES_PER_ELEMENT,(Z+1)*Y/se.data.BYTES_PER_ELEMENT);t.texSubImage3D(r.TEXTURE_2D_ARRAY,0,0,0,Z,se.width,se.height,1,ve,Pe,fe)}w.clearLayerUpdates()}else t.texSubImage3D(r.TEXTURE_2D_ARRAY,0,0,0,0,se.width,se.height,se.depth,ve,Pe,se.data)}else t.texImage3D(r.TEXTURE_2D_ARRAY,0,De,se.width,se.height,se.depth,0,ve,Pe,se.data);else if(w.isData3DTexture)ze?(ct&&t.texStorage3D(r.TEXTURE_3D,ce,De,se.width,se.height,se.depth),U&&t.texSubImage3D(r.TEXTURE_3D,0,0,0,0,se.width,se.height,se.depth,ve,Pe,se.data)):t.texImage3D(r.TEXTURE_3D,0,De,se.width,se.height,se.depth,0,ve,Pe,se.data);else if(w.isFramebufferTexture){if(ct)if(ze)t.texStorage2D(r.TEXTURE_2D,ce,De,se.width,se.height);else{let Y=se.width,Z=se.height;for(let fe=0;fe<ce;fe++)t.texImage2D(r.TEXTURE_2D,fe,De,Y,Z,0,ve,Pe,null),Y>>=1,Z>>=1}}else if(Ke.length>0){if(ze&&ct){const Y=Ee(Ke[0]);t.texStorage2D(r.TEXTURE_2D,ce,De,Y.width,Y.height)}for(let Y=0,Z=Ke.length;Y<Z;Y++)ye=Ke[Y],ze?U&&t.texSubImage2D(r.TEXTURE_2D,Y,0,0,ve,Pe,ye):t.texImage2D(r.TEXTURE_2D,Y,De,ve,Pe,ye);w.generateMipmaps=!1}else if(ze){if(ct){const Y=Ee(se);t.texStorage2D(r.TEXTURE_2D,ce,De,Y.width,Y.height)}U&&t.texSubImage2D(r.TEXTURE_2D,0,0,0,ve,Pe,se)}else t.texImage2D(r.TEXTURE_2D,0,De,ve,Pe,se);g(w)&&p(J),Se.__version=K.version,w.onUpdate&&w.onUpdate(w)}R.__version=w.version}function ee(R,w,O){if(w.image.length!==6)return;const J=Ue(R,w),te=w.source;t.bindTexture(r.TEXTURE_CUBE_MAP,R.__webglTexture,r.TEXTURE0+O);const K=n.get(te);if(te.version!==K.__version||J===!0){t.activeTexture(r.TEXTURE0+O);const Se=Je.getPrimaries(Je.workingColorSpace),ue=w.colorSpace===Zn?null:Je.getPrimaries(w.colorSpace),xe=w.colorSpace===Zn||Se===ue?r.NONE:r.BROWSER_DEFAULT_WEBGL;r.pixelStorei(r.UNPACK_FLIP_Y_WEBGL,w.flipY),r.pixelStorei(r.UNPACK_PREMULTIPLY_ALPHA_WEBGL,w.premultiplyAlpha),r.pixelStorei(r.UNPACK_ALIGNMENT,w.unpackAlignment),r.pixelStorei(r.UNPACK_COLORSPACE_CONVERSION_WEBGL,xe);const Ze=w.isCompressedTexture||w.image[0].isCompressedTexture,se=w.image[0]&&w.image[0].isDataTexture,ve=[];for(let Z=0;Z<6;Z++)!Ze&&!se?ve[Z]=_(w.image[Z],!0,i.maxCubemapSize):ve[Z]=se?w.image[Z].image:w.image[Z],ve[Z]=dt(w,ve[Z]);const Pe=ve[0],De=s.convert(w.format,w.colorSpace),ye=s.convert(w.type),Ke=y(w.internalFormat,De,ye,w.colorSpace),ze=w.isVideoTexture!==!0,ct=K.__version===void 0||J===!0,U=te.dataReady;let ce=A(w,Pe);me(r.TEXTURE_CUBE_MAP,w);let Y;if(Ze){ze&&ct&&t.texStorage2D(r.TEXTURE_CUBE_MAP,ce,Ke,Pe.width,Pe.height);for(let Z=0;Z<6;Z++){Y=ve[Z].mipmaps;for(let fe=0;fe<Y.length;fe++){const de=Y[fe];w.format!==an?De!==null?ze?U&&t.compressedTexSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Z,fe,0,0,de.width,de.height,De,de.data):t.compressedTexImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Z,fe,Ke,de.width,de.height,0,de.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):ze?U&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Z,fe,0,0,de.width,de.height,De,ye,de.data):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Z,fe,Ke,de.width,de.height,0,De,ye,de.data)}}}else{if(Y=w.mipmaps,ze&&ct){Y.length>0&&ce++;const Z=Ee(ve[0]);t.texStorage2D(r.TEXTURE_CUBE_MAP,ce,Ke,Z.width,Z.height)}for(let Z=0;Z<6;Z++)if(se){ze?U&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Z,0,0,0,ve[Z].width,ve[Z].height,De,ye,ve[Z].data):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Z,0,Ke,ve[Z].width,ve[Z].height,0,De,ye,ve[Z].data);for(let fe=0;fe<Y.length;fe++){const Be=Y[fe].image[Z].image;ze?U&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Z,fe+1,0,0,Be.width,Be.height,De,ye,Be.data):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Z,fe+1,Ke,Be.width,Be.height,0,De,ye,Be.data)}}else{ze?U&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Z,0,0,0,De,ye,ve[Z]):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Z,0,Ke,De,ye,ve[Z]);for(let fe=0;fe<Y.length;fe++){const de=Y[fe];ze?U&&t.texSubImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Z,fe+1,0,0,De,ye,de.image[Z]):t.texImage2D(r.TEXTURE_CUBE_MAP_POSITIVE_X+Z,fe+1,Ke,De,ye,de.image[Z])}}}g(w)&&p(r.TEXTURE_CUBE_MAP),K.__version=te.version,w.onUpdate&&w.onUpdate(w)}R.__version=w.version}function le(R,w,O,J,te,K){const Se=s.convert(O.format,O.colorSpace),ue=s.convert(O.type),xe=y(O.internalFormat,Se,ue,O.colorSpace),Ze=n.get(w),se=n.get(O);if(se.__renderTarget=w,!Ze.__hasExternalTextures){const ve=Math.max(1,w.width>>K),Pe=Math.max(1,w.height>>K);te===r.TEXTURE_3D||te===r.TEXTURE_2D_ARRAY?t.texImage3D(te,K,xe,ve,Pe,w.depth,0,Se,ue,null):t.texImage2D(te,K,xe,ve,Pe,0,Se,ue,null)}t.bindFramebuffer(r.FRAMEBUFFER,R),je(w)?o.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,J,te,se.__webglTexture,0,qe(w)):(te===r.TEXTURE_2D||te>=r.TEXTURE_CUBE_MAP_POSITIVE_X&&te<=r.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&r.framebufferTexture2D(r.FRAMEBUFFER,J,te,se.__webglTexture,K),t.bindFramebuffer(r.FRAMEBUFFER,null)}function ae(R,w,O){if(r.bindRenderbuffer(r.RENDERBUFFER,R),w.depthBuffer){const J=w.depthTexture,te=J&&J.isDepthTexture?J.type:null,K=v(w.stencilBuffer,te),Se=w.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,ue=qe(w);je(w)?o.renderbufferStorageMultisampleEXT(r.RENDERBUFFER,ue,K,w.width,w.height):O?r.renderbufferStorageMultisample(r.RENDERBUFFER,ue,K,w.width,w.height):r.renderbufferStorage(r.RENDERBUFFER,K,w.width,w.height),r.framebufferRenderbuffer(r.FRAMEBUFFER,Se,r.RENDERBUFFER,R)}else{const J=w.textures;for(let te=0;te<J.length;te++){const K=J[te],Se=s.convert(K.format,K.colorSpace),ue=s.convert(K.type),xe=y(K.internalFormat,Se,ue,K.colorSpace),Ze=qe(w);O&&je(w)===!1?r.renderbufferStorageMultisample(r.RENDERBUFFER,Ze,xe,w.width,w.height):je(w)?o.renderbufferStorageMultisampleEXT(r.RENDERBUFFER,Ze,xe,w.width,w.height):r.renderbufferStorage(r.RENDERBUFFER,xe,w.width,w.height)}}r.bindRenderbuffer(r.RENDERBUFFER,null)}function be(R,w){if(w&&w.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(r.FRAMEBUFFER,R),!(w.depthTexture&&w.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");const J=n.get(w.depthTexture);J.__renderTarget=w,(!J.__webglTexture||w.depthTexture.image.width!==w.width||w.depthTexture.image.height!==w.height)&&(w.depthTexture.image.width=w.width,w.depthTexture.image.height=w.height,w.depthTexture.needsUpdate=!0),q(w.depthTexture,0);const te=J.__webglTexture,K=qe(w);if(w.depthTexture.format===Vi)je(w)?o.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,r.DEPTH_ATTACHMENT,r.TEXTURE_2D,te,0,K):r.framebufferTexture2D(r.FRAMEBUFFER,r.DEPTH_ATTACHMENT,r.TEXTURE_2D,te,0);else if(w.depthTexture.format===Ji)je(w)?o.framebufferTexture2DMultisampleEXT(r.FRAMEBUFFER,r.DEPTH_STENCIL_ATTACHMENT,r.TEXTURE_2D,te,0,K):r.framebufferTexture2D(r.FRAMEBUFFER,r.DEPTH_STENCIL_ATTACHMENT,r.TEXTURE_2D,te,0);else throw new Error("Unknown depthTexture format")}function we(R){const w=n.get(R),O=R.isWebGLCubeRenderTarget===!0;if(w.__boundDepthTexture!==R.depthTexture){const J=R.depthTexture;if(w.__depthDisposeCallback&&w.__depthDisposeCallback(),J){const te=()=>{delete w.__boundDepthTexture,delete w.__depthDisposeCallback,J.removeEventListener("dispose",te)};J.addEventListener("dispose",te),w.__depthDisposeCallback=te}w.__boundDepthTexture=J}if(R.depthTexture&&!w.__autoAllocateDepthBuffer){if(O)throw new Error("target.depthTexture not supported in Cube render targets");be(w.__webglFramebuffer,R)}else if(O){w.__webglDepthbuffer=[];for(let J=0;J<6;J++)if(t.bindFramebuffer(r.FRAMEBUFFER,w.__webglFramebuffer[J]),w.__webglDepthbuffer[J]===void 0)w.__webglDepthbuffer[J]=r.createRenderbuffer(),ae(w.__webglDepthbuffer[J],R,!1);else{const te=R.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,K=w.__webglDepthbuffer[J];r.bindRenderbuffer(r.RENDERBUFFER,K),r.framebufferRenderbuffer(r.FRAMEBUFFER,te,r.RENDERBUFFER,K)}}else if(t.bindFramebuffer(r.FRAMEBUFFER,w.__webglFramebuffer),w.__webglDepthbuffer===void 0)w.__webglDepthbuffer=r.createRenderbuffer(),ae(w.__webglDepthbuffer,R,!1);else{const J=R.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,te=w.__webglDepthbuffer;r.bindRenderbuffer(r.RENDERBUFFER,te),r.framebufferRenderbuffer(r.FRAMEBUFFER,J,r.RENDERBUFFER,te)}t.bindFramebuffer(r.FRAMEBUFFER,null)}function Ie(R,w,O){const J=n.get(R);w!==void 0&&le(J.__webglFramebuffer,R,R.texture,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,0),O!==void 0&&we(R)}function $e(R){const w=R.texture,O=n.get(R),J=n.get(w);R.addEventListener("dispose",T);const te=R.textures,K=R.isWebGLCubeRenderTarget===!0,Se=te.length>1;if(Se||(J.__webglTexture===void 0&&(J.__webglTexture=r.createTexture()),J.__version=w.version,a.memory.textures++),K){O.__webglFramebuffer=[];for(let ue=0;ue<6;ue++)if(w.mipmaps&&w.mipmaps.length>0){O.__webglFramebuffer[ue]=[];for(let xe=0;xe<w.mipmaps.length;xe++)O.__webglFramebuffer[ue][xe]=r.createFramebuffer()}else O.__webglFramebuffer[ue]=r.createFramebuffer()}else{if(w.mipmaps&&w.mipmaps.length>0){O.__webglFramebuffer=[];for(let ue=0;ue<w.mipmaps.length;ue++)O.__webglFramebuffer[ue]=r.createFramebuffer()}else O.__webglFramebuffer=r.createFramebuffer();if(Se)for(let ue=0,xe=te.length;ue<xe;ue++){const Ze=n.get(te[ue]);Ze.__webglTexture===void 0&&(Ze.__webglTexture=r.createTexture(),a.memory.textures++)}if(R.samples>0&&je(R)===!1){O.__webglMultisampledFramebuffer=r.createFramebuffer(),O.__webglColorRenderbuffer=[],t.bindFramebuffer(r.FRAMEBUFFER,O.__webglMultisampledFramebuffer);for(let ue=0;ue<te.length;ue++){const xe=te[ue];O.__webglColorRenderbuffer[ue]=r.createRenderbuffer(),r.bindRenderbuffer(r.RENDERBUFFER,O.__webglColorRenderbuffer[ue]);const Ze=s.convert(xe.format,xe.colorSpace),se=s.convert(xe.type),ve=y(xe.internalFormat,Ze,se,xe.colorSpace,R.isXRRenderTarget===!0),Pe=qe(R);r.renderbufferStorageMultisample(r.RENDERBUFFER,Pe,ve,R.width,R.height),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+ue,r.RENDERBUFFER,O.__webglColorRenderbuffer[ue])}r.bindRenderbuffer(r.RENDERBUFFER,null),R.depthBuffer&&(O.__webglDepthRenderbuffer=r.createRenderbuffer(),ae(O.__webglDepthRenderbuffer,R,!0)),t.bindFramebuffer(r.FRAMEBUFFER,null)}}if(K){t.bindTexture(r.TEXTURE_CUBE_MAP,J.__webglTexture),me(r.TEXTURE_CUBE_MAP,w);for(let ue=0;ue<6;ue++)if(w.mipmaps&&w.mipmaps.length>0)for(let xe=0;xe<w.mipmaps.length;xe++)le(O.__webglFramebuffer[ue][xe],R,w,r.COLOR_ATTACHMENT0,r.TEXTURE_CUBE_MAP_POSITIVE_X+ue,xe);else le(O.__webglFramebuffer[ue],R,w,r.COLOR_ATTACHMENT0,r.TEXTURE_CUBE_MAP_POSITIVE_X+ue,0);g(w)&&p(r.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(Se){for(let ue=0,xe=te.length;ue<xe;ue++){const Ze=te[ue],se=n.get(Ze);t.bindTexture(r.TEXTURE_2D,se.__webglTexture),me(r.TEXTURE_2D,Ze),le(O.__webglFramebuffer,R,Ze,r.COLOR_ATTACHMENT0+ue,r.TEXTURE_2D,0),g(Ze)&&p(r.TEXTURE_2D)}t.unbindTexture()}else{let ue=r.TEXTURE_2D;if((R.isWebGL3DRenderTarget||R.isWebGLArrayRenderTarget)&&(ue=R.isWebGL3DRenderTarget?r.TEXTURE_3D:r.TEXTURE_2D_ARRAY),t.bindTexture(ue,J.__webglTexture),me(ue,w),w.mipmaps&&w.mipmaps.length>0)for(let xe=0;xe<w.mipmaps.length;xe++)le(O.__webglFramebuffer[xe],R,w,r.COLOR_ATTACHMENT0,ue,xe);else le(O.__webglFramebuffer,R,w,r.COLOR_ATTACHMENT0,ue,0);g(w)&&p(ue),t.unbindTexture()}R.depthBuffer&&we(R)}function Xe(R){const w=R.textures;for(let O=0,J=w.length;O<J;O++){const te=w[O];if(g(te)){const K=x(R),Se=n.get(te).__webglTexture;t.bindTexture(K,Se),p(K),t.unbindTexture()}}}const pt=[],L=[];function Nt(R){if(R.samples>0){if(je(R)===!1){const w=R.textures,O=R.width,J=R.height;let te=r.COLOR_BUFFER_BIT;const K=R.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT,Se=n.get(R),ue=w.length>1;if(ue)for(let xe=0;xe<w.length;xe++)t.bindFramebuffer(r.FRAMEBUFFER,Se.__webglMultisampledFramebuffer),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+xe,r.RENDERBUFFER,null),t.bindFramebuffer(r.FRAMEBUFFER,Se.__webglFramebuffer),r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0+xe,r.TEXTURE_2D,null,0);t.bindFramebuffer(r.READ_FRAMEBUFFER,Se.__webglMultisampledFramebuffer),t.bindFramebuffer(r.DRAW_FRAMEBUFFER,Se.__webglFramebuffer);for(let xe=0;xe<w.length;xe++){if(R.resolveDepthBuffer&&(R.depthBuffer&&(te|=r.DEPTH_BUFFER_BIT),R.stencilBuffer&&R.resolveStencilBuffer&&(te|=r.STENCIL_BUFFER_BIT)),ue){r.framebufferRenderbuffer(r.READ_FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.RENDERBUFFER,Se.__webglColorRenderbuffer[xe]);const Ze=n.get(w[xe]).__webglTexture;r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,Ze,0)}r.blitFramebuffer(0,0,O,J,0,0,O,J,te,r.NEAREST),l===!0&&(pt.length=0,L.length=0,pt.push(r.COLOR_ATTACHMENT0+xe),R.depthBuffer&&R.resolveDepthBuffer===!1&&(pt.push(K),L.push(K),r.invalidateFramebuffer(r.DRAW_FRAMEBUFFER,L)),r.invalidateFramebuffer(r.READ_FRAMEBUFFER,pt))}if(t.bindFramebuffer(r.READ_FRAMEBUFFER,null),t.bindFramebuffer(r.DRAW_FRAMEBUFFER,null),ue)for(let xe=0;xe<w.length;xe++){t.bindFramebuffer(r.FRAMEBUFFER,Se.__webglMultisampledFramebuffer),r.framebufferRenderbuffer(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0+xe,r.RENDERBUFFER,Se.__webglColorRenderbuffer[xe]);const Ze=n.get(w[xe]).__webglTexture;t.bindFramebuffer(r.FRAMEBUFFER,Se.__webglFramebuffer),r.framebufferTexture2D(r.DRAW_FRAMEBUFFER,r.COLOR_ATTACHMENT0+xe,r.TEXTURE_2D,Ze,0)}t.bindFramebuffer(r.DRAW_FRAMEBUFFER,Se.__webglMultisampledFramebuffer)}else if(R.depthBuffer&&R.resolveDepthBuffer===!1&&l){const w=R.stencilBuffer?r.DEPTH_STENCIL_ATTACHMENT:r.DEPTH_ATTACHMENT;r.invalidateFramebuffer(r.DRAW_FRAMEBUFFER,[w])}}}function qe(R){return Math.min(i.maxSamples,R.samples)}function je(R){const w=n.get(R);return R.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&w.__useRenderToTexture!==!1}function Ae(R){const w=a.render.frame;h.get(R)!==w&&(h.set(R,w),R.update())}function dt(R,w){const O=R.colorSpace,J=R.format,te=R.type;return R.isCompressedTexture===!0||R.isVideoTexture===!0||O!==qt&&O!==Zn&&(Je.getTransfer(O)===lt?(J!==an||te!==Gn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",O)),w}function Ee(R){return typeof HTMLImageElement<"u"&&R instanceof HTMLImageElement?(c.width=R.naturalWidth||R.width,c.height=R.naturalHeight||R.height):typeof VideoFrame<"u"&&R instanceof VideoFrame?(c.width=R.displayWidth,c.height=R.displayHeight):(c.width=R.width,c.height=R.height),c}this.allocateTextureUnit=z,this.resetTextureUnits=B,this.setTexture2D=q,this.setTexture2DArray=j,this.setTexture3D=Q,this.setTextureCube=N,this.rebindTextures=Ie,this.setupRenderTarget=$e,this.updateRenderTargetMipmap=Xe,this.updateMultisampleRenderTarget=Nt,this.setupDepthRenderbuffer=we,this.setupFrameBufferTexture=le,this.useMultisampledRTT=je}function y_(r,e){function t(n,i=Zn){let s;const a=Je.getTransfer(i);if(n===Gn)return r.UNSIGNED_BYTE;if(n===Ho)return r.UNSIGNED_SHORT_4_4_4_4;if(n===Vo)return r.UNSIGNED_SHORT_5_5_5_1;if(n===ch)return r.UNSIGNED_INT_5_9_9_9_REV;if(n===oh)return r.BYTE;if(n===lh)return r.SHORT;if(n===Ns)return r.UNSIGNED_SHORT;if(n===zo)return r.INT;if(n===gi)return r.UNSIGNED_INT;if(n===mn)return r.FLOAT;if(n===Os)return r.HALF_FLOAT;if(n===hh)return r.ALPHA;if(n===uh)return r.RGB;if(n===an)return r.RGBA;if(n===dh)return r.LUMINANCE;if(n===fh)return r.LUMINANCE_ALPHA;if(n===Vi)return r.DEPTH_COMPONENT;if(n===Ji)return r.DEPTH_STENCIL;if(n===Go)return r.RED;if(n===Wo)return r.RED_INTEGER;if(n===ph)return r.RG;if(n===Xo)return r.RG_INTEGER;if(n===qo)return r.RGBA_INTEGER;if(n===Er||n===Tr||n===Ar||n===Rr)if(a===lt)if(s=e.get("WEBGL_compressed_texture_s3tc_srgb"),s!==null){if(n===Er)return s.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===Tr)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===Ar)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===Rr)return s.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(s=e.get("WEBGL_compressed_texture_s3tc"),s!==null){if(n===Er)return s.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===Tr)return s.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===Ar)return s.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===Rr)return s.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===Za||n===Qa||n===eo||n===to)if(s=e.get("WEBGL_compressed_texture_pvrtc"),s!==null){if(n===Za)return s.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===Qa)return s.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===eo)return s.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===to)return s.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===no||n===io||n===so)if(s=e.get("WEBGL_compressed_texture_etc"),s!==null){if(n===no||n===io)return a===lt?s.COMPRESSED_SRGB8_ETC2:s.COMPRESSED_RGB8_ETC2;if(n===so)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:s.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===ro||n===ao||n===oo||n===lo||n===co||n===ho||n===uo||n===fo||n===po||n===mo||n===go||n===_o||n===xo||n===vo)if(s=e.get("WEBGL_compressed_texture_astc"),s!==null){if(n===ro)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:s.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===ao)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:s.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===oo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:s.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===lo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:s.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===co)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:s.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===ho)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:s.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===uo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:s.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===fo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:s.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===po)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:s.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===mo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:s.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===go)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:s.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===_o)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:s.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===xo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:s.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===vo)return a===lt?s.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:s.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===Cr||n===yo||n===Mo)if(s=e.get("EXT_texture_compression_bptc"),s!==null){if(n===Cr)return a===lt?s.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:s.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===yo)return s.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===Mo)return s.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===mh||n===wo||n===bo||n===So)if(s=e.get("EXT_texture_compression_rgtc"),s!==null){if(n===Cr)return s.COMPRESSED_RED_RGTC1_EXT;if(n===wo)return s.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===bo)return s.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===So)return s.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===Ki?r.UNSIGNED_INT_24_8:r[n]!==void 0?r[n]:null}return{convert:t}}const M_={type:"move"};class La{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new ht,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new ht,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new C,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new C),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new ht,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new C,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new C),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){const t=this._hand;if(t)for(const n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let i=null,s=null,a=null;const o=this._targetRay,l=this._grip,c=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(c&&e.hand){a=!0;for(const _ of e.hand.values()){const g=t.getJointPose(_,n),p=this._getHandJoint(c,_);g!==null&&(p.matrix.fromArray(g.transform.matrix),p.matrix.decompose(p.position,p.rotation,p.scale),p.matrixWorldNeedsUpdate=!0,p.jointRadius=g.radius),p.visible=g!==null}const h=c.joints["index-finger-tip"],u=c.joints["thumb-tip"],d=h.position.distanceTo(u.position),f=.02,m=.005;c.inputState.pinching&&d>f+m?(c.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!c.inputState.pinching&&d<=f-m&&(c.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else l!==null&&e.gripSpace&&(s=t.getPose(e.gripSpace,n),s!==null&&(l.matrix.fromArray(s.transform.matrix),l.matrix.decompose(l.position,l.rotation,l.scale),l.matrixWorldNeedsUpdate=!0,s.linearVelocity?(l.hasLinearVelocity=!0,l.linearVelocity.copy(s.linearVelocity)):l.hasLinearVelocity=!1,s.angularVelocity?(l.hasAngularVelocity=!0,l.angularVelocity.copy(s.angularVelocity)):l.hasAngularVelocity=!1));o!==null&&(i=t.getPose(e.targetRaySpace,n),i===null&&s!==null&&(i=s),i!==null&&(o.matrix.fromArray(i.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,i.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(i.linearVelocity)):o.hasLinearVelocity=!1,i.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(i.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(M_)))}return o!==null&&(o.visible=i!==null),l!==null&&(l.visible=s!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){const n=new ht;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}}const w_=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,b_=`
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

}`;class S_{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t,n){if(this.texture===null){const i=new bt,s=e.properties.get(i);s.__webglTexture=t.texture,(t.depthNear!==n.depthNear||t.depthFar!==n.depthFar)&&(this.depthNear=t.depthNear,this.depthFar=t.depthFar),this.texture=i}}getMesh(e){if(this.texture!==null&&this.mesh===null){const t=e.cameras[0].viewport,n=new Sn({vertexShader:w_,fragmentShader:b_,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new D(new Qt(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class E_ extends vi{constructor(e,t){super();const n=this;let i=null,s=1,a=null,o="local-floor",l=1,c=null,h=null,u=null,d=null,f=null,m=null;const _=new S_,g=t.getContextAttributes();let p=null,x=null;const y=[],v=[],A=new pe;let E=null;const T=new Bt;T.viewport=new tt;const P=new Bt;P.viewport=new tt;const b=[T,P],M=new Lf;let I=null,B=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(X){let ee=y[X];return ee===void 0&&(ee=new La,y[X]=ee),ee.getTargetRaySpace()},this.getControllerGrip=function(X){let ee=y[X];return ee===void 0&&(ee=new La,y[X]=ee),ee.getGripSpace()},this.getHand=function(X){let ee=y[X];return ee===void 0&&(ee=new La,y[X]=ee),ee.getHandSpace()};function z(X){const ee=v.indexOf(X.inputSource);if(ee===-1)return;const le=y[ee];le!==void 0&&(le.update(X.inputSource,X.frame,c||a),le.dispatchEvent({type:X.type,data:X.inputSource}))}function V(){i.removeEventListener("select",z),i.removeEventListener("selectstart",z),i.removeEventListener("selectend",z),i.removeEventListener("squeeze",z),i.removeEventListener("squeezestart",z),i.removeEventListener("squeezeend",z),i.removeEventListener("end",V),i.removeEventListener("inputsourceschange",q);for(let X=0;X<y.length;X++){const ee=v[X];ee!==null&&(v[X]=null,y[X].disconnect(ee))}I=null,B=null,_.reset(),e.setRenderTarget(p),f=null,d=null,u=null,i=null,x=null,Ue.stop(),n.isPresenting=!1,e.setPixelRatio(E),e.setSize(A.width,A.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(X){s=X,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(X){o=X,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(X){c=X},this.getBaseLayer=function(){return d!==null?d:f},this.getBinding=function(){return u},this.getFrame=function(){return m},this.getSession=function(){return i},this.setSession=async function(X){if(i=X,i!==null){if(p=e.getRenderTarget(),i.addEventListener("select",z),i.addEventListener("selectstart",z),i.addEventListener("selectend",z),i.addEventListener("squeeze",z),i.addEventListener("squeezestart",z),i.addEventListener("squeezeend",z),i.addEventListener("end",V),i.addEventListener("inputsourceschange",q),g.xrCompatible!==!0&&await t.makeXRCompatible(),E=e.getPixelRatio(),e.getSize(A),i.enabledFeatures!==void 0&&i.enabledFeatures.includes("layers")){let le=null,ae=null,be=null;g.depth&&(be=g.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,le=g.stencil?Ji:Vi,ae=g.stencil?Ki:gi);const we={colorFormat:t.RGBA8,depthFormat:be,scaleFactor:s};u=new XRWebGLBinding(i,t),d=u.createProjectionLayer(we),i.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),x=new _i(d.textureWidth,d.textureHeight,{format:an,type:Gn,depthTexture:new Nh(d.textureWidth,d.textureHeight,ae,void 0,void 0,void 0,void 0,void 0,void 0,le),stencilBuffer:g.stencil,colorSpace:e.outputColorSpace,samples:g.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1})}else{const le={antialias:g.antialias,alpha:!0,depth:g.depth,stencil:g.stencil,framebufferScaleFactor:s};f=new XRWebGLLayer(i,t,le),i.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),x=new _i(f.framebufferWidth,f.framebufferHeight,{format:an,type:Gn,colorSpace:e.outputColorSpace,stencilBuffer:g.stencil})}x.isXRRenderTarget=!0,this.setFoveation(l),c=null,a=await i.requestReferenceSpace(o),Ue.setContext(i),Ue.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(i!==null)return i.environmentBlendMode},this.getDepthTexture=function(){return _.getDepthTexture()};function q(X){for(let ee=0;ee<X.removed.length;ee++){const le=X.removed[ee],ae=v.indexOf(le);ae>=0&&(v[ae]=null,y[ae].disconnect(le))}for(let ee=0;ee<X.added.length;ee++){const le=X.added[ee];let ae=v.indexOf(le);if(ae===-1){for(let we=0;we<y.length;we++)if(we>=v.length){v.push(le),ae=we;break}else if(v[we]===null){v[we]=le,ae=we;break}if(ae===-1)break}const be=y[ae];be&&be.connect(le)}}const j=new C,Q=new C;function N(X,ee,le){j.setFromMatrixPosition(ee.matrixWorld),Q.setFromMatrixPosition(le.matrixWorld);const ae=j.distanceTo(Q),be=ee.projectionMatrix.elements,we=le.projectionMatrix.elements,Ie=be[14]/(be[10]-1),$e=be[14]/(be[10]+1),Xe=(be[9]+1)/be[5],pt=(be[9]-1)/be[5],L=(be[8]-1)/be[0],Nt=(we[8]+1)/we[0],qe=Ie*L,je=Ie*Nt,Ae=ae/(-L+Nt),dt=Ae*-L;if(ee.matrixWorld.decompose(X.position,X.quaternion,X.scale),X.translateX(dt),X.translateZ(Ae),X.matrixWorld.compose(X.position,X.quaternion,X.scale),X.matrixWorldInverse.copy(X.matrixWorld).invert(),be[10]===-1)X.projectionMatrix.copy(ee.projectionMatrix),X.projectionMatrixInverse.copy(ee.projectionMatrixInverse);else{const Ee=Ie+Ae,R=$e+Ae,w=qe-dt,O=je+(ae-dt),J=Xe*$e/R*Ee,te=pt*$e/R*Ee;X.projectionMatrix.makePerspective(w,O,J,te,Ee,R),X.projectionMatrixInverse.copy(X.projectionMatrix).invert()}}function $(X,ee){ee===null?X.matrixWorld.copy(X.matrix):X.matrixWorld.multiplyMatrices(ee.matrixWorld,X.matrix),X.matrixWorldInverse.copy(X.matrixWorld).invert()}this.updateCamera=function(X){if(i===null)return;let ee=X.near,le=X.far;_.texture!==null&&(_.depthNear>0&&(ee=_.depthNear),_.depthFar>0&&(le=_.depthFar)),M.near=P.near=T.near=ee,M.far=P.far=T.far=le,(I!==M.near||B!==M.far)&&(i.updateRenderState({depthNear:M.near,depthFar:M.far}),I=M.near,B=M.far),T.layers.mask=X.layers.mask|2,P.layers.mask=X.layers.mask|4,M.layers.mask=T.layers.mask|P.layers.mask;const ae=X.parent,be=M.cameras;$(M,ae);for(let we=0;we<be.length;we++)$(be[we],ae);be.length===2?N(M,T,P):M.projectionMatrix.copy(T.projectionMatrix),W(X,M,ae)};function W(X,ee,le){le===null?X.matrix.copy(ee.matrixWorld):(X.matrix.copy(le.matrixWorld),X.matrix.invert(),X.matrix.multiply(ee.matrixWorld)),X.matrix.decompose(X.position,X.quaternion,X.scale),X.updateMatrixWorld(!0),X.projectionMatrix.copy(ee.projectionMatrix),X.projectionMatrixInverse.copy(ee.projectionMatrixInverse),X.isPerspectiveCamera&&(X.fov=Zi*2*Math.atan(1/X.projectionMatrix.elements[5]),X.zoom=1)}this.getCamera=function(){return M},this.getFoveation=function(){if(!(d===null&&f===null))return l},this.setFoveation=function(X){l=X,d!==null&&(d.fixedFoveation=X),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=X)},this.hasDepthSensing=function(){return _.texture!==null},this.getDepthSensingMesh=function(){return _.getMesh(M)};let re=null;function me(X,ee){if(h=ee.getViewerPose(c||a),m=ee,h!==null){const le=h.views;f!==null&&(e.setRenderTargetFramebuffer(x,f.framebuffer),e.setRenderTarget(x));let ae=!1;le.length!==M.cameras.length&&(M.cameras.length=0,ae=!0);for(let we=0;we<le.length;we++){const Ie=le[we];let $e=null;if(f!==null)$e=f.getViewport(Ie);else{const pt=u.getViewSubImage(d,Ie);$e=pt.viewport,we===0&&(e.setRenderTargetTextures(x,pt.colorTexture,d.ignoreDepthValues?void 0:pt.depthStencilTexture),e.setRenderTarget(x))}let Xe=b[we];Xe===void 0&&(Xe=new Bt,Xe.layers.enable(we),Xe.viewport=new tt,b[we]=Xe),Xe.matrix.fromArray(Ie.transform.matrix),Xe.matrix.decompose(Xe.position,Xe.quaternion,Xe.scale),Xe.projectionMatrix.fromArray(Ie.projectionMatrix),Xe.projectionMatrixInverse.copy(Xe.projectionMatrix).invert(),Xe.viewport.set($e.x,$e.y,$e.width,$e.height),we===0&&(M.matrix.copy(Xe.matrix),M.matrix.decompose(M.position,M.quaternion,M.scale)),ae===!0&&M.cameras.push(Xe)}const be=i.enabledFeatures;if(be&&be.includes("depth-sensing")){const we=u.getDepthInformation(le[0]);we&&we.isValid&&we.texture&&_.init(e,we,i.renderState)}}for(let le=0;le<y.length;le++){const ae=v[le],be=y[le];ae!==null&&be!==void 0&&be.update(ae,ee,c||a)}re&&re(X,ee),ee.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:ee}),m=null}const Ue=new Wh;Ue.setAnimationLoop(me),this.setAnimationLoop=function(X){re=X},this.dispose=function(){}}}const hi=new bn,T_=new Fe;function A_(r,e){function t(g,p){g.matrixAutoUpdate===!0&&g.updateMatrix(),p.value.copy(g.matrix)}function n(g,p){p.color.getRGB(g.fogColor.value,Th(r)),p.isFog?(g.fogNear.value=p.near,g.fogFar.value=p.far):p.isFogExp2&&(g.fogDensity.value=p.density)}function i(g,p,x,y,v){p.isMeshBasicMaterial||p.isMeshLambertMaterial?s(g,p):p.isMeshToonMaterial?(s(g,p),u(g,p)):p.isMeshPhongMaterial?(s(g,p),h(g,p)):p.isMeshStandardMaterial?(s(g,p),d(g,p),p.isMeshPhysicalMaterial&&f(g,p,v)):p.isMeshMatcapMaterial?(s(g,p),m(g,p)):p.isMeshDepthMaterial?s(g,p):p.isMeshDistanceMaterial?(s(g,p),_(g,p)):p.isMeshNormalMaterial?s(g,p):p.isLineBasicMaterial?(a(g,p),p.isLineDashedMaterial&&o(g,p)):p.isPointsMaterial?l(g,p,x,y):p.isSpriteMaterial?c(g,p):p.isShadowMaterial?(g.color.value.copy(p.color),g.opacity.value=p.opacity):p.isShaderMaterial&&(p.uniformsNeedUpdate=!1)}function s(g,p){g.opacity.value=p.opacity,p.color&&g.diffuse.value.copy(p.color),p.emissive&&g.emissive.value.copy(p.emissive).multiplyScalar(p.emissiveIntensity),p.map&&(g.map.value=p.map,t(p.map,g.mapTransform)),p.alphaMap&&(g.alphaMap.value=p.alphaMap,t(p.alphaMap,g.alphaMapTransform)),p.bumpMap&&(g.bumpMap.value=p.bumpMap,t(p.bumpMap,g.bumpMapTransform),g.bumpScale.value=p.bumpScale,p.side===Gt&&(g.bumpScale.value*=-1)),p.normalMap&&(g.normalMap.value=p.normalMap,t(p.normalMap,g.normalMapTransform),g.normalScale.value.copy(p.normalScale),p.side===Gt&&g.normalScale.value.negate()),p.displacementMap&&(g.displacementMap.value=p.displacementMap,t(p.displacementMap,g.displacementMapTransform),g.displacementScale.value=p.displacementScale,g.displacementBias.value=p.displacementBias),p.emissiveMap&&(g.emissiveMap.value=p.emissiveMap,t(p.emissiveMap,g.emissiveMapTransform)),p.specularMap&&(g.specularMap.value=p.specularMap,t(p.specularMap,g.specularMapTransform)),p.alphaTest>0&&(g.alphaTest.value=p.alphaTest);const x=e.get(p),y=x.envMap,v=x.envMapRotation;y&&(g.envMap.value=y,hi.copy(v),hi.x*=-1,hi.y*=-1,hi.z*=-1,y.isCubeTexture&&y.isRenderTargetTexture===!1&&(hi.y*=-1,hi.z*=-1),g.envMapRotation.value.setFromMatrix4(T_.makeRotationFromEuler(hi)),g.flipEnvMap.value=y.isCubeTexture&&y.isRenderTargetTexture===!1?-1:1,g.reflectivity.value=p.reflectivity,g.ior.value=p.ior,g.refractionRatio.value=p.refractionRatio),p.lightMap&&(g.lightMap.value=p.lightMap,g.lightMapIntensity.value=p.lightMapIntensity,t(p.lightMap,g.lightMapTransform)),p.aoMap&&(g.aoMap.value=p.aoMap,g.aoMapIntensity.value=p.aoMapIntensity,t(p.aoMap,g.aoMapTransform))}function a(g,p){g.diffuse.value.copy(p.color),g.opacity.value=p.opacity,p.map&&(g.map.value=p.map,t(p.map,g.mapTransform))}function o(g,p){g.dashSize.value=p.dashSize,g.totalSize.value=p.dashSize+p.gapSize,g.scale.value=p.scale}function l(g,p,x,y){g.diffuse.value.copy(p.color),g.opacity.value=p.opacity,g.size.value=p.size*x,g.scale.value=y*.5,p.map&&(g.map.value=p.map,t(p.map,g.uvTransform)),p.alphaMap&&(g.alphaMap.value=p.alphaMap,t(p.alphaMap,g.alphaMapTransform)),p.alphaTest>0&&(g.alphaTest.value=p.alphaTest)}function c(g,p){g.diffuse.value.copy(p.color),g.opacity.value=p.opacity,g.rotation.value=p.rotation,p.map&&(g.map.value=p.map,t(p.map,g.mapTransform)),p.alphaMap&&(g.alphaMap.value=p.alphaMap,t(p.alphaMap,g.alphaMapTransform)),p.alphaTest>0&&(g.alphaTest.value=p.alphaTest)}function h(g,p){g.specular.value.copy(p.specular),g.shininess.value=Math.max(p.shininess,1e-4)}function u(g,p){p.gradientMap&&(g.gradientMap.value=p.gradientMap)}function d(g,p){g.metalness.value=p.metalness,p.metalnessMap&&(g.metalnessMap.value=p.metalnessMap,t(p.metalnessMap,g.metalnessMapTransform)),g.roughness.value=p.roughness,p.roughnessMap&&(g.roughnessMap.value=p.roughnessMap,t(p.roughnessMap,g.roughnessMapTransform)),p.envMap&&(g.envMapIntensity.value=p.envMapIntensity)}function f(g,p,x){g.ior.value=p.ior,p.sheen>0&&(g.sheenColor.value.copy(p.sheenColor).multiplyScalar(p.sheen),g.sheenRoughness.value=p.sheenRoughness,p.sheenColorMap&&(g.sheenColorMap.value=p.sheenColorMap,t(p.sheenColorMap,g.sheenColorMapTransform)),p.sheenRoughnessMap&&(g.sheenRoughnessMap.value=p.sheenRoughnessMap,t(p.sheenRoughnessMap,g.sheenRoughnessMapTransform))),p.clearcoat>0&&(g.clearcoat.value=p.clearcoat,g.clearcoatRoughness.value=p.clearcoatRoughness,p.clearcoatMap&&(g.clearcoatMap.value=p.clearcoatMap,t(p.clearcoatMap,g.clearcoatMapTransform)),p.clearcoatRoughnessMap&&(g.clearcoatRoughnessMap.value=p.clearcoatRoughnessMap,t(p.clearcoatRoughnessMap,g.clearcoatRoughnessMapTransform)),p.clearcoatNormalMap&&(g.clearcoatNormalMap.value=p.clearcoatNormalMap,t(p.clearcoatNormalMap,g.clearcoatNormalMapTransform),g.clearcoatNormalScale.value.copy(p.clearcoatNormalScale),p.side===Gt&&g.clearcoatNormalScale.value.negate())),p.dispersion>0&&(g.dispersion.value=p.dispersion),p.iridescence>0&&(g.iridescence.value=p.iridescence,g.iridescenceIOR.value=p.iridescenceIOR,g.iridescenceThicknessMinimum.value=p.iridescenceThicknessRange[0],g.iridescenceThicknessMaximum.value=p.iridescenceThicknessRange[1],p.iridescenceMap&&(g.iridescenceMap.value=p.iridescenceMap,t(p.iridescenceMap,g.iridescenceMapTransform)),p.iridescenceThicknessMap&&(g.iridescenceThicknessMap.value=p.iridescenceThicknessMap,t(p.iridescenceThicknessMap,g.iridescenceThicknessMapTransform))),p.transmission>0&&(g.transmission.value=p.transmission,g.transmissionSamplerMap.value=x.texture,g.transmissionSamplerSize.value.set(x.width,x.height),p.transmissionMap&&(g.transmissionMap.value=p.transmissionMap,t(p.transmissionMap,g.transmissionMapTransform)),g.thickness.value=p.thickness,p.thicknessMap&&(g.thicknessMap.value=p.thicknessMap,t(p.thicknessMap,g.thicknessMapTransform)),g.attenuationDistance.value=p.attenuationDistance,g.attenuationColor.value.copy(p.attenuationColor)),p.anisotropy>0&&(g.anisotropyVector.value.set(p.anisotropy*Math.cos(p.anisotropyRotation),p.anisotropy*Math.sin(p.anisotropyRotation)),p.anisotropyMap&&(g.anisotropyMap.value=p.anisotropyMap,t(p.anisotropyMap,g.anisotropyMapTransform))),g.specularIntensity.value=p.specularIntensity,g.specularColor.value.copy(p.specularColor),p.specularColorMap&&(g.specularColorMap.value=p.specularColorMap,t(p.specularColorMap,g.specularColorMapTransform)),p.specularIntensityMap&&(g.specularIntensityMap.value=p.specularIntensityMap,t(p.specularIntensityMap,g.specularIntensityMapTransform))}function m(g,p){p.matcap&&(g.matcap.value=p.matcap)}function _(g,p){const x=e.get(p).light;g.referencePosition.value.setFromMatrixPosition(x.matrixWorld),g.nearDistance.value=x.shadow.camera.near,g.farDistance.value=x.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:i}}function R_(r,e,t,n){let i={},s={},a=[];const o=r.getParameter(r.MAX_UNIFORM_BUFFER_BINDINGS);function l(x,y){const v=y.program;n.uniformBlockBinding(x,v)}function c(x,y){let v=i[x.id];v===void 0&&(m(x),v=h(x),i[x.id]=v,x.addEventListener("dispose",g));const A=y.program;n.updateUBOMapping(x,A);const E=e.render.frame;s[x.id]!==E&&(d(x),s[x.id]=E)}function h(x){const y=u();x.__bindingPointIndex=y;const v=r.createBuffer(),A=x.__size,E=x.usage;return r.bindBuffer(r.UNIFORM_BUFFER,v),r.bufferData(r.UNIFORM_BUFFER,A,E),r.bindBuffer(r.UNIFORM_BUFFER,null),r.bindBufferBase(r.UNIFORM_BUFFER,y,v),v}function u(){for(let x=0;x<o;x++)if(a.indexOf(x)===-1)return a.push(x),x;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function d(x){const y=i[x.id],v=x.uniforms,A=x.__cache;r.bindBuffer(r.UNIFORM_BUFFER,y);for(let E=0,T=v.length;E<T;E++){const P=Array.isArray(v[E])?v[E]:[v[E]];for(let b=0,M=P.length;b<M;b++){const I=P[b];if(f(I,E,b,A)===!0){const B=I.__offset,z=Array.isArray(I.value)?I.value:[I.value];let V=0;for(let q=0;q<z.length;q++){const j=z[q],Q=_(j);typeof j=="number"||typeof j=="boolean"?(I.__data[0]=j,r.bufferSubData(r.UNIFORM_BUFFER,B+V,I.__data)):j.isMatrix3?(I.__data[0]=j.elements[0],I.__data[1]=j.elements[1],I.__data[2]=j.elements[2],I.__data[3]=0,I.__data[4]=j.elements[3],I.__data[5]=j.elements[4],I.__data[6]=j.elements[5],I.__data[7]=0,I.__data[8]=j.elements[6],I.__data[9]=j.elements[7],I.__data[10]=j.elements[8],I.__data[11]=0):(j.toArray(I.__data,V),V+=Q.storage/Float32Array.BYTES_PER_ELEMENT)}r.bufferSubData(r.UNIFORM_BUFFER,B,I.__data)}}}r.bindBuffer(r.UNIFORM_BUFFER,null)}function f(x,y,v,A){const E=x.value,T=y+"_"+v;if(A[T]===void 0)return typeof E=="number"||typeof E=="boolean"?A[T]=E:A[T]=E.clone(),!0;{const P=A[T];if(typeof E=="number"||typeof E=="boolean"){if(P!==E)return A[T]=E,!0}else if(P.equals(E)===!1)return P.copy(E),!0}return!1}function m(x){const y=x.uniforms;let v=0;const A=16;for(let T=0,P=y.length;T<P;T++){const b=Array.isArray(y[T])?y[T]:[y[T]];for(let M=0,I=b.length;M<I;M++){const B=b[M],z=Array.isArray(B.value)?B.value:[B.value];for(let V=0,q=z.length;V<q;V++){const j=z[V],Q=_(j),N=v%A,$=N%Q.boundary,W=N+$;v+=$,W!==0&&A-W<Q.storage&&(v+=A-W),B.__data=new Float32Array(Q.storage/Float32Array.BYTES_PER_ELEMENT),B.__offset=v,v+=Q.storage}}}const E=v%A;return E>0&&(v+=A-E),x.__size=v,x.__cache={},this}function _(x){const y={boundary:0,storage:0};return typeof x=="number"||typeof x=="boolean"?(y.boundary=4,y.storage=4):x.isVector2?(y.boundary=8,y.storage=8):x.isVector3||x.isColor?(y.boundary=16,y.storage=12):x.isVector4?(y.boundary=16,y.storage=16):x.isMatrix3?(y.boundary=48,y.storage=48):x.isMatrix4?(y.boundary=64,y.storage=64):x.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",x),y}function g(x){const y=x.target;y.removeEventListener("dispose",g);const v=a.indexOf(y.__bindingPointIndex);a.splice(v,1),r.deleteBuffer(i[y.id]),delete i[y.id],delete s[y.id]}function p(){for(const x in i)r.deleteBuffer(i[x]);a=[],i={},s={}}return{bind:l,update:c,dispose:p}}class jh{constructor(e={}){const{canvas:t=gd(),context:n=null,depth:i=!0,stencil:s=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:l=!0,preserveDrawingBuffer:c=!1,powerPreference:h="default",failIfMajorPerformanceCaveat:u=!1,reverseDepthBuffer:d=!1}=e;this.isWebGLRenderer=!0;let f;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");f=n.getContextAttributes().alpha}else f=a;const m=new Uint32Array(4),_=new Int32Array(4);let g=null,p=null;const x=[],y=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this._outputColorSpace=Mt,this.toneMapping=ni,this.toneMappingExposure=1;const v=this;let A=!1,E=0,T=0,P=null,b=-1,M=null;const I=new tt,B=new tt;let z=null;const V=new Te(0);let q=0,j=t.width,Q=t.height,N=1,$=null,W=null;const re=new tt(0,0,j,Q),me=new tt(0,0,j,Q);let Ue=!1;const X=new Qo;let ee=!1,le=!1;this.transmissionResolutionScale=1;const ae=new Fe,be=new Fe,we=new C,Ie=new tt,$e={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let Xe=!1;function pt(){return P===null?N:1}let L=n;function Nt(S,k){return t.getContext(S,k)}try{const S={alpha:!0,depth:i,stencil:s,antialias:o,premultipliedAlpha:l,preserveDrawingBuffer:c,powerPreference:h,failIfMajorPerformanceCaveat:u};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${Oo}`),t.addEventListener("webglcontextlost",Z,!1),t.addEventListener("webglcontextrestored",fe,!1),t.addEventListener("webglcontextcreationerror",de,!1),L===null){const k="webgl2";if(L=Nt(k,S),L===null)throw Nt(k)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(S){throw console.error("THREE.WebGLRenderer: "+S.message),S}let qe,je,Ae,dt,Ee,R,w,O,J,te,K,Se,ue,xe,Ze,se,ve,Pe,De,ye,Ke,ze,ct,U;function ce(){qe=new B0(L),qe.init(),ze=new y_(L,qe),je=new L0(L,qe,e,ze),Ae=new x_(L,qe),je.reverseDepthBuffer&&d&&Ae.buffers.depth.setReversed(!0),dt=new H0(L),Ee=new r_,R=new v_(L,qe,Ae,Ee,je,ze,dt),w=new N0(v),O=new F0(v),J=new $f(L),ct=new P0(L,J),te=new O0(L,J,dt,ct),K=new G0(L,te,J,dt),De=new V0(L,je,R),se=new D0(Ee),Se=new s_(v,w,O,qe,je,ct,se),ue=new A_(v,Ee),xe=new o_,Ze=new f_(qe),Pe=new C0(v,w,O,Ae,K,f,l),ve=new g_(v,K,je),U=new R_(L,dt,je,Ae),ye=new I0(L,qe,dt),Ke=new z0(L,qe,dt),dt.programs=Se.programs,v.capabilities=je,v.extensions=qe,v.properties=Ee,v.renderLists=xe,v.shadowMap=ve,v.state=Ae,v.info=dt}ce();const Y=new E_(v,L);this.xr=Y,this.getContext=function(){return L},this.getContextAttributes=function(){return L.getContextAttributes()},this.forceContextLoss=function(){const S=qe.get("WEBGL_lose_context");S&&S.loseContext()},this.forceContextRestore=function(){const S=qe.get("WEBGL_lose_context");S&&S.restoreContext()},this.getPixelRatio=function(){return N},this.setPixelRatio=function(S){S!==void 0&&(N=S,this.setSize(j,Q,!1))},this.getSize=function(S){return S.set(j,Q)},this.setSize=function(S,k,H=!0){if(Y.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}j=S,Q=k,t.width=Math.floor(S*N),t.height=Math.floor(k*N),H===!0&&(t.style.width=S+"px",t.style.height=k+"px"),this.setViewport(0,0,S,k)},this.getDrawingBufferSize=function(S){return S.set(j*N,Q*N).floor()},this.setDrawingBufferSize=function(S,k,H){j=S,Q=k,N=H,t.width=Math.floor(S*H),t.height=Math.floor(k*H),this.setViewport(0,0,S,k)},this.getCurrentViewport=function(S){return S.copy(I)},this.getViewport=function(S){return S.copy(re)},this.setViewport=function(S,k,H,G){S.isVector4?re.set(S.x,S.y,S.z,S.w):re.set(S,k,H,G),Ae.viewport(I.copy(re).multiplyScalar(N).round())},this.getScissor=function(S){return S.copy(me)},this.setScissor=function(S,k,H,G){S.isVector4?me.set(S.x,S.y,S.z,S.w):me.set(S,k,H,G),Ae.scissor(B.copy(me).multiplyScalar(N).round())},this.getScissorTest=function(){return Ue},this.setScissorTest=function(S){Ae.setScissorTest(Ue=S)},this.setOpaqueSort=function(S){$=S},this.setTransparentSort=function(S){W=S},this.getClearColor=function(S){return S.copy(Pe.getClearColor())},this.setClearColor=function(){Pe.setClearColor.apply(Pe,arguments)},this.getClearAlpha=function(){return Pe.getClearAlpha()},this.setClearAlpha=function(){Pe.setClearAlpha.apply(Pe,arguments)},this.clear=function(S=!0,k=!0,H=!0){let G=0;if(S){let F=!1;if(P!==null){const ie=P.texture.format;F=ie===qo||ie===Xo||ie===Wo}if(F){const ie=P.texture.type,he=ie===Gn||ie===gi||ie===Ns||ie===Ki||ie===Ho||ie===Vo,_e=Pe.getClearColor(),Me=Pe.getClearAlpha(),Ne=_e.r,ke=_e.g,Re=_e.b;he?(m[0]=Ne,m[1]=ke,m[2]=Re,m[3]=Me,L.clearBufferuiv(L.COLOR,0,m)):(_[0]=Ne,_[1]=ke,_[2]=Re,_[3]=Me,L.clearBufferiv(L.COLOR,0,_))}else G|=L.COLOR_BUFFER_BIT}k&&(G|=L.DEPTH_BUFFER_BIT),H&&(G|=L.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),L.clear(G)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",Z,!1),t.removeEventListener("webglcontextrestored",fe,!1),t.removeEventListener("webglcontextcreationerror",de,!1),Pe.dispose(),xe.dispose(),Ze.dispose(),Ee.dispose(),w.dispose(),O.dispose(),K.dispose(),ct.dispose(),U.dispose(),Se.dispose(),Y.dispose(),Y.removeEventListener("sessionstart",fl),Y.removeEventListener("sessionend",pl),ii.stop()};function Z(S){S.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),A=!0}function fe(){console.log("THREE.WebGLRenderer: Context Restored."),A=!1;const S=dt.autoReset,k=ve.enabled,H=ve.autoUpdate,G=ve.needsUpdate,F=ve.type;ce(),dt.autoReset=S,ve.enabled=k,ve.autoUpdate=H,ve.needsUpdate=G,ve.type=F}function de(S){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",S.statusMessage)}function Be(S){const k=S.target;k.removeEventListener("dispose",Be),_t(k)}function _t(S){Ut(S),Ee.remove(S)}function Ut(S){const k=Ee.get(S).programs;k!==void 0&&(k.forEach(function(H){Se.releaseProgram(H)}),S.isShaderMaterial&&Se.releaseShaderCache(S))}this.renderBufferDirect=function(S,k,H,G,F,ie){k===null&&(k=$e);const he=F.isMesh&&F.matrixWorld.determinant()<0,_e=su(S,k,H,G,F);Ae.setMaterial(G,he);let Me=H.index,Ne=1;if(G.wireframe===!0){if(Me=te.getWireframeAttribute(H),Me===void 0)return;Ne=2}const ke=H.drawRange,Re=H.attributes.position;let Qe=ke.start*Ne,nt=(ke.start+ke.count)*Ne;ie!==null&&(Qe=Math.max(Qe,ie.start*Ne),nt=Math.min(nt,(ie.start+ie.count)*Ne)),Me!==null?(Qe=Math.max(Qe,0),nt=Math.min(nt,Me.count)):Re!=null&&(Qe=Math.max(Qe,0),nt=Math.min(nt,Re.count));const vt=nt-Qe;if(vt<0||vt===1/0)return;ct.setup(F,G,_e,H,Me);let xt,et=ye;if(Me!==null&&(xt=J.get(Me),et=Ke,et.setIndex(xt)),F.isMesh)G.wireframe===!0?(Ae.setLineWidth(G.wireframeLinewidth*pt()),et.setMode(L.LINES)):et.setMode(L.TRIANGLES);else if(F.isLine){let Ce=G.linewidth;Ce===void 0&&(Ce=1),Ae.setLineWidth(Ce*pt()),F.isLineSegments?et.setMode(L.LINES):F.isLineLoop?et.setMode(L.LINE_LOOP):et.setMode(L.LINE_STRIP)}else F.isPoints?et.setMode(L.POINTS):F.isSprite&&et.setMode(L.TRIANGLES);if(F.isBatchedMesh)if(F._multiDrawInstances!==null)et.renderMultiDrawInstances(F._multiDrawStarts,F._multiDrawCounts,F._multiDrawCount,F._multiDrawInstances);else if(qe.get("WEBGL_multi_draw"))et.renderMultiDraw(F._multiDrawStarts,F._multiDrawCounts,F._multiDrawCount);else{const Ce=F._multiDrawStarts,It=F._multiDrawCounts,it=F._multiDrawCount,cn=Me?J.get(Me).bytesPerElement:1,Mi=Ee.get(G).currentProgram.getUniforms();for(let Kt=0;Kt<it;Kt++)Mi.setValue(L,"_gl_DrawID",Kt),et.render(Ce[Kt]/cn,It[Kt])}else if(F.isInstancedMesh)et.renderInstances(Qe,vt,F.count);else if(H.isInstancedBufferGeometry){const Ce=H._maxInstanceCount!==void 0?H._maxInstanceCount:1/0,It=Math.min(H.instanceCount,Ce);et.renderInstances(Qe,vt,It)}else et.render(Qe,vt)};function at(S,k,H){S.transparent===!0&&S.side===rn&&S.forceSinglePass===!1?(S.side=Gt,S.needsUpdate=!0,Ws(S,k,H),S.side=Vn,S.needsUpdate=!0,Ws(S,k,H),S.side=rn):Ws(S,k,H)}this.compile=function(S,k,H=null){H===null&&(H=S),p=Ze.get(H),p.init(k),y.push(p),H.traverseVisible(function(F){F.isLight&&F.layers.test(k.layers)&&(p.pushLight(F),F.castShadow&&p.pushShadow(F))}),S!==H&&S.traverseVisible(function(F){F.isLight&&F.layers.test(k.layers)&&(p.pushLight(F),F.castShadow&&p.pushShadow(F))}),p.setupLights();const G=new Set;return S.traverse(function(F){if(!(F.isMesh||F.isPoints||F.isLine||F.isSprite))return;const ie=F.material;if(ie)if(Array.isArray(ie))for(let he=0;he<ie.length;he++){const _e=ie[he];at(_e,H,F),G.add(_e)}else at(ie,H,F),G.add(ie)}),y.pop(),p=null,G},this.compileAsync=function(S,k,H=null){const G=this.compile(S,k,H);return new Promise(F=>{function ie(){if(G.forEach(function(he){Ee.get(he).currentProgram.isReady()&&G.delete(he)}),G.size===0){F(S);return}setTimeout(ie,10)}qe.get("KHR_parallel_shader_compile")!==null?ie():setTimeout(ie,10)})};let ln=null;function Cn(S){ln&&ln(S)}function fl(){ii.stop()}function pl(){ii.start()}const ii=new Wh;ii.setAnimationLoop(Cn),typeof self<"u"&&ii.setContext(self),this.setAnimationLoop=function(S){ln=S,Y.setAnimationLoop(S),S===null?ii.stop():ii.start()},Y.addEventListener("sessionstart",fl),Y.addEventListener("sessionend",pl),this.render=function(S,k){if(k!==void 0&&k.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(A===!0)return;if(S.matrixWorldAutoUpdate===!0&&S.updateMatrixWorld(),k.parent===null&&k.matrixWorldAutoUpdate===!0&&k.updateMatrixWorld(),Y.enabled===!0&&Y.isPresenting===!0&&(Y.cameraAutoUpdate===!0&&Y.updateCamera(k),k=Y.getCamera()),S.isScene===!0&&S.onBeforeRender(v,S,k,P),p=Ze.get(S,y.length),p.init(k),y.push(p),be.multiplyMatrices(k.projectionMatrix,k.matrixWorldInverse),X.setFromProjectionMatrix(be),le=this.localClippingEnabled,ee=se.init(this.clippingPlanes,le),g=xe.get(S,x.length),g.init(),x.push(g),Y.enabled===!0&&Y.isPresenting===!0){const ie=v.xr.getDepthSensingMesh();ie!==null&&jr(ie,k,-1/0,v.sortObjects)}jr(S,k,0,v.sortObjects),g.finish(),v.sortObjects===!0&&g.sort($,W),Xe=Y.enabled===!1||Y.isPresenting===!1||Y.hasDepthSensing()===!1,Xe&&Pe.addToRenderList(g,S),this.info.render.frame++,ee===!0&&se.beginShadows();const H=p.state.shadowsArray;ve.render(H,S,k),ee===!0&&se.endShadows(),this.info.autoReset===!0&&this.info.reset();const G=g.opaque,F=g.transmissive;if(p.setupLights(),k.isArrayCamera){const ie=k.cameras;if(F.length>0)for(let he=0,_e=ie.length;he<_e;he++){const Me=ie[he];gl(G,F,S,Me)}Xe&&Pe.render(S);for(let he=0,_e=ie.length;he<_e;he++){const Me=ie[he];ml(g,S,Me,Me.viewport)}}else F.length>0&&gl(G,F,S,k),Xe&&Pe.render(S),ml(g,S,k);P!==null&&T===0&&(R.updateMultisampleRenderTarget(P),R.updateRenderTargetMipmap(P)),S.isScene===!0&&S.onAfterRender(v,S,k),ct.resetDefaultState(),b=-1,M=null,y.pop(),y.length>0?(p=y[y.length-1],ee===!0&&se.setGlobalState(v.clippingPlanes,p.state.camera)):p=null,x.pop(),x.length>0?g=x[x.length-1]:g=null};function jr(S,k,H,G){if(S.visible===!1)return;if(S.layers.test(k.layers)){if(S.isGroup)H=S.renderOrder;else if(S.isLOD)S.autoUpdate===!0&&S.update(k);else if(S.isLight)p.pushLight(S),S.castShadow&&p.pushShadow(S);else if(S.isSprite){if(!S.frustumCulled||X.intersectsSprite(S)){G&&Ie.setFromMatrixPosition(S.matrixWorld).applyMatrix4(be);const he=K.update(S),_e=S.material;_e.visible&&g.push(S,he,_e,H,Ie.z,null)}}else if((S.isMesh||S.isLine||S.isPoints)&&(!S.frustumCulled||X.intersectsObject(S))){const he=K.update(S),_e=S.material;if(G&&(S.boundingSphere!==void 0?(S.boundingSphere===null&&S.computeBoundingSphere(),Ie.copy(S.boundingSphere.center)):(he.boundingSphere===null&&he.computeBoundingSphere(),Ie.copy(he.boundingSphere.center)),Ie.applyMatrix4(S.matrixWorld).applyMatrix4(be)),Array.isArray(_e)){const Me=he.groups;for(let Ne=0,ke=Me.length;Ne<ke;Ne++){const Re=Me[Ne],Qe=_e[Re.materialIndex];Qe&&Qe.visible&&g.push(S,he,Qe,H,Ie.z,Re)}}else _e.visible&&g.push(S,he,_e,H,Ie.z,null)}}const ie=S.children;for(let he=0,_e=ie.length;he<_e;he++)jr(ie[he],k,H,G)}function ml(S,k,H,G){const F=S.opaque,ie=S.transmissive,he=S.transparent;p.setupLightsView(H),ee===!0&&se.setGlobalState(v.clippingPlanes,H),G&&Ae.viewport(I.copy(G)),F.length>0&&Gs(F,k,H),ie.length>0&&Gs(ie,k,H),he.length>0&&Gs(he,k,H),Ae.buffers.depth.setTest(!0),Ae.buffers.depth.setMask(!0),Ae.buffers.color.setMask(!0),Ae.setPolygonOffset(!1)}function gl(S,k,H,G){if((H.isScene===!0?H.overrideMaterial:null)!==null)return;p.state.transmissionRenderTarget[G.id]===void 0&&(p.state.transmissionRenderTarget[G.id]=new _i(1,1,{generateMipmaps:!0,type:qe.has("EXT_color_buffer_half_float")||qe.has("EXT_color_buffer_float")?Os:Gn,minFilter:On,samples:4,stencilBuffer:s,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:Je.workingColorSpace}));const ie=p.state.transmissionRenderTarget[G.id],he=G.viewport||I;ie.setSize(he.z*v.transmissionResolutionScale,he.w*v.transmissionResolutionScale);const _e=v.getRenderTarget();v.setRenderTarget(ie),v.getClearColor(V),q=v.getClearAlpha(),q<1&&v.setClearColor(16777215,.5),v.clear(),Xe&&Pe.render(H);const Me=v.toneMapping;v.toneMapping=ni;const Ne=G.viewport;if(G.viewport!==void 0&&(G.viewport=void 0),p.setupLightsView(G),ee===!0&&se.setGlobalState(v.clippingPlanes,G),Gs(S,H,G),R.updateMultisampleRenderTarget(ie),R.updateRenderTargetMipmap(ie),qe.has("WEBGL_multisampled_render_to_texture")===!1){let ke=!1;for(let Re=0,Qe=k.length;Re<Qe;Re++){const nt=k[Re],vt=nt.object,xt=nt.geometry,et=nt.material,Ce=nt.group;if(et.side===rn&&vt.layers.test(G.layers)){const It=et.side;et.side=Gt,et.needsUpdate=!0,_l(vt,H,G,xt,et,Ce),et.side=It,et.needsUpdate=!0,ke=!0}}ke===!0&&(R.updateMultisampleRenderTarget(ie),R.updateRenderTargetMipmap(ie))}v.setRenderTarget(_e),v.setClearColor(V,q),Ne!==void 0&&(G.viewport=Ne),v.toneMapping=Me}function Gs(S,k,H){const G=k.isScene===!0?k.overrideMaterial:null;for(let F=0,ie=S.length;F<ie;F++){const he=S[F],_e=he.object,Me=he.geometry,Ne=G===null?he.material:G,ke=he.group;_e.layers.test(H.layers)&&_l(_e,k,H,Me,Ne,ke)}}function _l(S,k,H,G,F,ie){S.onBeforeRender(v,k,H,G,F,ie),S.modelViewMatrix.multiplyMatrices(H.matrixWorldInverse,S.matrixWorld),S.normalMatrix.getNormalMatrix(S.modelViewMatrix),F.onBeforeRender(v,k,H,G,S,ie),F.transparent===!0&&F.side===rn&&F.forceSinglePass===!1?(F.side=Gt,F.needsUpdate=!0,v.renderBufferDirect(H,k,G,F,S,ie),F.side=Vn,F.needsUpdate=!0,v.renderBufferDirect(H,k,G,F,S,ie),F.side=rn):v.renderBufferDirect(H,k,G,F,S,ie),S.onAfterRender(v,k,H,G,F,ie)}function Ws(S,k,H){k.isScene!==!0&&(k=$e);const G=Ee.get(S),F=p.state.lights,ie=p.state.shadowsArray,he=F.state.version,_e=Se.getParameters(S,F.state,ie,k,H),Me=Se.getProgramCacheKey(_e);let Ne=G.programs;G.environment=S.isMeshStandardMaterial?k.environment:null,G.fog=k.fog,G.envMap=(S.isMeshStandardMaterial?O:w).get(S.envMap||G.environment),G.envMapRotation=G.environment!==null&&S.envMap===null?k.environmentRotation:S.envMapRotation,Ne===void 0&&(S.addEventListener("dispose",Be),Ne=new Map,G.programs=Ne);let ke=Ne.get(Me);if(ke!==void 0){if(G.currentProgram===ke&&G.lightsStateVersion===he)return vl(S,_e),ke}else _e.uniforms=Se.getUniforms(S),S.onBeforeCompile(_e,v),ke=Se.acquireProgram(_e,Me),Ne.set(Me,ke),G.uniforms=_e.uniforms;const Re=G.uniforms;return(!S.isShaderMaterial&&!S.isRawShaderMaterial||S.clipping===!0)&&(Re.clippingPlanes=se.uniform),vl(S,_e),G.needsLights=au(S),G.lightsStateVersion=he,G.needsLights&&(Re.ambientLightColor.value=F.state.ambient,Re.lightProbe.value=F.state.probe,Re.directionalLights.value=F.state.directional,Re.directionalLightShadows.value=F.state.directionalShadow,Re.spotLights.value=F.state.spot,Re.spotLightShadows.value=F.state.spotShadow,Re.rectAreaLights.value=F.state.rectArea,Re.ltc_1.value=F.state.rectAreaLTC1,Re.ltc_2.value=F.state.rectAreaLTC2,Re.pointLights.value=F.state.point,Re.pointLightShadows.value=F.state.pointShadow,Re.hemisphereLights.value=F.state.hemi,Re.directionalShadowMap.value=F.state.directionalShadowMap,Re.directionalShadowMatrix.value=F.state.directionalShadowMatrix,Re.spotShadowMap.value=F.state.spotShadowMap,Re.spotLightMatrix.value=F.state.spotLightMatrix,Re.spotLightMap.value=F.state.spotLightMap,Re.pointShadowMap.value=F.state.pointShadowMap,Re.pointShadowMatrix.value=F.state.pointShadowMatrix),G.currentProgram=ke,G.uniformsList=null,ke}function xl(S){if(S.uniformsList===null){const k=S.currentProgram.getUniforms();S.uniformsList=Pr.seqWithValue(k.seq,S.uniforms)}return S.uniformsList}function vl(S,k){const H=Ee.get(S);H.outputColorSpace=k.outputColorSpace,H.batching=k.batching,H.batchingColor=k.batchingColor,H.instancing=k.instancing,H.instancingColor=k.instancingColor,H.instancingMorph=k.instancingMorph,H.skinning=k.skinning,H.morphTargets=k.morphTargets,H.morphNormals=k.morphNormals,H.morphColors=k.morphColors,H.morphTargetsCount=k.morphTargetsCount,H.numClippingPlanes=k.numClippingPlanes,H.numIntersection=k.numClipIntersection,H.vertexAlphas=k.vertexAlphas,H.vertexTangents=k.vertexTangents,H.toneMapping=k.toneMapping}function su(S,k,H,G,F){k.isScene!==!0&&(k=$e),R.resetTextureUnits();const ie=k.fog,he=G.isMeshStandardMaterial?k.environment:null,_e=P===null?v.outputColorSpace:P.isXRRenderTarget===!0?P.texture.colorSpace:qt,Me=(G.isMeshStandardMaterial?O:w).get(G.envMap||he),Ne=G.vertexColors===!0&&!!H.attributes.color&&H.attributes.color.itemSize===4,ke=!!H.attributes.tangent&&(!!G.normalMap||G.anisotropy>0),Re=!!H.morphAttributes.position,Qe=!!H.morphAttributes.normal,nt=!!H.morphAttributes.color;let vt=ni;G.toneMapped&&(P===null||P.isXRRenderTarget===!0)&&(vt=v.toneMapping);const xt=H.morphAttributes.position||H.morphAttributes.normal||H.morphAttributes.color,et=xt!==void 0?xt.length:0,Ce=Ee.get(G),It=p.state.lights;if(ee===!0&&(le===!0||S!==M)){const zt=S===M&&G.id===b;se.setState(G,S,zt)}let it=!1;G.version===Ce.__version?(Ce.needsLights&&Ce.lightsStateVersion!==It.state.version||Ce.outputColorSpace!==_e||F.isBatchedMesh&&Ce.batching===!1||!F.isBatchedMesh&&Ce.batching===!0||F.isBatchedMesh&&Ce.batchingColor===!0&&F.colorTexture===null||F.isBatchedMesh&&Ce.batchingColor===!1&&F.colorTexture!==null||F.isInstancedMesh&&Ce.instancing===!1||!F.isInstancedMesh&&Ce.instancing===!0||F.isSkinnedMesh&&Ce.skinning===!1||!F.isSkinnedMesh&&Ce.skinning===!0||F.isInstancedMesh&&Ce.instancingColor===!0&&F.instanceColor===null||F.isInstancedMesh&&Ce.instancingColor===!1&&F.instanceColor!==null||F.isInstancedMesh&&Ce.instancingMorph===!0&&F.morphTexture===null||F.isInstancedMesh&&Ce.instancingMorph===!1&&F.morphTexture!==null||Ce.envMap!==Me||G.fog===!0&&Ce.fog!==ie||Ce.numClippingPlanes!==void 0&&(Ce.numClippingPlanes!==se.numPlanes||Ce.numIntersection!==se.numIntersection)||Ce.vertexAlphas!==Ne||Ce.vertexTangents!==ke||Ce.morphTargets!==Re||Ce.morphNormals!==Qe||Ce.morphColors!==nt||Ce.toneMapping!==vt||Ce.morphTargetsCount!==et)&&(it=!0):(it=!0,Ce.__version=G.version);let cn=Ce.currentProgram;it===!0&&(cn=Ws(G,k,F));let Mi=!1,Kt=!1,cs=!1;const mt=cn.getUniforms(),en=Ce.uniforms;if(Ae.useProgram(cn.program)&&(Mi=!0,Kt=!0,cs=!0),G.id!==b&&(b=G.id,Kt=!0),Mi||M!==S){Ae.buffers.depth.getReversed()?(ae.copy(S.projectionMatrix),xd(ae),vd(ae),mt.setValue(L,"projectionMatrix",ae)):mt.setValue(L,"projectionMatrix",S.projectionMatrix),mt.setValue(L,"viewMatrix",S.matrixWorldInverse);const Yt=mt.map.cameraPosition;Yt!==void 0&&Yt.setValue(L,we.setFromMatrixPosition(S.matrixWorld)),je.logarithmicDepthBuffer&&mt.setValue(L,"logDepthBufFC",2/(Math.log(S.far+1)/Math.LN2)),(G.isMeshPhongMaterial||G.isMeshToonMaterial||G.isMeshLambertMaterial||G.isMeshBasicMaterial||G.isMeshStandardMaterial||G.isShaderMaterial)&&mt.setValue(L,"isOrthographic",S.isOrthographicCamera===!0),M!==S&&(M=S,Kt=!0,cs=!0)}if(F.isSkinnedMesh){mt.setOptional(L,F,"bindMatrix"),mt.setOptional(L,F,"bindMatrixInverse");const zt=F.skeleton;zt&&(zt.boneTexture===null&&zt.computeBoneTexture(),mt.setValue(L,"boneTexture",zt.boneTexture,R))}F.isBatchedMesh&&(mt.setOptional(L,F,"batchingTexture"),mt.setValue(L,"batchingTexture",F._matricesTexture,R),mt.setOptional(L,F,"batchingIdTexture"),mt.setValue(L,"batchingIdTexture",F._indirectTexture,R),mt.setOptional(L,F,"batchingColorTexture"),F._colorsTexture!==null&&mt.setValue(L,"batchingColorTexture",F._colorsTexture,R));const tn=H.morphAttributes;if((tn.position!==void 0||tn.normal!==void 0||tn.color!==void 0)&&De.update(F,H,cn),(Kt||Ce.receiveShadow!==F.receiveShadow)&&(Ce.receiveShadow=F.receiveShadow,mt.setValue(L,"receiveShadow",F.receiveShadow)),G.isMeshGouraudMaterial&&G.envMap!==null&&(en.envMap.value=Me,en.flipEnvMap.value=Me.isCubeTexture&&Me.isRenderTargetTexture===!1?-1:1),G.isMeshStandardMaterial&&G.envMap===null&&k.environment!==null&&(en.envMapIntensity.value=k.environmentIntensity),Kt&&(mt.setValue(L,"toneMappingExposure",v.toneMappingExposure),Ce.needsLights&&ru(en,cs),ie&&G.fog===!0&&ue.refreshFogUniforms(en,ie),ue.refreshMaterialUniforms(en,G,N,Q,p.state.transmissionRenderTarget[S.id]),Pr.upload(L,xl(Ce),en,R)),G.isShaderMaterial&&G.uniformsNeedUpdate===!0&&(Pr.upload(L,xl(Ce),en,R),G.uniformsNeedUpdate=!1),G.isSpriteMaterial&&mt.setValue(L,"center",F.center),mt.setValue(L,"modelViewMatrix",F.modelViewMatrix),mt.setValue(L,"normalMatrix",F.normalMatrix),mt.setValue(L,"modelMatrix",F.matrixWorld),G.isShaderMaterial||G.isRawShaderMaterial){const zt=G.uniformsGroups;for(let Yt=0,Kr=zt.length;Yt<Kr;Yt++){const si=zt[Yt];U.update(si,cn),U.bind(si,cn)}}return cn}function ru(S,k){S.ambientLightColor.needsUpdate=k,S.lightProbe.needsUpdate=k,S.directionalLights.needsUpdate=k,S.directionalLightShadows.needsUpdate=k,S.pointLights.needsUpdate=k,S.pointLightShadows.needsUpdate=k,S.spotLights.needsUpdate=k,S.spotLightShadows.needsUpdate=k,S.rectAreaLights.needsUpdate=k,S.hemisphereLights.needsUpdate=k}function au(S){return S.isMeshLambertMaterial||S.isMeshToonMaterial||S.isMeshPhongMaterial||S.isMeshStandardMaterial||S.isShadowMaterial||S.isShaderMaterial&&S.lights===!0}this.getActiveCubeFace=function(){return E},this.getActiveMipmapLevel=function(){return T},this.getRenderTarget=function(){return P},this.setRenderTargetTextures=function(S,k,H){Ee.get(S.texture).__webglTexture=k,Ee.get(S.depthTexture).__webglTexture=H;const G=Ee.get(S);G.__hasExternalTextures=!0,G.__autoAllocateDepthBuffer=H===void 0,G.__autoAllocateDepthBuffer||qe.has("WEBGL_multisampled_render_to_texture")===!0&&(console.warn("THREE.WebGLRenderer: Render-to-texture extension was disabled because an external texture was provided"),G.__useRenderToTexture=!1)},this.setRenderTargetFramebuffer=function(S,k){const H=Ee.get(S);H.__webglFramebuffer=k,H.__useDefaultFramebuffer=k===void 0};const ou=L.createFramebuffer();this.setRenderTarget=function(S,k=0,H=0){P=S,E=k,T=H;let G=!0,F=null,ie=!1,he=!1;if(S){const Me=Ee.get(S);if(Me.__useDefaultFramebuffer!==void 0)Ae.bindFramebuffer(L.FRAMEBUFFER,null),G=!1;else if(Me.__webglFramebuffer===void 0)R.setupRenderTarget(S);else if(Me.__hasExternalTextures)R.rebindTextures(S,Ee.get(S.texture).__webglTexture,Ee.get(S.depthTexture).__webglTexture);else if(S.depthBuffer){const Re=S.depthTexture;if(Me.__boundDepthTexture!==Re){if(Re!==null&&Ee.has(Re)&&(S.width!==Re.image.width||S.height!==Re.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");R.setupDepthRenderbuffer(S)}}const Ne=S.texture;(Ne.isData3DTexture||Ne.isDataArrayTexture||Ne.isCompressedArrayTexture)&&(he=!0);const ke=Ee.get(S).__webglFramebuffer;S.isWebGLCubeRenderTarget?(Array.isArray(ke[k])?F=ke[k][H]:F=ke[k],ie=!0):S.samples>0&&R.useMultisampledRTT(S)===!1?F=Ee.get(S).__webglMultisampledFramebuffer:Array.isArray(ke)?F=ke[H]:F=ke,I.copy(S.viewport),B.copy(S.scissor),z=S.scissorTest}else I.copy(re).multiplyScalar(N).floor(),B.copy(me).multiplyScalar(N).floor(),z=Ue;if(H!==0&&(F=ou),Ae.bindFramebuffer(L.FRAMEBUFFER,F)&&G&&Ae.drawBuffers(S,F),Ae.viewport(I),Ae.scissor(B),Ae.setScissorTest(z),ie){const Me=Ee.get(S.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_CUBE_MAP_POSITIVE_X+k,Me.__webglTexture,H)}else if(he){const Me=Ee.get(S.texture),Ne=k;L.framebufferTextureLayer(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,Me.__webglTexture,H,Ne)}else if(S!==null&&H!==0){const Me=Ee.get(S.texture);L.framebufferTexture2D(L.FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,Me.__webglTexture,H)}b=-1},this.readRenderTargetPixels=function(S,k,H,G,F,ie,he){if(!(S&&S.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let _e=Ee.get(S).__webglFramebuffer;if(S.isWebGLCubeRenderTarget&&he!==void 0&&(_e=_e[he]),_e){Ae.bindFramebuffer(L.FRAMEBUFFER,_e);try{const Me=S.texture,Ne=Me.format,ke=Me.type;if(!je.textureFormatReadable(Ne)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!je.textureTypeReadable(ke)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}k>=0&&k<=S.width-G&&H>=0&&H<=S.height-F&&L.readPixels(k,H,G,F,ze.convert(Ne),ze.convert(ke),ie)}finally{const Me=P!==null?Ee.get(P).__webglFramebuffer:null;Ae.bindFramebuffer(L.FRAMEBUFFER,Me)}}},this.readRenderTargetPixelsAsync=async function(S,k,H,G,F,ie,he){if(!(S&&S.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let _e=Ee.get(S).__webglFramebuffer;if(S.isWebGLCubeRenderTarget&&he!==void 0&&(_e=_e[he]),_e){const Me=S.texture,Ne=Me.format,ke=Me.type;if(!je.textureFormatReadable(Ne))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!je.textureTypeReadable(ke))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");if(k>=0&&k<=S.width-G&&H>=0&&H<=S.height-F){Ae.bindFramebuffer(L.FRAMEBUFFER,_e);const Re=L.createBuffer();L.bindBuffer(L.PIXEL_PACK_BUFFER,Re),L.bufferData(L.PIXEL_PACK_BUFFER,ie.byteLength,L.STREAM_READ),L.readPixels(k,H,G,F,ze.convert(Ne),ze.convert(ke),0);const Qe=P!==null?Ee.get(P).__webglFramebuffer:null;Ae.bindFramebuffer(L.FRAMEBUFFER,Qe);const nt=L.fenceSync(L.SYNC_GPU_COMMANDS_COMPLETE,0);return L.flush(),await _d(L,nt,4),L.bindBuffer(L.PIXEL_PACK_BUFFER,Re),L.getBufferSubData(L.PIXEL_PACK_BUFFER,0,ie),L.deleteBuffer(Re),L.deleteSync(nt),ie}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")}},this.copyFramebufferToTexture=function(S,k=null,H=0){S.isTexture!==!0&&(Fi("WebGLRenderer: copyFramebufferToTexture function signature has changed."),k=arguments[0]||null,S=arguments[1]);const G=Math.pow(2,-H),F=Math.floor(S.image.width*G),ie=Math.floor(S.image.height*G),he=k!==null?k.x:0,_e=k!==null?k.y:0;R.setTexture2D(S,0),L.copyTexSubImage2D(L.TEXTURE_2D,H,0,0,he,_e,F,ie),Ae.unbindTexture()};const lu=L.createFramebuffer(),cu=L.createFramebuffer();this.copyTextureToTexture=function(S,k,H=null,G=null,F=0,ie=null){S.isTexture!==!0&&(Fi("WebGLRenderer: copyTextureToTexture function signature has changed."),G=arguments[0]||null,S=arguments[1],k=arguments[2],ie=arguments[3]||0,H=null),ie===null&&(F!==0?(Fi("WebGLRenderer: copyTextureToTexture function signature has changed to support src and dst mipmap levels."),ie=F,F=0):ie=0);let he,_e,Me,Ne,ke,Re,Qe,nt,vt;const xt=S.isCompressedTexture?S.mipmaps[ie]:S.image;if(H!==null)he=H.max.x-H.min.x,_e=H.max.y-H.min.y,Me=H.isBox3?H.max.z-H.min.z:1,Ne=H.min.x,ke=H.min.y,Re=H.isBox3?H.min.z:0;else{const tn=Math.pow(2,-F);he=Math.floor(xt.width*tn),_e=Math.floor(xt.height*tn),S.isDataArrayTexture?Me=xt.depth:S.isData3DTexture?Me=Math.floor(xt.depth*tn):Me=1,Ne=0,ke=0,Re=0}G!==null?(Qe=G.x,nt=G.y,vt=G.z):(Qe=0,nt=0,vt=0);const et=ze.convert(k.format),Ce=ze.convert(k.type);let It;k.isData3DTexture?(R.setTexture3D(k,0),It=L.TEXTURE_3D):k.isDataArrayTexture||k.isCompressedArrayTexture?(R.setTexture2DArray(k,0),It=L.TEXTURE_2D_ARRAY):(R.setTexture2D(k,0),It=L.TEXTURE_2D),L.pixelStorei(L.UNPACK_FLIP_Y_WEBGL,k.flipY),L.pixelStorei(L.UNPACK_PREMULTIPLY_ALPHA_WEBGL,k.premultiplyAlpha),L.pixelStorei(L.UNPACK_ALIGNMENT,k.unpackAlignment);const it=L.getParameter(L.UNPACK_ROW_LENGTH),cn=L.getParameter(L.UNPACK_IMAGE_HEIGHT),Mi=L.getParameter(L.UNPACK_SKIP_PIXELS),Kt=L.getParameter(L.UNPACK_SKIP_ROWS),cs=L.getParameter(L.UNPACK_SKIP_IMAGES);L.pixelStorei(L.UNPACK_ROW_LENGTH,xt.width),L.pixelStorei(L.UNPACK_IMAGE_HEIGHT,xt.height),L.pixelStorei(L.UNPACK_SKIP_PIXELS,Ne),L.pixelStorei(L.UNPACK_SKIP_ROWS,ke),L.pixelStorei(L.UNPACK_SKIP_IMAGES,Re);const mt=S.isDataArrayTexture||S.isData3DTexture,en=k.isDataArrayTexture||k.isData3DTexture;if(S.isDepthTexture){const tn=Ee.get(S),zt=Ee.get(k),Yt=Ee.get(tn.__renderTarget),Kr=Ee.get(zt.__renderTarget);Ae.bindFramebuffer(L.READ_FRAMEBUFFER,Yt.__webglFramebuffer),Ae.bindFramebuffer(L.DRAW_FRAMEBUFFER,Kr.__webglFramebuffer);for(let si=0;si<Me;si++)mt&&(L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,Ee.get(S).__webglTexture,F,Re+si),L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,Ee.get(k).__webglTexture,ie,vt+si)),L.blitFramebuffer(Ne,ke,he,_e,Qe,nt,he,_e,L.DEPTH_BUFFER_BIT,L.NEAREST);Ae.bindFramebuffer(L.READ_FRAMEBUFFER,null),Ae.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else if(F!==0||S.isRenderTargetTexture||Ee.has(S)){const tn=Ee.get(S),zt=Ee.get(k);Ae.bindFramebuffer(L.READ_FRAMEBUFFER,lu),Ae.bindFramebuffer(L.DRAW_FRAMEBUFFER,cu);for(let Yt=0;Yt<Me;Yt++)mt?L.framebufferTextureLayer(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,tn.__webglTexture,F,Re+Yt):L.framebufferTexture2D(L.READ_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,tn.__webglTexture,F),en?L.framebufferTextureLayer(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,zt.__webglTexture,ie,vt+Yt):L.framebufferTexture2D(L.DRAW_FRAMEBUFFER,L.COLOR_ATTACHMENT0,L.TEXTURE_2D,zt.__webglTexture,ie),F!==0?L.blitFramebuffer(Ne,ke,he,_e,Qe,nt,he,_e,L.COLOR_BUFFER_BIT,L.NEAREST):en?L.copyTexSubImage3D(It,ie,Qe,nt,vt+Yt,Ne,ke,he,_e):L.copyTexSubImage2D(It,ie,Qe,nt,Ne,ke,he,_e);Ae.bindFramebuffer(L.READ_FRAMEBUFFER,null),Ae.bindFramebuffer(L.DRAW_FRAMEBUFFER,null)}else en?S.isDataTexture||S.isData3DTexture?L.texSubImage3D(It,ie,Qe,nt,vt,he,_e,Me,et,Ce,xt.data):k.isCompressedArrayTexture?L.compressedTexSubImage3D(It,ie,Qe,nt,vt,he,_e,Me,et,xt.data):L.texSubImage3D(It,ie,Qe,nt,vt,he,_e,Me,et,Ce,xt):S.isDataTexture?L.texSubImage2D(L.TEXTURE_2D,ie,Qe,nt,he,_e,et,Ce,xt.data):S.isCompressedTexture?L.compressedTexSubImage2D(L.TEXTURE_2D,ie,Qe,nt,xt.width,xt.height,et,xt.data):L.texSubImage2D(L.TEXTURE_2D,ie,Qe,nt,he,_e,et,Ce,xt);L.pixelStorei(L.UNPACK_ROW_LENGTH,it),L.pixelStorei(L.UNPACK_IMAGE_HEIGHT,cn),L.pixelStorei(L.UNPACK_SKIP_PIXELS,Mi),L.pixelStorei(L.UNPACK_SKIP_ROWS,Kt),L.pixelStorei(L.UNPACK_SKIP_IMAGES,cs),ie===0&&k.generateMipmaps&&L.generateMipmap(It),Ae.unbindTexture()},this.copyTextureToTexture3D=function(S,k,H=null,G=null,F=0){return S.isTexture!==!0&&(Fi("WebGLRenderer: copyTextureToTexture3D function signature has changed."),H=arguments[0]||null,G=arguments[1]||null,S=arguments[2],k=arguments[3],F=arguments[4]||0),Fi('WebGLRenderer: copyTextureToTexture3D function has been deprecated. Use "copyTextureToTexture" instead.'),this.copyTextureToTexture(S,k,H,G,F)},this.initRenderTarget=function(S){Ee.get(S).__webglFramebuffer===void 0&&R.setupRenderTarget(S)},this.initTexture=function(S){S.isCubeTexture?R.setTextureCube(S,0):S.isData3DTexture?R.setTexture3D(S,0):S.isDataArrayTexture||S.isCompressedArrayTexture?R.setTexture2DArray(S,0):R.setTexture2D(S,0),Ae.unbindTexture()},this.resetState=function(){E=0,T=0,P=null,Ae.reset(),ct.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return zn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;const t=this.getContext();t.drawingBufferColorspace=Je._getDrawingBufferColorSpace(e),t.unpackColorSpace=Je._getUnpackColorSpace()}}const ge={title:"Ember Sanctum",version:"3.0.0",hudHearts:5,arenaRadius:14,maxWaves:30,levelsPerRealm:5,wavesPerLevel:6,playerMaxHp:120,playerSpeed:9,playerAccel:42,playerFriction:18,dodgeSpeed:24,dodgeDuration:.2,dodgeCooldown:.95,dodgeIFrames:.28,hitStopMax:.08,comboDecay:2.8,comboStep:.18,comboMax:4,cameraHeight:16.5,cameraOffset:12.5,cameraFov:44,spawnEdgeInset:1.2,enemySepForce:7.2,waveGap:1.15,warriorModeKey:"V",warriorModeCooldown:.35},zr=[[4,4,5,5,6],[4,5,5,6,6],[5,5,6,6,7],[5,6,6,7,7],[5,6,7,7,8]];function yi(r=0,e=1){const t=zr[Math.max(0,Math.min(4,r|0))]||zr[0],n=Math.max(1,Math.min(ge.levelsPerRealm,e|0));return t[n-1]||5}function Bc(r=0){const e=zr[Math.max(0,Math.min(4,r|0))]||zr[0];let t=99,n=0;for(const i of e)i<t&&(t=i),i>n&&(n=i);return{min:t,max:n}}function Hr(r=0){let e=0;const t=ge.levelsPerRealm;for(let n=1;n<=t;n++)e+=yi(r,n);return e}function C_(r,e){let t=1;for(let n=1;n<e;n++)t+=yi(r,n);return t}function $r(r,e=0){let t=0;const n=ge.levelsPerRealm;for(let i=1;i<=n;i++)if(t+=yi(e,i),r<=t)return i;return n}function Ir(r,e=0){let t=0;const n=ge.levelsPerRealm;for(let i=1;i<=n;i++){const s=yi(e,i);if(r<=t+s)return Math.max(1,r-t);t+=s}return 1}function Da(r,e=0){return yi(e,$r(r,e))}const Kh="ember_sanctum_settings_v1";function Lr(){return{music:.34,sfx:.9,muted:!1,invertY:!1}}function P_(){try{const r=localStorage.getItem(Kh);return r?{...Lr(),...JSON.parse(r)}:Lr()}catch{return Lr()}}function I_(r){try{localStorage.setItem(Kh,JSON.stringify(r))}catch{}}const Bs={id:"twoHand",label:"Two-Handed",short:"2H",icon:"⚔",weapon:"greatblade",abilities:{attack:{id:"attack",name:"Heavy Slash",key:"LMB",icon:"⚔",cooldown:.32,damage:24,range:3.15,arc:Math.PI*1.2,knockback:6.2,lunge:1.6,element:"ember"},q:{id:"q",name:"Whirlwind",key:"1",icon:"🌀",cooldown:5.2,damage:14,radius:4,ticks:4,mode:"whirlwind",element:"ember"},e:{id:"e",name:"Ground Slam",key:"2",icon:"💥",cooldown:5.6,damage:32,radius:4.4,shockDuration:1.1,mode:"groundslam",element:"earth"},r:{id:"r",name:"Earthsplitter",key:"3",icon:"⛏",cooldown:6.4,damage:34,distance:8.5,width:2.4,shockDuration:.85,mode:"earthsplitter",element:"earth"},dodge:{id:"dodge",name:"Sidestep",key:"Shift",icon:"⇢",cooldown:1.05}}},L_={id:"swordShield",label:"Sword & Shield",short:"S&S",icon:"🛡",weapon:"sword_shield",abilities:{attack:{id:"attack",name:"Frontal Swipe",key:"LMB",icon:"🗡",cooldown:.26,damage:16,range:2.55,arc:Math.PI*.95,knockback:4.2,lunge:1.1,element:"ember"},q:{id:"q",name:"Block",key:"1",icon:"🛡",cooldown:4.2,damage:0,duration:1.35,damageMul:.22,reflectShock:.7,mode:"block",element:"earth"},e:{id:"e",name:"Shield Bash",key:"2",icon:"🔰",cooldown:5,damage:22,range:3.2,chains:1,shockDuration:1.5,mode:"bash",knockback:9.2,element:"earth"},r:{id:"r",name:"Phalanx Rush",key:"3",icon:"➤",cooldown:5.8,damage:26,distance:6.4,width:2,iframe:.38,shockDuration:.55,mode:"charge",element:"solar"},dodge:{id:"dodge",name:"Sidestep",key:"Shift",icon:"⇢",cooldown:1}}},Xt={warrior:{id:"warrior",name:"Crucible Knight",tagline:"2H bruiser · Sword & Shield (V)",color:12730636,accent:16498468,secondary:8330525,skin:16109765,weapon:"greatblade",maxHp:145,speed:8.2,icon:"⚔",hasWeaponModes:!0,defaultMode:"twoHand",modes:{twoHand:Bs,swordShield:L_},abilities:Bs.abilities},mage:{id:"mage",name:"Storm Adept",tagline:"Arcane · Frost · Lightning · Fire",color:7153881,accent:10859772,secondary:3223169,skin:15324671,weapon:"staff",maxHp:100,speed:8.6,icon:"✦",abilities:{attack:{id:"attack",name:"Arc Bolt",key:"LMB",icon:"✦",cooldown:.34,damage:15,range:8.5,arc:Math.PI*.55,knockback:2.2,lunge:.25,ranged:!0,projectile:"arcane",speed:22,element:"arcane"},q:{id:"q",name:"Frost Nova",key:"1",icon:"❄",cooldown:5.4,damage:28,radius:5,burnDps:0,burnDuration:0,frost:!0,element:"frost"},e:{id:"e",name:"Storm Lash",key:"2",icon:"⚡",cooldown:5.2,damage:20,range:9.5,chains:6,shockDuration:1.35,mode:"stormlash",element:"lightning"},r:{id:"r",name:"Fireball",key:"3",icon:"🔥",cooldown:5.6,damage:38,range:10.5,radius:3.6,burnDps:12,burnDuration:2.2,projectile:"fireball",speed:14,mode:"fireball",element:"fire"},dodge:{id:"dodge",name:"Phase Step",key:"Shift",icon:"⇢",cooldown:.85}}},rogue:{id:"rogue",name:"Umbral Ranger",tagline:"Shadow bow · precision archer",color:1013358,accent:3003583,secondary:1265226,skin:16570813,weapon:"bow",maxHp:108,speed:10.2,icon:"🏹",abilities:{attack:{id:"attack",name:"Piercing Shot",key:"LMB",icon:"🏹",cooldown:.3,damage:17,range:11,arc:Math.PI*.28,knockback:2.8,lunge:.05,ranged:!0,projectile:"arrow",speed:28,element:"shadow"},q:{id:"q",name:"Shadow Volley",key:"1",icon:"🌧",cooldown:5,damage:11,radius:5.2,burnDps:0,burnDuration:0,volley:!0,arrows:7,element:"shadow"},e:{id:"e",name:"Fan Shot",key:"2",icon:"◎",cooldown:5.2,damage:13,range:9.5,chains:5,shockDuration:.55,mode:"multishot",arrows:5,spread:.55,element:"shadow"},r:{id:"r",name:"Phantom Leap",key:"3",icon:"💨",cooldown:4.8,damage:18,distance:7.6,width:1.9,iframe:.55,mode:"charge",element:"void"},dodge:{id:"dodge",name:"Tumble",key:"Shift",icon:"⇢",cooldown:.72}}}},Vr=["warrior","mage","rogue"];function D_(r,e="twoHand"){const t=Xt[r]||Xt.warrior;return t.hasWeaponModes&&t.modes?(t.modes[e]||t.modes[t.defaultMode]||Bs).abilities:t.abilities}function Qn(r="twoHand"){return Xt.warrior.modes?.[r]||Xt.warrior.modes?.twoHand||Bs}Bs.abilities;const Lo={wisp:{id:"wisp",name:"Cinder Wisp",hp:28,speed:5.2,damage:8,radius:.55,score:40,color:16347926,accent:16498468,scale:.9,attackRange:1.3,attackCd:1},brute:{id:"brute",name:"Crag Brute",hp:95,speed:2.8,damage:18,radius:.95,score:90,color:7893356,accent:16557477,scale:1.25,attackRange:1.7,attackCd:1.45},stalker:{id:"stalker",name:"Umbral Stalker",hp:48,speed:6.4,damage:12,radius:.6,score:75,color:7020968,accent:15235577,scale:1,attackRange:1.4,attackCd:.95,blink:!0},stormling:{id:"stormling",name:"Stormling",hp:36,speed:4,damage:10,radius:.58,score:65,color:8141549,accent:10859772,scale:.95,attackRange:6.5,attackCd:1.6,ranged:!0,shockChance:.35},boss:{id:"boss",name:"Realm Warden",hp:420,speed:3.4,damage:24,radius:1.35,score:500,color:12131356,accent:16639626,scale:1.7,attackRange:2.2,attackCd:1.1,isBoss:!0}},Jh="ember_sanctum_progress_v1",Oc={ember:{id:"cinder_colossus",name:"Cinder Colossus",title:"Forge Tyrant",epithet:"First of the Wardens",element:"ember",color:12131356,accent:16347926,hpMul:1,damageMul:1,specials:["meteor_ring","ember_charge","lava_burst"],dialogue:[{speaker:"boss",name:"Cinder Colossus",text:"Another spark crawls into my crucible…"},{speaker:"player",name:"You",text:"I'm here for the Sanctum. Stand aside."},{speaker:"boss",name:"Cinder Colossus",text:"The forge remembers every fool who burned. Dance in my fire!"}]},frost:{id:"icebound_matron",name:"Icebound Matron",title:"Winter's Chain",epithet:"She who stills the circle",element:"frost",color:947344,accent:6809849,hpMul:1.08,damageMul:1,specials:["frost_nova","ice_shards","glacial_lock"],dialogue:[{speaker:"boss",name:"Icebound Matron",text:"You melted the Colossus… heat has no place here."},{speaker:"player",name:"You",text:"Then freeze. I'll break the ice either way."},{speaker:"boss",name:"Icebound Matron",text:"How far will your warmth carry? Kneel in the snow."}]},storm:{id:"volt_sovereign",name:"Volt Sovereign",title:"Thunder Crowned",epithet:"Stormspire's judgment",element:"lightning",color:5972406,accent:12891645,hpMul:1.12,damageMul:1.05,specials:["chain_bolt","static_field","thunder_dive"],dialogue:[{speaker:"boss",name:"Volt Sovereign",text:"Frost falls, fire fails… yet you climb my spire."},{speaker:"player",name:"You",text:"I've come too far to stop for thunder."},{speaker:"boss",name:"Volt Sovereign",text:"Then be ash in the lightning. SHOW ME YOUR CHARGE!"}]},umbral:{id:"void_herald",name:"Void Herald",title:"Whisper of the Fen",epithet:"Shadow between seals",element:"void",color:4850766,accent:15235577,hpMul:1.18,damageMul:1.08,specials:["void_blink","shadow_orbs","mire_pull"],dialogue:[{speaker:"boss",name:"Void Herald",text:"Storm-light dies in the fen. How did you crawl this deep?"},{speaker:"player",name:"You",text:"One realm at a time. You're next."},{speaker:"boss",name:"Void Herald",text:"Cute. The dark will unmake your name."}]},solar:{id:"solar_archon",name:"Solar Archon",title:"Last Light of the Sanctum",epithet:"Final Warden · End of the Path",element:"solar",color:11817737,accent:16639626,hpMul:1.35,damageMul:1.15,specials:["solar_beam","radiant_nova","judgment_slam"],dialogue:[{speaker:"boss",name:"Solar Archon",text:"…So you made it. Through fire, ice, storm, and void."},{speaker:"player",name:"You",text:"Every Warden said the same. The Sanctum ends with you."},{speaker:"boss",name:"Solar Archon",text:"Then stand in the light. If you fall, none will remember you tried."},{speaker:"player",name:"You",text:"I won't fall. Draw your sun."},{speaker:"boss",name:"Solar Archon",text:"FINAL SEAL — BREAK OR BURN!"}]}};function Ls(r){return Oc[r]||Oc.ember}const Lt=[{id:"ember",index:0,name:"Ember Crucible",subtitle:"Cracked volcanic stone & lava seams",clearTitle:"CRUCIBLE CLEARED",clearFlavor:"The forge-heart cools. Embers bow to the champion.",storyBeat:"The first seal: prove yourself in living fire.",floor:3871760,floorHi:10105874,floorLo:1837576,rim:15357964,rimGlow:16498468,rune:16347926,skyTop:2755080,skyBottom:787462,fog:1705990,fogNear:18,fogFar:55,ambient:16739133,ambientInt:.55,key:16757575,keyInt:1.35,fill:8138002,particle:"sparks",particleColor:16747069,portal:16734751,centerMotif:"sunburst",mods:{burnDurationMul:1.15,shockDurationMul:1,scoreMul:1},swatch:"linear-gradient(135deg,#7c2d12,#ea580c 50%,#fbbf24)",art:"assets/ui/realms/ember.jpg",bossId:"ember"},{id:"frost",index:1,name:"Frostveil Circle",subtitle:"Ice tiles, frost veins, crystal rim",clearTitle:"FROSTVEIL STILLED",clearFlavor:"Snow hangs mid-air. The circle accepts your claim.",storyBeat:"The second seal: endure the stilling cold.",floor:793124,floorHi:6809849,floorLo:536393,rim:10875900,rimGlow:14742270,rune:2282478,skyTop:728108,skyBottom:264722,fog:662056,fogNear:16,fogFar:52,ambient:8246268,ambientInt:.5,key:14742270,keyInt:1.2,fill:223649,particle:"snow",particleColor:14742270,portal:2282478,centerMotif:"snowflake",mods:{burnDurationMul:.85,shockDurationMul:1.1,frostPatchMul:1.35,scoreMul:1.05},swatch:"linear-gradient(135deg,#0c4a6e,#67e8f9 55%,#e0f2fe)",art:"assets/ui/realms/frost.jpg",bossId:"frost"},{id:"storm",index:2,name:"Stormspire Board",subtitle:"Basalt with lightning-inlaid runes",clearTitle:"STORM QUIETED",clearFlavor:"Thunder bows. The spire runes dim to violet hush.",storyBeat:"The third seal: answer the sky's judgment.",floor:1314847,floorHi:10980346,floorLo:722964,rim:12891645,rimGlow:16118783,rune:9133302,skyTop:1444648,skyBottom:394254,fog:1181726,fogNear:15,fogFar:50,ambient:10980346,ambientInt:.48,key:14538494,keyInt:1.25,fill:5972406,particle:"wind",particleColor:12891645,portal:11032055,centerMotif:"bolt",mods:{burnDurationMul:1,shockDurationMul:1.4,shockVfxMul:1.5,scoreMul:1.1},swatch:"linear-gradient(135deg,#2e1065,#7c3aed 50%,#e9d5ff)",art:"assets/ui/realms/storm.jpg",bossId:"storm"},{id:"umbral",index:3,name:"Umbral Fen",subtitle:"Obsidian swamp stone & void cracks",clearTitle:"FEN CLAIMED",clearFlavor:"Magenta fog parts. Silhouettes kneel in the mire.",storyBeat:"The fourth seal: walk the dark without becoming it.",floor:787986,floorHi:14239471,floorLo:1705248,rim:15235577,rimGlow:16109822,rune:12592851,skyTop:1312280,skyBottom:328200,fog:1180692,fogNear:12,fogFar:42,ambient:14239471,ambientInt:.38,key:15772668,keyInt:.95,fill:4850766,particle:"motes",particleColor:15235577,portal:14239471,centerMotif:"void",mods:{burnDurationMul:1,shockDurationMul:1.05,enemySpeedMul:1.08,scoreMul:1.15},swatch:"linear-gradient(135deg,#3b0764,#c026d3 50%,#f0abfc)",art:"assets/ui/realms/umbral.jpg",bossId:"umbral"},{id:"solar",index:4,name:"Solar Bastion",subtitle:"White-gold marble & sunburst seal",clearTitle:"BASTION TRIUMPH",clearFlavor:"God-rays crown the board. The sanctum remembers your name.",storyBeat:"The final seal: face the Archon. End the path.",floor:2760980,floorHi:16639626,floorLo:1840394,rim:16498468,rimGlow:16776171,rune:16096779,skyTop:2759176,skyBottom:788484,fog:1708552,fogNear:20,fogFar:60,ambient:16639626,ambientInt:.62,key:16775149,keyInt:1.55,fill:11817737,particle:"rays",particleColor:16639626,portal:16498468,centerMotif:"seal",mods:{burnDurationMul:1.1,shockDurationMul:1,scoreMul:1.25,playerDamageMul:1.05},swatch:"linear-gradient(135deg,#78350f,#fbbf24 50%,#fffbeb)",art:"assets/ui/realms/solar.jpg",bossId:"solar",isFinalRealm:!0}];function Na(r){return typeof r=="number"?Lt[r]??Lt[0]:Lt.find(e=>e.id===r)??Lt[0]}function N_(r){const e={uTime:{value:0},uColorA:{value:new Te(r.floorLo)},uColorB:{value:new Te(r.floor)},uColorC:{value:new Te(r.floorHi)},uRune:{value:new Te(r.rune)},uRadius:{value:ge.arenaRadius}};return new Sn({uniforms:e,transparent:!1,lights:!1,vertexShader:`
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,fragmentShader:`
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uColorC;
      uniform vec3 uRune;
      uniform float uRadius;
      varying vec2 vUv;
      varying vec3 vPos;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }

      void main() {
        float r = length(vPos.xz) / uRadius;
        // Near-static noise (scrolling noise on large floors reads as texture blink)
        float n = noise(vPos.xz * 0.45 + uTime * 0.008);
        float n2 = noise(vPos.xz * 1.4 - uTime * 0.01);
        vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 0.85, r));
        col = mix(col, uColorC, n * 0.35 + n2 * 0.15);

        // Cracks / veins — static (animated high-contrast noise reads as texture blink)
        float cracks = smoothstep(0.62, 0.72, n2) * (1.0 - smoothstep(0.78, 0.95, r));
        col += uColorC * cracks * 0.35;

        // Concentric rune rings — very slow, low amplitude
        float rings = abs(sin((r * 8.0 - uTime * 0.08) * 3.14159));
        rings = smoothstep(0.9, 1.0, rings) * smoothstep(0.95, 0.4, r);
        col += uRune * rings * 0.28;

        // Radial rune spokes — static angle, soft pulse only
        float ang = atan(vPos.z, vPos.x);
        float spokes = pow(abs(sin(ang * 6.0)), 18.0);
        spokes *= smoothstep(0.2, 0.45, r) * smoothstep(0.92, 0.7, r);
        float pulse = 0.85 + 0.15 * sin(uTime * 0.6);
        col += uRune * spokes * 0.22 * pulse;

        // Center glow
        float center = exp(-r * r * 8.0);
        col += uColorC * center * 0.28;

        // Soft edge vignette for board readability
        float edge = smoothstep(1.0, 0.82, r);
        col *= 0.55 + 0.45 * edge;

        gl_FragColor = vec4(col, 1.0);
      }
    `})}function U_(r){const e=new ht,t=new jt({color:r.rune,emissive:r.rune,emissiveIntensity:.85,metalness:.4,roughness:.35,transparent:!0,opacity:.9}),n=new jt({color:r.rimGlow,emissive:r.rim,emissiveIntensity:.5,metalness:.7,roughness:.25});if(r.centerMotif==="sunburst"||r.centerMotif==="seal"){const i=new D(new on(2.2,48),n);i.rotation.x=-Math.PI/2,i.position.y=.06,i.renderOrder=1,e.add(i);for(let s=0;s<12;s++){const a=new D(new We(.18,.06,1.6),t),o=s/12*Math.PI*2;a.position.set(Math.cos(o)*1.8,.05,Math.sin(o)*1.8),a.rotation.y=-o,e.add(a)}}else if(r.centerMotif==="snowflake"){for(let s=0;s<6;s++){const a=new D(new We(.12,.05,2.8),t);a.rotation.y=s/6*Math.PI,a.position.y=.05,e.add(a)}const i=new D(new ft(.45,.45,.08,6),n);i.position.y=.05,e.add(i)}else if(r.centerMotif==="bolt"){const i=[new C(.2,.05,-2),new C(-.3,.05,-.5),new C(.5,.05,-.3),new C(-.2,.05,2)];for(let s=0;s<i.length-1;s++){const a=i[s],o=i[s+1],l=a.clone().add(o).multiplyScalar(.5),c=a.distanceTo(o),h=new D(new We(.28,.08,c),t);h.position.copy(l),h.lookAt(o),h.rotateY(Math.PI/2),e.add(h)}}else if(r.centerMotif==="void"){const i=new D(new Rt(1.6,.12,12,48),t);i.rotation.x=Math.PI/2,i.position.y=.06,e.add(i);const s=new D(new on(1.1,32),new ut({color:328200}));s.rotation.x=-Math.PI/2,s.position.y=.03,e.add(s)}return e}function k_(r){const e=new ht,t=ge.arenaRadius,n=new jt({color:r.rim,emissive:r.rim,emissiveIntensity:.35,metalness:.65,roughness:.3}),i=new jt({color:1708064,metalness:.5,roughness:.55,emissive:r.floorLo,emissiveIntensity:.15}),s=new D(new Rt(t+.55,.35,16,96),n);s.rotation.x=Math.PI/2,s.position.y=.2,e.add(s);const a=new D(new Rt(t+.05,.12,10,96),new jt({color:r.rimGlow,emissive:r.rimGlow,emissiveIntensity:.55,metalness:.8,roughness:.2}));a.rotation.x=Math.PI/2,a.position.y=.28,e.add(a);const o=new D(new ft(t+.4,t+.7,.7,64,1,!0),i);o.position.y=-.35,e.add(o);const l=new D(new ft(t+.7,t+.9,.25,64),i);l.position.y=-.75,e.add(l);for(let c=0;c<12;c++){const h=c/12*Math.PI*2,u=Math.cos(h)*(t+.55),d=Math.sin(h)*(t+.55),f=new D(new ft(.14,.2,.9,8),n);f.position.set(u,.45,d),e.add(f);const m=new D(new Le(.16,12,12),new jt({color:r.rune,emissive:r.rune,emissiveIntensity:1.2}));m.position.set(u,1,d),e.add(m)}for(let c=0;c<10;c++){const h=Math.random()*Math.PI*2,u=t+1.5+Math.random()*2.5,d=new D(new Mn(.25+Math.random()*.25,0),new jt({color:r.rimGlow,emissive:r.rune,emissiveIntensity:.7,transparent:!0,opacity:.85}));d.position.set(Math.cos(h)*u,.8+Math.random()*1.5,Math.sin(h)*u),d.userData.baseY=d.position.y,d.userData.phase=Math.random()*Math.PI*2,d.userData.spin=.4+Math.random()*.8,e.add(d)}return e}function F_(r){const t=new Float32Array(360),n=ge.arenaRadius;for(let o=0;o<120;o++){const l=Math.random()*Math.PI*2,c=Math.sqrt(Math.random())*n*.95;t[o*3]=Math.cos(l)*c,t[o*3+1]=.3+Math.random()*4,t[o*3+2]=Math.sin(l)*c}const i=new Pt;i.setAttribute("position",new Ot(t,3));const s=new tl({color:r.particleColor,size:r.particle==="snow"?.18:.12,transparent:!0,opacity:.75,depthWrite:!1,blending:gn,sizeAttenuation:!0}),a=new Dh(i,s);return a.userData.kind=r.particle,a}function B_(r){const t=document.createElement("canvas");t.width=t.height=2048;const n=t.getContext("2d"),i=document.createElement("canvas");i.width=i.height=2048;const s=i.getContext("2d"),a=2048/2,o=2048/2,l=2048/2,c=(x,y=1)=>`rgba(${x>>16&255},${x>>8&255},${x&255},${y})`,h=(x,y)=>y==null?Math.random()*x:x+Math.random()*(y-x),u=c(r.floor),d=c(r.floorHi),f=c(r.floorLo),m=n.createRadialGradient(a,o,l*.08,a,o,l);m.addColorStop(0,d),m.addColorStop(.55,u),m.addColorStop(1,f),n.fillStyle=m,n.fillRect(0,0,2048,2048),n.strokeStyle="rgba(0,0,0,0.28)",n.lineWidth=3;for(let x=1;x<=6;x++)n.beginPath(),n.arc(a,o,l*(.14+x*.135),0,Math.PI*2),n.stroke();for(let x=0;x<28;x++){const y=x/28*Math.PI*2;n.beginPath(),n.moveTo(a+Math.cos(y)*l*.2,o+Math.sin(y)*l*.2),n.lineTo(a+Math.cos(y)*l*.96,o+Math.sin(y)*l*.96),n.stroke()}for(let x=0;x<500;x++){const y=h(Math.PI*2),v=Math.sqrt(Math.random())*l*.97;n.fillStyle=Math.random()<.5?"rgba(0,0,0,0.06)":"rgba(255,255,255,0.04)",n.beginPath(),n.arc(a+Math.cos(y)*v,o+Math.sin(y)*v,h(4,22),0,Math.PI*2),n.fill()}s.fillStyle="#000",s.fillRect(0,0,2048,2048);const _=(x,y,v,A,E)=>{for(const T of[n,s]){T.strokeStyle=T===n?c(r.rune,.75):c(r.rune),T.lineWidth=E,T.lineCap="round",T.beginPath(),T.moveTo(x,y);let P=x,b=y,M=v;const I=Math.floor(A/16);for(let B=0;B<I;B++)M+=h(-.5,.5),P+=Math.cos(M)*16,b+=Math.sin(M)*16,T.lineTo(P,b);T.stroke()}};for(let x=0;x<18;x++){const y=h(Math.PI*2),v=h(l*.2,l*.85);_(a+Math.cos(y)*v,o+Math.sin(y)*v,h(Math.PI*2),h(70,240),h(2,5))}const g="ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ",p=l*.88;for(const[x,y]of[[n,.9],[s,1]]){x.font=`${Math.floor(2048*.028)}px serif`,x.textAlign="center",x.textBaseline="middle",x.fillStyle=c(r.rimGlow,y);for(let v=0;v<32;v++){const A=v/32*Math.PI*2;x.save(),x.translate(a+Math.cos(A)*p,o+Math.sin(A)*p),x.rotate(A+Math.PI/2),x.fillText(g[v%g.length],0,0),x.restore()}x.strokeStyle=x.fillStyle,x.lineWidth=5,x.beginPath(),x.arc(a,o,l*.925,0,Math.PI*2),x.stroke()}return{albedo:t,emissive:i}}function Ua(r){const e=new ht;e.name=`arena_${r.id}`;let t;try{const u=B_(r),d=new sc(u.albedo);d.colorSpace=Mt,d.generateMipmaps=!1,d.minFilter=Dt,d.magFilter=Dt,d.anisotropy=1,d.wrapS=d.wrapT=yn;const f=new sc(u.emissive);f.generateMipmaps=!1,f.minFilter=Dt,f.magFilter=Dt,f.anisotropy=1,f.wrapS=f.wrapT=yn,t=new jt({map:d,emissiveMap:f,emissive:16777215,emissiveIntensity:.38,roughness:r.id==="frost"?.32:r.id==="solar"?.4:.82,metalness:r.id==="solar"?.28:.06,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1}),t.userData.albedoTex=d,t.userData.emisTex=f}catch{t=N_(r)}const n=ge.arenaRadius,i=new D(new on(n,96),t);i.rotation.x=-Math.PI/2,i.position.y=0,i.receiveShadow=!0,i.renderOrder=0,e.add(i);const s=new jt({color:r.floorLo,emissive:r.floorLo,emissiveIntensity:.12,metalness:.35,roughness:.75}),a=new D(new ft(n,n*.985,.85,96,1,!0),s);a.position.y=-.42,a.receiveShadow=!0,e.add(a);const o=new D(new on(n*.985,64),new jt({color:1050648,metalness:.4,roughness:.85}));o.rotation.x=Math.PI/2,o.position.y=-.84,e.add(o);const l=new D(new on(ge.arenaRadius*1.05,64),new ut({color:r.rim,transparent:!0,opacity:.16,blending:gn,depthWrite:!1,depthTest:!0}));l.rotation.x=-Math.PI/2,l.position.y=-.9,l.renderOrder=-1,e.add(l),e.add(U_(r));const c=k_(r);e.add(c);const h=F_(r);return e.add(h),{root:e,floorMat:t,particles:h,rim:c}}function ka(r,e){const t=[];r.traverse(d=>{d.userData?.arenaLight&&t.push(d)}),t.forEach(d=>r.remove(d)),r.background=new Te(e.skyBottom),r.fog=new Ko(e.fog,e.fogNear,e.fogFar);const n=r.getObjectByName("skyDome");n&&r.remove(n);const i=new Le(80,32,16),s=new Sn({side:Gt,depthWrite:!1,uniforms:{top:{value:new Te(e.skyTop)},bottom:{value:new Te(e.skyBottom)}},vertexShader:"varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",fragmentShader:"uniform vec3 top; uniform vec3 bottom; varying vec3 vPos; void main(){ float h=normalize(vPos).y*0.5+0.5; gl_FragColor=vec4(mix(bottom, top, h),1.0); }"}),a=new D(i,s);a.name="skyDome",r.add(a);const o=new cl(e.ambient,e.ambientInt);o.userData.arenaLight=!0,r.add(o);const l=new is(e.key,e.keyInt*.95);l.position.set(10,22,8),l.castShadow=!0,l.shadow.mapSize.set(2048,2048),l.shadow.bias=-15e-5,l.shadow.normalBias=.05,l.shadow.radius=2.5,l.shadow.camera.near=1,l.shadow.camera.far=55,l.shadow.camera.left=-22,l.shadow.camera.right=22,l.shadow.camera.top=22,l.shadow.camera.bottom=-22,l.userData.arenaLight=!0,r.add(l);const c=new is(e.fill,.48);c.position.set(-12,9,-10),c.userData.arenaLight=!0,r.add(c);const h=new Gh(e.key,e.floorLo||e.skyBottom,.42);h.userData.arenaLight=!0,r.add(h);const u=new ol(e.rimGlow,.85,48,2);u.position.set(0,7.5,0),u.userData.arenaLight=!0,r.add(u)}function zc(r,e){if(r){if(r.floorMat?.uniforms?.uTime&&(r.floorMat.uniforms.uTime.value=e),r.particles){const t=r.particles.geometry.attributes.position,n=r.particles.userData.kind;for(let i=0;i<t.count;i++){let s=t.getY(i);n==="sparks"||n==="rays"?(s+=.03+i%5*.004,s>5&&(s=.2)):n==="snow"?(s-=.02,s<.1&&(s=4.5),t.setX(i,t.getX(i)+Math.sin(e+i)*.004)):n==="wind"?(t.setX(i,t.getX(i)+.03),t.getX(i)>ge.arenaRadius&&t.setX(i,-14),s=.5+Math.sin(e*2+i)*.4):s=.8+Math.sin(e*1.5+i*.3)*.5+i%7*.15,t.setY(i,s)}t.needsUpdate=!0}r.root?.traverse(t=>{t.userData?.baseY!=null&&(t.position.y=t.userData.baseY+Math.sin(e*1.2+t.userData.phase)*.25,t.rotation.y+=.01*(t.userData.spin||1))})}}function ne(r,e=0,t=0,n={}){const i=new jt({color:r,emissive:e,emissiveIntensity:t,metalness:n.metalness??.28,roughness:n.roughness??.52,transparent:!!n.transparent,opacity:n.opacity??1,flatShading:!!n.flat});return i.userData.baseEm=t,i.userData.baseColor=r,i}function Zh(r,e=.55,t=.4){const n=new D(new on(e,28),new ut({color:0,transparent:!0,opacity:t,depthWrite:!1}));return n.rotation.x=-Math.PI/2,n.position.y=.04,n.renderOrder=2,r.add(n),n}function O_(r,e,t=1.05,n=1){const i=new D(new Qt(t*n,.12),new ut({color:789010,transparent:!0,opacity:.82,depthWrite:!1}));i.position.y=e;const s=new D(new Qt(t*n,.09),new ut({color:16347926,depthWrite:!1}));s.position.y=e,s.position.z=.02;const a=new D(new Qt(t*n+.06,.16),new ut({color:16498468,transparent:!0,opacity:.35,depthWrite:!1}));a.position.y=e,a.position.z=-.01,r.add(a),r.add(i),r.add(s),r.userData.hpBar=s,r.userData.hpBarBg=i,r.userData.hpBarFrame=a,r.userData.hpBarWidth=t*n}function Gr(r="warrior",e="twoHand"){const t=Xt[r]||Xt.warrior,n=t.color,i=t.accent,s=t.secondary,a=t.skin,o=t.id==="warrior",l=t.id==="mage";t.id;const c=o&&e==="swordShield"?"swordShield":"twoHand",h=new ht;h.name="player",h.userData.classId=t.id,h.userData.weaponMode=c;const u={metalness:.78,roughness:.28},d={metalness:.08,roughness:.78},f={metalness:.18,roughness:.68},m={metalness:.05,roughness:.55},_=ne(s,n,o?.22:.1,o?u:f),g=ne(1841431,i,.35,{metalness:.55,roughness:.35}),p={};for(const N of["L","R"]){const $=N==="L"?-1:1,W=new ht;W.position.set($*.17,.72,.02),h.add(W),p[N]=W;const re=new D(new $t(.13,.28,5,10),_);re.position.set(0,-.2,0),re.castShadow=!0,re.receiveShadow=!0,W.add(re);const me=new D(new $t(.11,.26,5,10),ne(o?2696484:s,n,.15,o?u:f));me.position.set(0,-.44,.01),me.castShadow=!0,W.add(me);const Ue=new D(new Le(.1,10,10),ne(i,n,.45,u));Ue.position.set(0,-.32,.1),Ue.scale.set(1,.75,.7),W.add(Ue);const X=new D(new We(.24,.14,.38),g);X.position.set(0,-.63,.06),X.castShadow=!0,W.add(X);const ee=new D(new We(.2,.1,.14),g);if(ee.position.set(0,-.64,.26),W.add(ee),o){const le=new D(new We(.2,.22,.18),ne(i,n,.4,u));le.position.set(0,-.5,.06),W.add(le)}}h.userData.legL=p.L,h.userData.legR=p.R;const x=new D(new ft(.28,.32,.22,12),ne(s,n,.2,f));x.position.y=.72,x.castShadow=!0,h.add(x);const y=new D(new Rt(.3,.035,8,20),ne(i,n,.7,u));y.position.y=.78,y.rotation.x=Math.PI/2,h.add(y);const v=new D(new We(.14,.1,.06),ne(i,i,1.1,u));v.position.set(0,.78,.32),h.add(v);const A=new D(new $t(l?.34:.36,l?.48:.5,8,16),ne(n,s,o?.55:.35,o?u:l?d:f));if(A.position.y=1.12,A.castShadow=!0,A.receiveShadow=!0,h.add(A),h.userData.body=A,o){const N=new D(new We(.48,.38,.16),ne(i,n,.85,u));N.position.set(0,1.18,.28),N.castShadow=!0,h.add(N);const $=new D(new Mn(.1,0),ne(16639626,16347926,1.6,{metalness:.3,roughness:.2}));$.position.set(0,1.2,.38),h.add($),h.userData.chestGem=$;for(let W=0;W<3;W++){const re=new D(new We(.4-W*.04,.1,.1),ne(n,i,.4,u));re.position.set(0,.95-W*.1,.26),h.add(re)}}else if(l){const N=new D(new wt(.55,.95,12,1,!0),ne(s,n,.35,d));N.position.set(0,.55,0),N.castShadow=!0,h.add(N);const $=new D(new We(.5,.12,.14),ne(i,n,.9,{metalness:.4,roughness:.3}));$.position.set(0,1.05,.22),h.add($);const W=new D(new Mn(.11,0),ne(i,i,1.8,{metalness:.25,roughness:.15}));W.position.set(0,1.22,.32),h.add(W),h.userData.chestGem=W}else{const N=new D(new We(.44,.42,.2),ne(n,i,.4,f));N.position.set(0,1.15,.18),N.castShadow=!0,h.add(N);for(const W of[-1,1]){const re=new D(new We(.08,.55,.04),ne(988970,i,.5,f));re.position.set(W*.12,1.2,.3),re.rotation.z=W*.35,h.add(re)}const $=new D(new on(.08,12),ne(i,i,1.2,u));$.position.set(0,1.25,.32),h.add($),h.userData.chestGem=$}const E=new D(new We(l?.78:.68,l?1.05:.9,.06),ne(s,n,.32,d));E.position.set(0,l?.9:.95,-.3),E.rotation.x=.2,E.castShadow=!0,h.add(E),h.userData.cape=E;const T=new D(new We(l?.8:.7,.06,.07),ne(i,n,.7,u));T.position.set(0,l?.42:.52,-.32),T.rotation.x=.2,h.add(T);const P=ne(n,s,.3,o?u:l?d:f),b={};for(const N of["L","R"]){const $=N==="L"?-1:1,W=new ht;W.position.set($*.42,1.38,.02),h.add(W),b[N]=W;const re=new D(new $t(.1,.28,5,10),P);re.position.set($*.06,-.2,.03),re.rotation.z=$*.28,re.castShadow=!0,W.add(re);const me=new D(new $t(.085,.26,5,10),ne(o?i:s,n,.25,o?u:f));me.position.set($*.16,-.46,.1),me.rotation.z=$*.12,me.rotation.x=-.2,me.castShadow=!0,W.add(me);const Ue=new D(new Le(.09,10,10),ne(a,0,0,m));Ue.position.set($*.2,-.6,.2),W.add(Ue);const X=new D(new Rt(.1,.025,6,12),ne(i,n,.55,u));X.position.set($*.16,-.34,.1),X.rotation.x=Math.PI/2,W.add(X)}h.userData.armL=b.L,h.userData.armR=b.R,h.userData.handR={x:.2,y:-.6,z:.2};const M=ne(i,n,.65,u);for(const N of[-1,1]){const $=new D(new Le(.22,14,12),M);if($.position.set(N*.42,1.38,.02),$.scale.set(1.15,.7,.95),$.castShadow=!0,h.add($),o){const W=new D(new wt(.07,.28,6),ne(i,n,.7,u));W.position.set(N*.5,1.55,0),W.rotation.z=N*-.45,h.add(W)}}const I=new D(new Le(.3,20,20),ne(a,0,0,m));I.position.y=1.68,I.castShadow=!0,h.add(I),h.userData.head=I;const B=new D(new ft(.12,.14,.14,10),ne(a,0,0,m));B.position.y=1.48,h.add(B);const z=ne(789010,i,1.4,{metalness:.2,roughness:.25});for(const N of[-1,1]){const $=new D(new Le(.048,10,10),z);$.position.set(N*.1,1.7,.26),h.add($);const W=new D(new Le(.018,6,6),new ut({color:16777215}));W.position.set(N*.1+.015,1.71,.3),h.add(W)}if(o){const N=new D(new Le(.33,16,14,0,Math.PI*2,0,Math.PI*.55),ne(n,i,.55,u));N.position.set(0,1.78,0),N.castShadow=!0,h.add(N);const $=new D(new We(.08,.38,.5),ne(16347926,i,.95,u));$.position.set(0,2,-.02),h.add($);for(const re of[-1,1]){const me=new D(new wt(.08,.32,7),ne(i,n,.55,u));me.position.set(re*.3,1.9,-.05),me.rotation.z=re*-.85,me.rotation.x=-.2,h.add(me)}const W=new D(new We(.36,.1,.08),ne(1841431,i,.6,u));W.position.set(0,1.72,.28),h.add(W)}else if(l){const N=new D(new wt(.48,.72,12),ne(s,n,.45,d));N.position.set(0,2.05,-.06),N.rotation.x=-.18,N.castShadow=!0,h.add(N);const $=new D(new Rt(.36,.04,8,20),ne(n,i,.5,d));$.position.set(0,1.78,-.02),$.rotation.x=Math.PI/2,h.add($);const W=new D(new Mn(.11,0),ne(i,i,2,{metalness:.2,roughness:.15}));W.position.set(0,1.82,.3),h.add(W),h.userData.headGem=W}else{const N=new D(new Le(.34,16,12,0,Math.PI*2,0,Math.PI*.58),ne(s,n,.35,f));N.position.set(0,1.78,-.04),N.rotation.x=.28,N.castShadow=!0,h.add(N);const $=new D(new We(.4,.16,.1),ne(988970,i,.9,f));$.position.set(0,1.6,.26),h.add($);const W=new D(new wt(.04,.35,5),ne(i,n,.6,d));W.position.set(.22,1.98,-.05),W.rotation.z=-.6,W.rotation.x=-.3,h.add(W)}const V=new ht,q=h.userData.handR;if(V.position.set(q.x,q.y,q.z),b.R.add(V),h.userData.weapon=V,h.userData.weaponRest={rx:0,ry:0,rz:0,px:q.x,py:q.y,pz:q.z},t.weapon==="staff"){h.userData.weaponStyle="staff",V.rotation.set(.15,0,.12),h.userData.weaponRest={rx:.15,ry:0,rz:.12,px:q.x,py:q.y,pz:q.z};const N=new D(new ft(.032,.045,1.7,10),ne(4472892,s,.2,{roughness:.7,metalness:.2}));N.position.set(0,.55,0),N.castShadow=!0,V.add(N);const $=new D(new ft(.05,.05,.18,10),ne(1841431,i,.35,f));$.position.set(0,.02,0),V.add($);for(let ee=0;ee<3;ee++){const le=new D(new Rt(.055,.014,6,12),ne(i,n,.9,u));le.position.set(0,.35+ee*.28,0),le.rotation.x=Math.PI/2,V.add(le)}const W=new D(new Le(.16,16,16),ne(i,i,1.8,{metalness:.25,roughness:.12}));W.position.set(0,1.35,0),V.add(W);const re=new D(new Le(.26,14,14),new ut({color:i,transparent:!0,opacity:.22,depthWrite:!1,blending:gn}));re.position.copy(W.position),V.add(re);const me=new D(new Rt(.22,.026,8,20),ne(n,i,1.1,u));me.position.copy(W.position),me.rotation.x=Math.PI/2,V.add(me);const Ue=me.clone();Ue.rotation.x=.4,Ue.scale.setScalar(.85),V.add(Ue);const X=new D(new Le(.05,8,8),ne(i,n,.7,u));X.position.set(0,-.28,0),V.add(X),h.userData.blade=W,h.userData.weaponOrb=W}else if(t.weapon==="bow"){h.userData.weaponStyle="bow",V.rotation.set(.05,.35,.15),V.position.set(q.x-.05,q.y+.05,q.z+.08),h.userData.weaponRest={rx:.05,ry:.35,rz:.15,px:q.x-.05,py:q.y+.05,pz:q.z+.08};const N=ne(s,i,.65,{metalness:.4,roughness:.35}),$=new D(new Rt(.52,.036,8,22,Math.PI*.88),N);$.rotation.y=Math.PI/2,$.rotation.z=Math.PI*.06,$.position.set(0,0,0),$.castShadow=!0,V.add($);const W=new D(new Rt(.52,.036,8,22,Math.PI*.88),N);W.rotation.y=Math.PI/2,W.rotation.z=Math.PI+Math.PI*.06,W.position.set(0,0,0),W.castShadow=!0,V.add(W);const re=new D(new ft(.05,.055,.28,10),ne(1841431,i,.35,f));re.position.set(0,0,0),V.add(re);const me=new D(new Rt(.055,.012,6,12),ne(i,n,.7,u));me.position.copy(re.position),me.rotation.x=Math.PI/2,V.add(me);const Ue=new D(new $t(.012,.88,3,6),ne(i,i,.9,{metalness:.5,roughness:.3}));Ue.position.set(0,0,0),V.add(Ue);const X=new ht,ee=new D(new ft(.018,.018,.95,7),ne(7877903,0,0,{roughness:.75}));ee.rotation.x=Math.PI/2,ee.position.set(.12,.02,.42),X.add(ee);const le=new D(new wt(.05,.14,6),ne(i,i,1.2,u));le.rotation.x=Math.PI/2,le.position.set(.12,.02,.92),X.add(le);for(let we=0;we<2;we++){const Ie=new D(new We(.12,.025,.09),ne(n,i,.7));Ie.position.set(.12,.02,.05),Ie.rotation.z=we*Math.PI/2,X.add(Ie)}V.add(X),h.userData.blade=X;const ae=new D(new ft(.1,.13,.6,10),ne(s,n,.3,f));ae.position.set(-.32,1.18,-.32),ae.rotation.z=.32,ae.rotation.x=.18,ae.castShadow=!0,h.add(ae);const be=new D(new Rt(.11,.02,6,12),ne(i,n,.6,u));be.position.set(-.28,1.46,-.28),be.rotation.x=Math.PI/2,be.rotation.z=.32,h.add(be);for(let we=0;we<4;we++){const Ie=new D(new ft(.012,.012,.4,5),ne(7877903,i,.3));Ie.position.set(-.3+(we-1.5)*.035,1.5,-.3),Ie.rotation.z=.32,h.add(Ie);const $e=new D(new wt(.025,.08,5),ne(i,i,.8,u));$e.position.set(-.28+(we-1.5)*.035,1.72,-.28),$e.rotation.z=.32,h.add($e)}}else{h.userData.weaponStyle=c==="swordShield"?"sword_shield":"greatblade",h.userData.weaponRest={rx:-.15,ry:.4,rz:.55,px:q.x,py:q.y,pz:q.z};const N=new ht;N.name="weapon2H",V.add(N);const $=new D(new ft(.04,.048,.38,10),ne(4472892,0,0,{roughness:.75}));$.position.set(0,0,0),N.add($);const W=new D(new Le(.07,10,10),ne(i,n,.9,u));W.position.set(0,-.22,0),N.add(W);const re=new D(new We(.42,.1,.12),ne(i,n,.7,u));re.position.set(0,.2,0),re.castShadow=!0,N.add(re);const me=new D(new We(.09,1.35,.055),ne(16708551,i,1,{metalness:.88,roughness:.14}));me.position.set(0,.9,0),me.castShadow=!0,N.add(me);const Ue=new D(new We(.04,1.3,.02),ne(16777215,i,.6,{metalness:.9,roughness:.1}));Ue.position.set(.04,.9,0),N.add(Ue);const X=new D(new Mn(.11,0),ne(i,n,1.4,u));X.position.set(0,1.62,0),N.add(X);for(let Nt=0;Nt<3;Nt++){const qe=new D(new Le(.035,8,8),ne(16347926,16498468,1.5,{metalness:.3,roughness:.2}));qe.position.set(0,.55+Nt*.28,.04),N.add(qe)}h.userData.weapon2H=N,h.userData.blade=me;const ee=new ht;ee.name="weaponSS",V.add(ee);const le=new D(new ft(.035,.04,.28,9),ne(2696484,0,0,{roughness:.7}));ee.add(le);const ae=new D(new Le(.055,9,9),ne(i,n,.85,u));ae.position.set(0,-.16,0),ee.add(ae);const be=new D(new We(.32,.07,.09),ne(i,n,.65,u));be.position.set(0,.14,0),ee.add(be);const we=new D(new We(.06,.85,.04),ne(16708551,i,.9,{metalness:.86,roughness:.16}));we.position.set(0,.58,0),we.castShadow=!0,ee.add(we);const Ie=new D(new wt(.045,.12,6),ne(16777215,i,.8,u));Ie.position.set(0,1.05,0),ee.add(Ie),h.userData.weaponSS=ee;const $e=new ht;$e.name="shield";const Xe=new D(new ft(.38,.42,.08,8),ne(n,i,.55,u));Xe.rotation.x=Math.PI/2,Xe.castShadow=!0,$e.add(Xe);const pt=new D(new Le(.1,10,10),ne(i,16498468,1.2,u));pt.position.z=.06,$e.add(pt);const L=new D(new Rt(.4,.03,6,16),ne(i,n,.7,u));L.position.z=.02,$e.add(L),$e.position.set(-.18,-.52,.28),$e.rotation.set(.25,.35,-.2),b.L.add($e),h.userData.shield=$e,Qh(h,c)}Zh(h,.68,.48);const j=new D(new Le(.95,18,18),new ut({color:n,transparent:!0,opacity:.09,depthWrite:!1,blending:gn}));j.position.y=1.05,h.add(j),h.userData.aura=j;const Q=new D(new Wi(.45,.58,32),new ut({color:i,transparent:!0,opacity:.35,depthWrite:!1,side:rn,blending:gn}));return Q.rotation.x=-Math.PI/2,Q.position.y=.05,h.add(Q),h.userData.groundRing=Q,h}function Hc(r){const e=Lo[r]||Lo.wisp,t=new ht;t.name=`enemy_${r}`;const n=e.scale;if(r==="brute"){const i=new D(new We(1.15*n,1.05*n,.85*n),ne(e.color,e.accent,.2,{flat:!0,roughness:.85,metalness:.15}));i.position.y=.95*n,i.castShadow=!0,t.add(i);for(const o of[-1,1]){const l=new D(new We(.35*n,.9*n,.35*n),ne(5722958,e.accent,.15,{flat:!0}));l.position.set(o*.75*n,.9*n,.1*n),l.castShadow=!0,t.add(l)}const s=new D(new We(.65*n,.5*n,.55*n),ne(2696484,e.accent,.35,{flat:!0}));s.position.y=1.7*n,t.add(s);const a=new D(new We(.4*n,.08*n,.08*n),ne(16557477,15680580,1.1));a.position.set(0,1.72*n,.3*n),t.add(a);for(let o=0;o<3;o++){const l=new D(new wt(.12*n,.45*n,5),ne(7893356,e.accent,.2,{flat:!0}));l.position.set((o-1)*.28*n,1.45*n,-.4*n),l.rotation.x=-.6,t.add(l)}}else if(r==="stalker"){const i=new D(new $t(.26*n,.75*n,5,12),ne(e.color,e.accent,.45,{roughness:.4}));i.position.y=.95*n,i.castShadow=!0,t.add(i);const s=new D(new Le(.3*n,14,14),ne(1970216,e.accent,.85));s.position.y=1.55*n,t.add(s);for(const a of[-1,1]){const o=new D(new Le(.07*n,8,8),ne(15235577,15235577,1.4));o.position.set(a*.1*n,1.58*n,.26*n),t.add(o)}for(const a of[-1,1]){const o=new D(new wt(.18*n,1*n,6),ne(e.color,e.accent,.35));o.position.set(a*.38*n,.75*n,-.25*n),o.rotation.z=a*.45,o.rotation.x=.3,t.add(o)}for(const a of[-1,1]){const o=new D(new We(.06*n,.08*n,.55*n),ne(15235577,12592851,.7,{metalness:.7}));o.position.set(a*.42*n,.85*n,.35*n),t.add(o)}}else if(r==="stormling"){const i=new D(new Mn(.52*n,1),ne(e.color,e.accent,.75,{metalness:.4,roughness:.3}));i.position.y=1.05*n,i.castShadow=!0,t.add(i);const s=new D(new Le(.22*n,12,12),ne(14739455,10859772,1.5));s.position.y=1.05*n,t.add(s);const a=new D(new Rt(.62*n,.055,10,32),ne(e.accent,e.accent,1.2,{metalness:.6}));a.position.y=1.05*n,a.rotation.x=Math.PI/2,t.add(a),t.userData.spin=a;for(let o=0;o<3;o++){const l=new D(new Le(.08*n,8,8),ne(12891645,10980346,1.3));l.position.set(Math.cos(o/3*Math.PI*2)*.7*n,1.05*n,Math.sin(o/3*Math.PI*2)*.7*n),t.add(l)}}else if(r==="boss"){const i=new D(new $t(.75*n,1.1*n,6,14),ne(e.color,e.accent,.4,{metalness:.35,roughness:.4}));i.position.y=1.5*n,i.castShadow=!0,t.add(i);const s=new D(new We(2.15*n,.45*n,.85*n),ne(4472892,e.color,.3,{metalness:.5}));s.position.y=2.05*n,t.add(s);const a=new D(new Le(.55*n,16,16),ne(1841431,e.accent,.55));a.position.y=2.65*n,t.add(a);for(const h of[-1,1]){const u=new D(new wt(.12*n,.7*n,6),ne(e.accent,e.accent,.9,{metalness:.6}));u.position.set(h*.35*n,3.15*n,-.05*n),u.rotation.z=h*-.35,t.add(u)}const o=new D(new wt(.32*n,.55*n,5),ne(e.accent,16639626,1.1));o.position.y=3.25*n,t.add(o);const l=new D(new We(.35*n,.12*n,.08*n),ne(16639626,16498468,1.4));l.position.set(0,2.65*n,.48*n),t.add(l);const c=new D(new We(1.6*n,1.4*n,.12*n),ne(8330525,e.color,.25,{roughness:.8}));c.position.set(0,1.4*n,-.55*n),t.add(c)}else{const i=new D(new Le(.38*n,16,16),ne(e.color,e.accent,.95,{metalness:.2,roughness:.35}));i.position.y=.9*n,i.castShadow=!0,t.add(i),t.userData.bob=i;const s=new D(new Le(.18*n,12,12),ne(16708551,16498468,1.6));s.position.y=.9*n,t.add(s);const a=new D(new Le(.62*n,14,14),new ut({color:e.accent,transparent:!0,opacity:.22,depthWrite:!1,blending:gn}));a.position.y=.9*n,t.add(a);for(let o=0;o<5;o++){const l=o/5*Math.PI*2,c=new D(new wt(.1*n,.4*n,5),ne(16498468,16347926,.9));c.position.set(Math.cos(l)*.22*n,1.25*n,Math.sin(l)*.22*n),t.add(c)}}return Zh(t,e.radius*1.15,.35),O_(t,r==="boss"?3.6*n:2.15*n,1.1,n),t}function At(r,e,t=ge.arenaRadius-.6){const n=Math.hypot(r,e);if(n<=t)return{x:r,z:e};const i=t/n;return{x:r*i,z:e*i}}function Qh(r,e="twoHand"){if(!r?.userData)return;const t=e==="swordShield";r.userData.weaponMode=t?"swordShield":"twoHand",r.userData.weaponStyle=t?"sword_shield":"greatblade",r.userData.weapon2H&&(r.userData.weapon2H.visible=!t),r.userData.weaponSS&&(r.userData.weaponSS.visible=t),r.userData.shield&&(r.userData.shield.visible=t),r.userData.blade&&r.userData.weapon2H&&(r.userData.blade=t?r.userData.weaponSS?.children?.find(i=>i.geometry?.type==="BoxGeometry")||r.userData.blade:r.userData.weapon2H.children?.find(i=>i.geometry?.type==="BoxGeometry")||r.userData.blade);const n=r.userData.weapon;n&&(t?(n.rotation.set(-.35,.15,.85),r.userData.weaponRest={rx:-.35,ry:.15,rz:.85,px:r.userData.handR?.x??.2,py:r.userData.handR?.y??-.6,pz:r.userData.handR?.z??.2}):(n.rotation.set(-.15,.4,.55),r.userData.weaponRest={rx:-.15,ry:.4,rz:.55,px:r.userData.handR?.x??.2,py:r.userData.handR?.y??-.6,pz:r.userData.handR?.z??.2})),r.userData.shield&&(r.userData.shield.rotation.set(.25,.35,-.2),r.userData.shield.position.set(-.18,-.52,.28))}function xs(r="warrior",e="twoHand"){const t=Xt[r]||Xt.warrior,n=t.hasWeaponModes&&e==="swordShield"?"swordShield":"twoHand";return{classId:t.id,weaponMode:t.hasWeaponModes?n:null,x:0,z:0,vx:0,vz:0,facing:0,hp:t.maxHp,maxHp:t.maxHp,invuln:0,dodgeT:0,attackAnim:0,attackAnimMax:.22,attackLunge:0,walkPhase:0,walkAmp:0,blockT:0,blockMax:0,blockDamageMul:1,alive:!0,statuses:{},mesh:null,actor:null}}function z_(r,e,t){const n=Lo[r];return{id:Math.random().toString(36).slice(2,9),typeId:r,def:n,x:e,z:t,hp:n.hp,maxHp:n.hp,riseT:0,riseMax:0,attackCd:.5+Math.random()*.5,blinkCd:2+Math.random()*2,hitFlash:0,stun:0,burn:0,burnDps:0,alive:!0,mesh:null,hurtTint:0,knockVx:0,knockVz:0}}function Vc(r,e){if(e===Vu)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),r;if(e===Eo||e===_h){let t=r.getIndex();if(t===null){const a=[],o=r.getAttribute("position");if(o!==void 0){for(let l=0;l<o.count;l++)a.push(l);r.setIndex(a),t=r.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),r}const n=t.count-2,i=[];if(e===Eo)for(let a=1;a<=n;a++)i.push(t.getX(0)),i.push(t.getX(a)),i.push(t.getX(a+1));else for(let a=0;a<n;a++)a%2===0?(i.push(t.getX(a)),i.push(t.getX(a+1)),i.push(t.getX(a+2))):(i.push(t.getX(a+2)),i.push(t.getX(a+1)),i.push(t.getX(a)));i.length/3!==n&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");const s=r.clone();return s.setIndex(i),s.clearGroups(),s}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",e),r}class H_ extends os{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(t){return new q_(t)}),this.register(function(t){return new Y_(t)}),this.register(function(t){return new nx(t)}),this.register(function(t){return new ix(t)}),this.register(function(t){return new sx(t)}),this.register(function(t){return new j_(t)}),this.register(function(t){return new K_(t)}),this.register(function(t){return new J_(t)}),this.register(function(t){return new Z_(t)}),this.register(function(t){return new X_(t)}),this.register(function(t){return new Q_(t)}),this.register(function(t){return new $_(t)}),this.register(function(t){return new tx(t)}),this.register(function(t){return new ex(t)}),this.register(function(t){return new G_(t)}),this.register(function(t){return new rx(t)}),this.register(function(t){return new ax(t)})}load(e,t,n,i){const s=this;let a;if(this.resourcePath!=="")a=this.resourcePath;else if(this.path!==""){const c=Is.extractUrlBase(e);a=Is.resolveURL(c,this.path)}else a=Is.extractUrlBase(e);this.manager.itemStart(e);const o=function(c){i?i(c):console.error(c),s.manager.itemError(e),s.manager.itemEnd(e)},l=new Vh(this.manager);l.setPath(this.path),l.setResponseType("arraybuffer"),l.setRequestHeader(this.requestHeader),l.setWithCredentials(this.withCredentials),l.load(e,function(c){try{s.parse(c,a,function(h){t(h),s.manager.itemEnd(e)},o)}catch(h){o(h)}},n,o)}setDRACOLoader(e){return this.dracoLoader=e,this}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,t,n,i){let s;const a={},o={},l=new TextDecoder;if(typeof e=="string")s=JSON.parse(e);else if(e instanceof ArrayBuffer)if(l.decode(new Uint8Array(e,0,4))===eu){try{a[Ye.KHR_BINARY_GLTF]=new ox(e)}catch(u){i&&i(u);return}s=JSON.parse(a[Ye.KHR_BINARY_GLTF].content)}else s=JSON.parse(l.decode(e));else s=e;if(s.asset===void 0||s.asset.version[0]<2){i&&i(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}const c=new yx(s,{path:t||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});c.fileLoader.setRequestHeader(this.requestHeader);for(let h=0;h<this.pluginCallbacks.length;h++){const u=this.pluginCallbacks[h](c);u.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),o[u.name]=u,a[u.name]=!0}if(s.extensionsUsed)for(let h=0;h<s.extensionsUsed.length;++h){const u=s.extensionsUsed[h],d=s.extensionsRequired||[];switch(u){case Ye.KHR_MATERIALS_UNLIT:a[u]=new W_;break;case Ye.KHR_DRACO_MESH_COMPRESSION:a[u]=new lx(s,this.dracoLoader);break;case Ye.KHR_TEXTURE_TRANSFORM:a[u]=new cx;break;case Ye.KHR_MESH_QUANTIZATION:a[u]=new hx;break;default:d.indexOf(u)>=0&&o[u]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+u+'".')}}c.setExtensions(a),c.setPlugins(o),c.parse(n,i)}parseAsync(e,t){const n=this;return new Promise(function(i,s){n.parse(e,t,i,s)})}}function V_(){let r={};return{get:function(e){return r[e]},add:function(e,t){r[e]=t},remove:function(e){delete r[e]},removeAll:function(){r={}}}}const Ye={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"};class G_{constructor(e){this.parser=e,this.name=Ye.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){const e=this.parser,t=this.parser.json.nodes||[];for(let n=0,i=t.length;n<i;n++){const s=t[n];s.extensions&&s.extensions[this.name]&&s.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,s.extensions[this.name].light)}}_loadLight(e){const t=this.parser,n="light:"+e;let i=t.cache.get(n);if(i)return i;const s=t.json,l=((s.extensions&&s.extensions[this.name]||{}).lights||[])[e];let c;const h=new Te(16777215);l.color!==void 0&&h.setRGB(l.color[0],l.color[1],l.color[2],qt);const u=l.range!==void 0?l.range:0;switch(l.type){case"directional":c=new is(h),c.target.position.set(0,0,-1),c.add(c.target);break;case"point":c=new ol(h),c.distance=u;break;case"spot":c=new Rf(h),c.distance=u,l.spot=l.spot||{},l.spot.innerConeAngle=l.spot.innerConeAngle!==void 0?l.spot.innerConeAngle:0,l.spot.outerConeAngle=l.spot.outerConeAngle!==void 0?l.spot.outerConeAngle:Math.PI/4,c.angle=l.spot.outerConeAngle,c.penumbra=1-l.spot.innerConeAngle/l.spot.outerConeAngle,c.target.position.set(0,0,-1),c.add(c.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+l.type)}return c.position.set(0,0,0),c.decay=2,Bn(c,l),l.intensity!==void 0&&(c.intensity=l.intensity),c.name=t.createUniqueName(l.name||"light_"+e),i=Promise.resolve(c),t.cache.add(n,i),i}getDependency(e,t){if(e==="light")return this._loadLight(t)}createNodeAttachment(e){const t=this,n=this.parser,s=n.json.nodes[e],o=(s.extensions&&s.extensions[this.name]||{}).light;return o===void 0?null:this._loadLight(o).then(function(l){return n._getNodeRef(t.cache,o,l)})}}class W_{constructor(){this.name=Ye.KHR_MATERIALS_UNLIT}getMaterialType(){return ut}extendParams(e,t,n){const i=[];e.color=new Te(1,1,1),e.opacity=1;const s=t.pbrMetallicRoughness;if(s){if(Array.isArray(s.baseColorFactor)){const a=s.baseColorFactor;e.color.setRGB(a[0],a[1],a[2],qt),e.opacity=a[3]}s.baseColorTexture!==void 0&&i.push(n.assignTexture(e,"map",s.baseColorTexture,Mt))}return Promise.all(i)}}class X_{constructor(e){this.parser=e,this.name=Ye.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,t){const i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=i.extensions[this.name].emissiveStrength;return s!==void 0&&(t.emissiveIntensity=s),Promise.resolve()}}class q_{constructor(e){this.parser=e,this.name=Ye.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:An}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];if(a.clearcoatFactor!==void 0&&(t.clearcoat=a.clearcoatFactor),a.clearcoatTexture!==void 0&&s.push(n.assignTexture(t,"clearcoatMap",a.clearcoatTexture)),a.clearcoatRoughnessFactor!==void 0&&(t.clearcoatRoughness=a.clearcoatRoughnessFactor),a.clearcoatRoughnessTexture!==void 0&&s.push(n.assignTexture(t,"clearcoatRoughnessMap",a.clearcoatRoughnessTexture)),a.clearcoatNormalTexture!==void 0&&(s.push(n.assignTexture(t,"clearcoatNormalMap",a.clearcoatNormalTexture)),a.clearcoatNormalTexture.scale!==void 0)){const o=a.clearcoatNormalTexture.scale;t.clearcoatNormalScale=new pe(o,o)}return Promise.all(s)}}class Y_{constructor(e){this.parser=e,this.name=Ye.KHR_MATERIALS_DISPERSION}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:An}extendMaterialParams(e,t){const i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=i.extensions[this.name];return t.dispersion=s.dispersion!==void 0?s.dispersion:0,Promise.resolve()}}class $_{constructor(e){this.parser=e,this.name=Ye.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:An}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];return a.iridescenceFactor!==void 0&&(t.iridescence=a.iridescenceFactor),a.iridescenceTexture!==void 0&&s.push(n.assignTexture(t,"iridescenceMap",a.iridescenceTexture)),a.iridescenceIor!==void 0&&(t.iridescenceIOR=a.iridescenceIor),t.iridescenceThicknessRange===void 0&&(t.iridescenceThicknessRange=[100,400]),a.iridescenceThicknessMinimum!==void 0&&(t.iridescenceThicknessRange[0]=a.iridescenceThicknessMinimum),a.iridescenceThicknessMaximum!==void 0&&(t.iridescenceThicknessRange[1]=a.iridescenceThicknessMaximum),a.iridescenceThicknessTexture!==void 0&&s.push(n.assignTexture(t,"iridescenceThicknessMap",a.iridescenceThicknessTexture)),Promise.all(s)}}class j_{constructor(e){this.parser=e,this.name=Ye.KHR_MATERIALS_SHEEN}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:An}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[];t.sheenColor=new Te(0,0,0),t.sheenRoughness=0,t.sheen=1;const a=i.extensions[this.name];if(a.sheenColorFactor!==void 0){const o=a.sheenColorFactor;t.sheenColor.setRGB(o[0],o[1],o[2],qt)}return a.sheenRoughnessFactor!==void 0&&(t.sheenRoughness=a.sheenRoughnessFactor),a.sheenColorTexture!==void 0&&s.push(n.assignTexture(t,"sheenColorMap",a.sheenColorTexture,Mt)),a.sheenRoughnessTexture!==void 0&&s.push(n.assignTexture(t,"sheenRoughnessMap",a.sheenRoughnessTexture)),Promise.all(s)}}class K_{constructor(e){this.parser=e,this.name=Ye.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:An}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];return a.transmissionFactor!==void 0&&(t.transmission=a.transmissionFactor),a.transmissionTexture!==void 0&&s.push(n.assignTexture(t,"transmissionMap",a.transmissionTexture)),Promise.all(s)}}class J_{constructor(e){this.parser=e,this.name=Ye.KHR_MATERIALS_VOLUME}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:An}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];t.thickness=a.thicknessFactor!==void 0?a.thicknessFactor:0,a.thicknessTexture!==void 0&&s.push(n.assignTexture(t,"thicknessMap",a.thicknessTexture)),t.attenuationDistance=a.attenuationDistance||1/0;const o=a.attenuationColor||[1,1,1];return t.attenuationColor=new Te().setRGB(o[0],o[1],o[2],qt),Promise.all(s)}}class Z_{constructor(e){this.parser=e,this.name=Ye.KHR_MATERIALS_IOR}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:An}extendMaterialParams(e,t){const i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=i.extensions[this.name];return t.ior=s.ior!==void 0?s.ior:1.5,Promise.resolve()}}class Q_{constructor(e){this.parser=e,this.name=Ye.KHR_MATERIALS_SPECULAR}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:An}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];t.specularIntensity=a.specularFactor!==void 0?a.specularFactor:1,a.specularTexture!==void 0&&s.push(n.assignTexture(t,"specularIntensityMap",a.specularTexture));const o=a.specularColorFactor||[1,1,1];return t.specularColor=new Te().setRGB(o[0],o[1],o[2],qt),a.specularColorTexture!==void 0&&s.push(n.assignTexture(t,"specularColorMap",a.specularColorTexture,Mt)),Promise.all(s)}}class ex{constructor(e){this.parser=e,this.name=Ye.EXT_MATERIALS_BUMP}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:An}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];return t.bumpScale=a.bumpFactor!==void 0?a.bumpFactor:1,a.bumpTexture!==void 0&&s.push(n.assignTexture(t,"bumpMap",a.bumpTexture)),Promise.all(s)}}class tx{constructor(e){this.parser=e,this.name=Ye.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:An}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const s=[],a=i.extensions[this.name];return a.anisotropyStrength!==void 0&&(t.anisotropy=a.anisotropyStrength),a.anisotropyRotation!==void 0&&(t.anisotropyRotation=a.anisotropyRotation),a.anisotropyTexture!==void 0&&s.push(n.assignTexture(t,"anisotropyMap",a.anisotropyTexture)),Promise.all(s)}}class nx{constructor(e){this.parser=e,this.name=Ye.KHR_TEXTURE_BASISU}loadTexture(e){const t=this.parser,n=t.json,i=n.textures[e];if(!i.extensions||!i.extensions[this.name])return null;const s=i.extensions[this.name],a=t.options.ktx2Loader;if(!a){if(n.extensionsRequired&&n.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return t.loadTextureImage(e,s.source,a)}}class ix{constructor(e){this.parser=e,this.name=Ye.EXT_TEXTURE_WEBP,this.isSupported=null}loadTexture(e){const t=this.name,n=this.parser,i=n.json,s=i.textures[e];if(!s.extensions||!s.extensions[t])return null;const a=s.extensions[t],o=i.images[a.source];let l=n.textureLoader;if(o.uri){const c=n.options.manager.getHandler(o.uri);c!==null&&(l=c)}return this.detectSupport().then(function(c){if(c)return n.loadTextureImage(e,a.source,l);if(i.extensionsRequired&&i.extensionsRequired.indexOf(t)>=0)throw new Error("THREE.GLTFLoader: WebP required by asset but unsupported.");return n.loadTexture(e)})}detectSupport(){return this.isSupported||(this.isSupported=new Promise(function(e){const t=new Image;t.src="data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",t.onload=t.onerror=function(){e(t.height===1)}})),this.isSupported}}class sx{constructor(e){this.parser=e,this.name=Ye.EXT_TEXTURE_AVIF,this.isSupported=null}loadTexture(e){const t=this.name,n=this.parser,i=n.json,s=i.textures[e];if(!s.extensions||!s.extensions[t])return null;const a=s.extensions[t],o=i.images[a.source];let l=n.textureLoader;if(o.uri){const c=n.options.manager.getHandler(o.uri);c!==null&&(l=c)}return this.detectSupport().then(function(c){if(c)return n.loadTextureImage(e,a.source,l);if(i.extensionsRequired&&i.extensionsRequired.indexOf(t)>=0)throw new Error("THREE.GLTFLoader: AVIF required by asset but unsupported.");return n.loadTexture(e)})}detectSupport(){return this.isSupported||(this.isSupported=new Promise(function(e){const t=new Image;t.src="data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAABcAAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAMAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAAB9tZGF0EgAKCBgABogQEDQgMgkQAAAAB8dSLfI=",t.onload=t.onerror=function(){e(t.height===1)}})),this.isSupported}}class rx{constructor(e){this.name=Ye.EXT_MESHOPT_COMPRESSION,this.parser=e}loadBufferView(e){const t=this.parser.json,n=t.bufferViews[e];if(n.extensions&&n.extensions[this.name]){const i=n.extensions[this.name],s=this.parser.getDependency("buffer",i.buffer),a=this.parser.options.meshoptDecoder;if(!a||!a.supported){if(t.extensionsRequired&&t.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return s.then(function(o){const l=i.byteOffset||0,c=i.byteLength||0,h=i.count,u=i.byteStride,d=new Uint8Array(o,l,c);return a.decodeGltfBufferAsync?a.decodeGltfBufferAsync(h,u,d,i.mode,i.filter).then(function(f){return f.buffer}):a.ready.then(function(){const f=new ArrayBuffer(h*u);return a.decodeGltfBuffer(new Uint8Array(f),h,u,d,i.mode,i.filter),f})})}else return null}}class ax{constructor(e){this.name=Ye.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){const t=this.parser.json,n=t.nodes[e];if(!n.extensions||!n.extensions[this.name]||n.mesh===void 0)return null;const i=t.meshes[n.mesh];for(const c of i.primitives)if(c.mode!==sn.TRIANGLES&&c.mode!==sn.TRIANGLE_STRIP&&c.mode!==sn.TRIANGLE_FAN&&c.mode!==void 0)return null;const a=n.extensions[this.name].attributes,o=[],l={};for(const c in a)o.push(this.parser.getDependency("accessor",a[c]).then(h=>(l[c]=h,l[c])));return o.length<1?null:(o.push(this.parser.createNodeMesh(e)),Promise.all(o).then(c=>{const h=c.pop(),u=h.isGroup?h.children:[h],d=c[0].count,f=[];for(const m of u){const _=new Fe,g=new C,p=new Ct,x=new C(1,1,1),y=new Yd(m.geometry,m.material,d);for(let v=0;v<d;v++)l.TRANSLATION&&g.fromBufferAttribute(l.TRANSLATION,v),l.ROTATION&&p.fromBufferAttribute(l.ROTATION,v),l.SCALE&&x.fromBufferAttribute(l.SCALE,v),y.setMatrixAt(v,_.compose(g,p,x));for(const v in l)if(v==="_COLOR_0"){const A=l[v];y.instanceColor=new Ao(A.array,A.itemSize,A.normalized)}else v!=="TRANSLATION"&&v!=="ROTATION"&&v!=="SCALE"&&m.geometry.setAttribute(v,l[v]);gt.prototype.copy.call(y,m),this.parser.assignFinalMaterial(y),f.push(y)}return h.isGroup?(h.clear(),h.add(...f),h):f[0]}))}}const eu="glTF",vs=12,Gc={JSON:1313821514,BIN:5130562};class ox{constructor(e){this.name=Ye.KHR_BINARY_GLTF,this.content=null,this.body=null;const t=new DataView(e,0,vs),n=new TextDecoder;if(this.header={magic:n.decode(new Uint8Array(e.slice(0,4))),version:t.getUint32(4,!0),length:t.getUint32(8,!0)},this.header.magic!==eu)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");const i=this.header.length-vs,s=new DataView(e,vs);let a=0;for(;a<i;){const o=s.getUint32(a,!0);a+=4;const l=s.getUint32(a,!0);if(a+=4,l===Gc.JSON){const c=new Uint8Array(e,vs+a,o);this.content=n.decode(c)}else if(l===Gc.BIN){const c=vs+a;this.body=e.slice(c,c+o)}a+=o}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}}class lx{constructor(e,t){if(!t)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=Ye.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=t,this.dracoLoader.preload()}decodePrimitive(e,t){const n=this.json,i=this.dracoLoader,s=e.extensions[this.name].bufferView,a=e.extensions[this.name].attributes,o={},l={},c={};for(const h in a){const u=Do[h]||h.toLowerCase();o[u]=a[h]}for(const h in e.attributes){const u=Do[h]||h.toLowerCase();if(a[h]!==void 0){const d=n.accessors[e.attributes[h]],f=Xi[d.componentType];c[u]=f.name,l[u]=d.normalized===!0}}return t.getDependency("bufferView",s).then(function(h){return new Promise(function(u,d){i.decodeDracoFile(h,function(f){for(const m in f.attributes){const _=f.attributes[m],g=l[m];g!==void 0&&(_.normalized=g)}u(f)},o,c,qt,d)})})}}class cx{constructor(){this.name=Ye.KHR_TEXTURE_TRANSFORM}extendTexture(e,t){return(t.texCoord===void 0||t.texCoord===e.channel)&&t.offset===void 0&&t.rotation===void 0&&t.scale===void 0||(e=e.clone(),t.texCoord!==void 0&&(e.channel=t.texCoord),t.offset!==void 0&&e.offset.fromArray(t.offset),t.rotation!==void 0&&(e.rotation=t.rotation),t.scale!==void 0&&e.repeat.fromArray(t.scale),e.needsUpdate=!0),e}}class hx{constructor(){this.name=Ye.KHR_MESH_QUANTIZATION}}class tu extends Hs{constructor(e,t,n,i){super(e,t,n,i)}copySampleValue_(e){const t=this.resultBuffer,n=this.sampleValues,i=this.valueSize,s=e*i*3+i;for(let a=0;a!==i;a++)t[a]=n[s+a];return t}interpolate_(e,t,n,i){const s=this.resultBuffer,a=this.sampleValues,o=this.valueSize,l=o*2,c=o*3,h=i-t,u=(n-t)/h,d=u*u,f=d*u,m=e*c,_=m-c,g=-2*f+3*d,p=f-d,x=1-g,y=p-d+u;for(let v=0;v!==o;v++){const A=a[_+v+o],E=a[_+v+l]*h,T=a[m+v+o],P=a[m+v]*h;s[v]=x*A+y*E+g*T+p*P}return s}}const ux=new Ct;class dx extends tu{interpolate_(e,t,n,i){const s=super.interpolate_(e,t,n,i);return ux.fromArray(s).normalize().toArray(s),s}}const sn={POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6},Xi={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},Wc={9728:Wt,9729:Dt,9984:ah,9985:Sr,9986:Ss,9987:On},Xc={33071:yn,33648:Nr,10497:ji},Fa={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},Do={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},Kn={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},fx={CUBICSPLINE:void 0,LINEAR:ks,STEP:Us},Ba={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};function px(r){return r.DefaultMaterial===void 0&&(r.DefaultMaterial=new jt({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:Vn})),r.DefaultMaterial}function ui(r,e,t){for(const n in t.extensions)r[n]===void 0&&(e.userData.gltfExtensions=e.userData.gltfExtensions||{},e.userData.gltfExtensions[n]=t.extensions[n])}function Bn(r,e){e.extras!==void 0&&(typeof e.extras=="object"?Object.assign(r.userData,e.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+e.extras))}function mx(r,e,t){let n=!1,i=!1,s=!1;for(let c=0,h=e.length;c<h;c++){const u=e[c];if(u.POSITION!==void 0&&(n=!0),u.NORMAL!==void 0&&(i=!0),u.COLOR_0!==void 0&&(s=!0),n&&i&&s)break}if(!n&&!i&&!s)return Promise.resolve(r);const a=[],o=[],l=[];for(let c=0,h=e.length;c<h;c++){const u=e[c];if(n){const d=u.POSITION!==void 0?t.getDependency("accessor",u.POSITION):r.attributes.position;a.push(d)}if(i){const d=u.NORMAL!==void 0?t.getDependency("accessor",u.NORMAL):r.attributes.normal;o.push(d)}if(s){const d=u.COLOR_0!==void 0?t.getDependency("accessor",u.COLOR_0):r.attributes.color;l.push(d)}}return Promise.all([Promise.all(a),Promise.all(o),Promise.all(l)]).then(function(c){const h=c[0],u=c[1],d=c[2];return n&&(r.morphAttributes.position=h),i&&(r.morphAttributes.normal=u),s&&(r.morphAttributes.color=d),r.morphTargetsRelative=!0,r})}function gx(r,e){if(r.updateMorphTargets(),e.weights!==void 0)for(let t=0,n=e.weights.length;t<n;t++)r.morphTargetInfluences[t]=e.weights[t];if(e.extras&&Array.isArray(e.extras.targetNames)){const t=e.extras.targetNames;if(r.morphTargetInfluences.length===t.length){r.morphTargetDictionary={};for(let n=0,i=t.length;n<i;n++)r.morphTargetDictionary[t[n]]=n}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function _x(r){let e;const t=r.extensions&&r.extensions[Ye.KHR_DRACO_MESH_COMPRESSION];if(t?e="draco:"+t.bufferView+":"+t.indices+":"+Oa(t.attributes):e=r.indices+":"+Oa(r.attributes)+":"+r.mode,r.targets!==void 0)for(let n=0,i=r.targets.length;n<i;n++)e+=":"+Oa(r.targets[n]);return e}function Oa(r){let e="";const t=Object.keys(r).sort();for(let n=0,i=t.length;n<i;n++)e+=t[n]+":"+r[t[n]]+";";return e}function No(r){switch(r){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function xx(r){return r.search(/\.jpe?g($|\?)/i)>0||r.search(/^data\:image\/jpeg/)===0?"image/jpeg":r.search(/\.webp($|\?)/i)>0||r.search(/^data\:image\/webp/)===0?"image/webp":r.search(/\.ktx2($|\?)/i)>0||r.search(/^data\:image\/ktx2/)===0?"image/ktx2":"image/png"}const vx=new Fe;class yx{constructor(e={},t={}){this.json=e,this.extensions={},this.plugins={},this.options=t,this.cache=new V_,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let n=!1,i=-1,s=!1,a=-1;if(typeof navigator<"u"){const o=navigator.userAgent;n=/^((?!chrome|android).)*safari/i.test(o)===!0;const l=o.match(/Version\/(\d+)/);i=n&&l?parseInt(l[1],10):-1,s=o.indexOf("Firefox")>-1,a=s?o.match(/Firefox\/([0-9]+)\./)[1]:-1}typeof createImageBitmap>"u"||n&&i<17||s&&a<98?this.textureLoader=new Tf(this.options.manager):this.textureLoader=new If(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new Vh(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,t){const n=this,i=this.json,s=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(a){return a._markDefs&&a._markDefs()}),Promise.all(this._invokeAll(function(a){return a.beforeRoot&&a.beforeRoot()})).then(function(){return Promise.all([n.getDependencies("scene"),n.getDependencies("animation"),n.getDependencies("camera")])}).then(function(a){const o={scene:a[0][i.scene||0],scenes:a[0],animations:a[1],cameras:a[2],asset:i.asset,parser:n,userData:{}};return ui(s,o,i),Bn(o,i),Promise.all(n._invokeAll(function(l){return l.afterRoot&&l.afterRoot(o)})).then(function(){for(const l of o.scenes)l.updateMatrixWorld();e(o)})}).catch(t)}_markDefs(){const e=this.json.nodes||[],t=this.json.skins||[],n=this.json.meshes||[];for(let i=0,s=t.length;i<s;i++){const a=t[i].joints;for(let o=0,l=a.length;o<l;o++)e[a[o]].isBone=!0}for(let i=0,s=e.length;i<s;i++){const a=e[i];a.mesh!==void 0&&(this._addNodeRef(this.meshCache,a.mesh),a.skin!==void 0&&(n[a.mesh].isSkinnedMesh=!0)),a.camera!==void 0&&this._addNodeRef(this.cameraCache,a.camera)}}_addNodeRef(e,t){t!==void 0&&(e.refs[t]===void 0&&(e.refs[t]=e.uses[t]=0),e.refs[t]++)}_getNodeRef(e,t,n){if(e.refs[t]<=1)return n;const i=n.clone(),s=(a,o)=>{const l=this.associations.get(a);l!=null&&this.associations.set(o,l);for(const[c,h]of a.children.entries())s(h,o.children[c])};return s(n,i),i.name+="_instance_"+e.uses[t]++,i}_invokeOne(e){const t=Object.values(this.plugins);t.push(this);for(let n=0;n<t.length;n++){const i=e(t[n]);if(i)return i}return null}_invokeAll(e){const t=Object.values(this.plugins);t.unshift(this);const n=[];for(let i=0;i<t.length;i++){const s=e(t[i]);s&&n.push(s)}return n}getDependency(e,t){const n=e+":"+t;let i=this.cache.get(n);if(!i){switch(e){case"scene":i=this.loadScene(t);break;case"node":i=this._invokeOne(function(s){return s.loadNode&&s.loadNode(t)});break;case"mesh":i=this._invokeOne(function(s){return s.loadMesh&&s.loadMesh(t)});break;case"accessor":i=this.loadAccessor(t);break;case"bufferView":i=this._invokeOne(function(s){return s.loadBufferView&&s.loadBufferView(t)});break;case"buffer":i=this.loadBuffer(t);break;case"material":i=this._invokeOne(function(s){return s.loadMaterial&&s.loadMaterial(t)});break;case"texture":i=this._invokeOne(function(s){return s.loadTexture&&s.loadTexture(t)});break;case"skin":i=this.loadSkin(t);break;case"animation":i=this._invokeOne(function(s){return s.loadAnimation&&s.loadAnimation(t)});break;case"camera":i=this.loadCamera(t);break;default:if(i=this._invokeOne(function(s){return s!=this&&s.getDependency&&s.getDependency(e,t)}),!i)throw new Error("Unknown type: "+e);break}this.cache.add(n,i)}return i}getDependencies(e){let t=this.cache.get(e);if(!t){const n=this,i=this.json[e+(e==="mesh"?"es":"s")]||[];t=Promise.all(i.map(function(s,a){return n.getDependency(e,a)})),this.cache.add(e,t)}return t}loadBuffer(e){const t=this.json.buffers[e],n=this.fileLoader;if(t.type&&t.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+t.type+" buffer type is not supported.");if(t.uri===void 0&&e===0)return Promise.resolve(this.extensions[Ye.KHR_BINARY_GLTF].body);const i=this.options;return new Promise(function(s,a){n.load(Is.resolveURL(t.uri,i.path),s,void 0,function(){a(new Error('THREE.GLTFLoader: Failed to load buffer "'+t.uri+'".'))})})}loadBufferView(e){const t=this.json.bufferViews[e];return this.getDependency("buffer",t.buffer).then(function(n){const i=t.byteLength||0,s=t.byteOffset||0;return n.slice(s,s+i)})}loadAccessor(e){const t=this,n=this.json,i=this.json.accessors[e];if(i.bufferView===void 0&&i.sparse===void 0){const a=Fa[i.type],o=Xi[i.componentType],l=i.normalized===!0,c=new o(i.count*a);return Promise.resolve(new Ot(c,a,l))}const s=[];return i.bufferView!==void 0?s.push(this.getDependency("bufferView",i.bufferView)):s.push(null),i.sparse!==void 0&&(s.push(this.getDependency("bufferView",i.sparse.indices.bufferView)),s.push(this.getDependency("bufferView",i.sparse.values.bufferView))),Promise.all(s).then(function(a){const o=a[0],l=Fa[i.type],c=Xi[i.componentType],h=c.BYTES_PER_ELEMENT,u=h*l,d=i.byteOffset||0,f=i.bufferView!==void 0?n.bufferViews[i.bufferView].byteStride:void 0,m=i.normalized===!0;let _,g;if(f&&f!==u){const p=Math.floor(d/f),x="InterleavedBuffer:"+i.bufferView+":"+i.componentType+":"+p+":"+i.count;let y=t.cache.get(x);y||(_=new c(o,p*f,i.count*f/h),y=new Vd(_,f/h),t.cache.add(x,y)),g=new Jo(y,l,d%f/h,m)}else o===null?_=new c(i.count*l):_=new c(o,d,i.count*l),g=new Ot(_,l,m);if(i.sparse!==void 0){const p=Fa.SCALAR,x=Xi[i.sparse.indices.componentType],y=i.sparse.indices.byteOffset||0,v=i.sparse.values.byteOffset||0,A=new x(a[1],y,i.sparse.count*p),E=new c(a[2],v,i.sparse.count*l);o!==null&&(g=new Ot(g.array.slice(),g.itemSize,g.normalized)),g.normalized=!1;for(let T=0,P=A.length;T<P;T++){const b=A[T];if(g.setX(b,E[T*l]),l>=2&&g.setY(b,E[T*l+1]),l>=3&&g.setZ(b,E[T*l+2]),l>=4&&g.setW(b,E[T*l+3]),l>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}g.normalized=m}return g})}loadTexture(e){const t=this.json,n=this.options,s=t.textures[e].source,a=t.images[s];let o=this.textureLoader;if(a.uri){const l=n.manager.getHandler(a.uri);l!==null&&(o=l)}return this.loadTextureImage(e,s,o)}loadTextureImage(e,t,n){const i=this,s=this.json,a=s.textures[e],o=s.images[t],l=(o.uri||o.bufferView)+":"+a.sampler;if(this.textureCache[l])return this.textureCache[l];const c=this.loadImageSource(t,n).then(function(h){h.flipY=!1,h.name=a.name||o.name||"",h.name===""&&typeof o.uri=="string"&&o.uri.startsWith("data:image/")===!1&&(h.name=o.uri);const d=(s.samplers||{})[a.sampler]||{};return h.magFilter=Wc[d.magFilter]||Dt,h.minFilter=Wc[d.minFilter]||On,h.wrapS=Xc[d.wrapS]||ji,h.wrapT=Xc[d.wrapT]||ji,h.generateMipmaps=!h.isCompressedTexture&&h.minFilter!==Wt&&h.minFilter!==Dt,i.associations.set(h,{textures:e}),h}).catch(function(){return null});return this.textureCache[l]=c,c}loadImageSource(e,t){const n=this,i=this.json,s=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(u=>u.clone());const a=i.images[e],o=self.URL||self.webkitURL;let l=a.uri||"",c=!1;if(a.bufferView!==void 0)l=n.getDependency("bufferView",a.bufferView).then(function(u){c=!0;const d=new Blob([u],{type:a.mimeType});return l=o.createObjectURL(d),l});else if(a.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+e+" is missing URI and bufferView");const h=Promise.resolve(l).then(function(u){return new Promise(function(d,f){let m=d;t.isImageBitmapLoader===!0&&(m=function(_){const g=new bt(_);g.needsUpdate=!0,d(g)}),t.load(Is.resolveURL(u,s.path),m,void 0,f)})}).then(function(u){return c===!0&&o.revokeObjectURL(l),Bn(u,a),u.userData.mimeType=a.mimeType||xx(a.uri),u}).catch(function(u){throw console.error("THREE.GLTFLoader: Couldn't load texture",l),u});return this.sourceCache[e]=h,h}assignTexture(e,t,n,i){const s=this;return this.getDependency("texture",n.index).then(function(a){if(!a)return null;if(n.texCoord!==void 0&&n.texCoord>0&&(a=a.clone(),a.channel=n.texCoord),s.extensions[Ye.KHR_TEXTURE_TRANSFORM]){const o=n.extensions!==void 0?n.extensions[Ye.KHR_TEXTURE_TRANSFORM]:void 0;if(o){const l=s.associations.get(a);a=s.extensions[Ye.KHR_TEXTURE_TRANSFORM].extendTexture(a,o),s.associations.set(a,l)}}return i!==void 0&&(a.colorSpace=i),e[t]=a,a})}assignFinalMaterial(e){const t=e.geometry;let n=e.material;const i=t.attributes.tangent===void 0,s=t.attributes.color!==void 0,a=t.attributes.normal===void 0;if(e.isPoints){const o="PointsMaterial:"+n.uuid;let l=this.cache.get(o);l||(l=new tl,wn.prototype.copy.call(l,n),l.color.copy(n.color),l.map=n.map,l.sizeAttenuation=!1,this.cache.add(o,l)),n=l}else if(e.isLine){const o="LineBasicMaterial:"+n.uuid;let l=this.cache.get(o);l||(l=new Lh,wn.prototype.copy.call(l,n),l.color.copy(n.color),l.map=n.map,this.cache.add(o,l)),n=l}if(i||s||a){let o="ClonedMaterial:"+n.uuid+":";i&&(o+="derivative-tangents:"),s&&(o+="vertex-colors:"),a&&(o+="flat-shading:");let l=this.cache.get(o);l||(l=n.clone(),s&&(l.vertexColors=!0),a&&(l.flatShading=!0),i&&(l.normalScale&&(l.normalScale.y*=-1),l.clearcoatNormalScale&&(l.clearcoatNormalScale.y*=-1)),this.cache.add(o,l),this.associations.set(l,this.associations.get(n))),n=l}e.material=n}getMaterialType(){return jt}loadMaterial(e){const t=this,n=this.json,i=this.extensions,s=n.materials[e];let a;const o={},l=s.extensions||{},c=[];if(l[Ye.KHR_MATERIALS_UNLIT]){const u=i[Ye.KHR_MATERIALS_UNLIT];a=u.getMaterialType(),c.push(u.extendParams(o,s,t))}else{const u=s.pbrMetallicRoughness||{};if(o.color=new Te(1,1,1),o.opacity=1,Array.isArray(u.baseColorFactor)){const d=u.baseColorFactor;o.color.setRGB(d[0],d[1],d[2],qt),o.opacity=d[3]}u.baseColorTexture!==void 0&&c.push(t.assignTexture(o,"map",u.baseColorTexture,Mt)),o.metalness=u.metallicFactor!==void 0?u.metallicFactor:1,o.roughness=u.roughnessFactor!==void 0?u.roughnessFactor:1,u.metallicRoughnessTexture!==void 0&&(c.push(t.assignTexture(o,"metalnessMap",u.metallicRoughnessTexture)),c.push(t.assignTexture(o,"roughnessMap",u.metallicRoughnessTexture))),a=this._invokeOne(function(d){return d.getMaterialType&&d.getMaterialType(e)}),c.push(Promise.all(this._invokeAll(function(d){return d.extendMaterialParams&&d.extendMaterialParams(e,o)})))}s.doubleSided===!0&&(o.side=rn);const h=s.alphaMode||Ba.OPAQUE;if(h===Ba.BLEND?(o.transparent=!0,o.depthWrite=!1):(o.transparent=!1,h===Ba.MASK&&(o.alphaTest=s.alphaCutoff!==void 0?s.alphaCutoff:.5)),s.normalTexture!==void 0&&a!==ut&&(c.push(t.assignTexture(o,"normalMap",s.normalTexture)),o.normalScale=new pe(1,1),s.normalTexture.scale!==void 0)){const u=s.normalTexture.scale;o.normalScale.set(u,u)}if(s.occlusionTexture!==void 0&&a!==ut&&(c.push(t.assignTexture(o,"aoMap",s.occlusionTexture)),s.occlusionTexture.strength!==void 0&&(o.aoMapIntensity=s.occlusionTexture.strength)),s.emissiveFactor!==void 0&&a!==ut){const u=s.emissiveFactor;o.emissive=new Te().setRGB(u[0],u[1],u[2],qt)}return s.emissiveTexture!==void 0&&a!==ut&&c.push(t.assignTexture(o,"emissiveMap",s.emissiveTexture,Mt)),Promise.all(c).then(function(){const u=new a(o);return s.name&&(u.name=s.name),Bn(u,s),t.associations.set(u,{materials:e}),s.extensions&&ui(i,u,s),u})}createUniqueName(e){const t=st.sanitizeNodeName(e||"");return t in this.nodeNamesUsed?t+"_"+ ++this.nodeNamesUsed[t]:(this.nodeNamesUsed[t]=0,t)}loadGeometries(e){const t=this,n=this.extensions,i=this.primitiveCache;function s(o){return n[Ye.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(o,t).then(function(l){return qc(l,o,t)})}const a=[];for(let o=0,l=e.length;o<l;o++){const c=e[o],h=_x(c),u=i[h];if(u)a.push(u.promise);else{let d;c.extensions&&c.extensions[Ye.KHR_DRACO_MESH_COMPRESSION]?d=s(c):d=qc(new Pt,c,t),i[h]={primitive:c,promise:d},a.push(d)}}return Promise.all(a)}loadMesh(e){const t=this,n=this.json,i=this.extensions,s=n.meshes[e],a=s.primitives,o=[];for(let l=0,c=a.length;l<c;l++){const h=a[l].material===void 0?px(this.cache):this.getDependency("material",a[l].material);o.push(h)}return o.push(t.loadGeometries(a)),Promise.all(o).then(function(l){const c=l.slice(0,l.length-1),h=l[l.length-1],u=[];for(let f=0,m=h.length;f<m;f++){const _=h[f],g=a[f];let p;const x=c[f];if(g.mode===sn.TRIANGLES||g.mode===sn.TRIANGLE_STRIP||g.mode===sn.TRIANGLE_FAN||g.mode===void 0)p=s.isSkinnedMesh===!0?new Wd(_,x):new D(_,x),p.isSkinnedMesh===!0&&p.normalizeSkinWeights(),g.mode===sn.TRIANGLE_STRIP?p.geometry=Vc(p.geometry,_h):g.mode===sn.TRIANGLE_FAN&&(p.geometry=Vc(p.geometry,Eo));else if(g.mode===sn.LINES)p=new Kd(_,x);else if(g.mode===sn.LINE_STRIP)p=new el(_,x);else if(g.mode===sn.LINE_LOOP)p=new Jd(_,x);else if(g.mode===sn.POINTS)p=new Dh(_,x);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+g.mode);Object.keys(p.geometry.morphAttributes).length>0&&gx(p,s),p.name=t.createUniqueName(s.name||"mesh_"+e),Bn(p,s),g.extensions&&ui(i,p,g),t.assignFinalMaterial(p),u.push(p)}for(let f=0,m=u.length;f<m;f++)t.associations.set(u[f],{meshes:e,primitives:f});if(u.length===1)return s.extensions&&ui(i,u[0],s),u[0];const d=new ht;s.extensions&&ui(i,d,s),t.associations.set(d,{meshes:e});for(let f=0,m=u.length;f<m;f++)d.add(u[f]);return d})}loadCamera(e){let t;const n=this.json.cameras[e],i=n[n.type];if(!i){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return n.type==="perspective"?t=new Bt(md.radToDeg(i.yfov),i.aspectRatio||1,i.znear||1,i.zfar||2e6):n.type==="orthographic"&&(t=new ll(-i.xmag,i.xmag,i.ymag,-i.ymag,i.znear,i.zfar)),n.name&&(t.name=this.createUniqueName(n.name)),Bn(t,n),Promise.resolve(t)}loadSkin(e){const t=this.json.skins[e],n=[];for(let i=0,s=t.joints.length;i<s;i++)n.push(this._loadNodeShallow(t.joints[i]));return t.inverseBindMatrices!==void 0?n.push(this.getDependency("accessor",t.inverseBindMatrices)):n.push(null),Promise.all(n).then(function(i){const s=i.pop(),a=i,o=[],l=[];for(let c=0,h=a.length;c<h;c++){const u=a[c];if(u){o.push(u);const d=new Fe;s!==null&&d.fromArray(s.array,c*16),l.push(d)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',t.joints[c])}return new Zo(o,l)})}loadAnimation(e){const t=this.json,n=this,i=t.animations[e],s=i.name?i.name:"animation_"+e,a=[],o=[],l=[],c=[],h=[];for(let u=0,d=i.channels.length;u<d;u++){const f=i.channels[u],m=i.samplers[f.sampler],_=f.target,g=_.node,p=i.parameters!==void 0?i.parameters[m.input]:m.input,x=i.parameters!==void 0?i.parameters[m.output]:m.output;_.node!==void 0&&(a.push(this.getDependency("node",g)),o.push(this.getDependency("accessor",p)),l.push(this.getDependency("accessor",x)),c.push(m),h.push(_))}return Promise.all([Promise.all(a),Promise.all(o),Promise.all(l),Promise.all(c),Promise.all(h)]).then(function(u){const d=u[0],f=u[1],m=u[2],_=u[3],g=u[4],p=[];for(let x=0,y=d.length;x<y;x++){const v=d[x],A=f[x],E=m[x],T=_[x],P=g[x];if(v===void 0)continue;v.updateMatrix&&v.updateMatrix();const b=n._createAnimationTracks(v,A,E,T,P);if(b)for(let M=0;M<b.length;M++)p.push(b[M])}return new Co(s,void 0,p)})}createNodeMesh(e){const t=this.json,n=this,i=t.nodes[e];return i.mesh===void 0?null:n.getDependency("mesh",i.mesh).then(function(s){const a=n._getNodeRef(n.meshCache,i.mesh,s);return i.weights!==void 0&&a.traverse(function(o){if(o.isMesh)for(let l=0,c=i.weights.length;l<c;l++)o.morphTargetInfluences[l]=i.weights[l]}),a})}loadNode(e){const t=this.json,n=this,i=t.nodes[e],s=n._loadNodeShallow(e),a=[],o=i.children||[];for(let c=0,h=o.length;c<h;c++)a.push(n.getDependency("node",o[c]));const l=i.skin===void 0?Promise.resolve(null):n.getDependency("skin",i.skin);return Promise.all([s,Promise.all(a),l]).then(function(c){const h=c[0],u=c[1],d=c[2];d!==null&&h.traverse(function(f){f.isSkinnedMesh&&f.bind(d,vx)});for(let f=0,m=u.length;f<m;f++)h.add(u[f]);return h})}_loadNodeShallow(e){const t=this.json,n=this.extensions,i=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];const s=t.nodes[e],a=s.name?i.createUniqueName(s.name):"",o=[],l=i._invokeOne(function(c){return c.createNodeMesh&&c.createNodeMesh(e)});return l&&o.push(l),s.camera!==void 0&&o.push(i.getDependency("camera",s.camera).then(function(c){return i._getNodeRef(i.cameraCache,s.camera,c)})),i._invokeAll(function(c){return c.createNodeAttachment&&c.createNodeAttachment(e)}).forEach(function(c){o.push(c)}),this.nodeCache[e]=Promise.all(o).then(function(c){let h;if(s.isBone===!0?h=new Ph:c.length>1?h=new ht:c.length===1?h=c[0]:h=new gt,h!==c[0])for(let u=0,d=c.length;u<d;u++)h.add(c[u]);if(s.name&&(h.userData.name=s.name,h.name=a),Bn(h,s),s.extensions&&ui(n,h,s),s.matrix!==void 0){const u=new Fe;u.fromArray(s.matrix),h.applyMatrix4(u)}else s.translation!==void 0&&h.position.fromArray(s.translation),s.rotation!==void 0&&h.quaternion.fromArray(s.rotation),s.scale!==void 0&&h.scale.fromArray(s.scale);return i.associations.has(h)||i.associations.set(h,{}),i.associations.get(h).nodes=e,h}),this.nodeCache[e]}loadScene(e){const t=this.extensions,n=this.json.scenes[e],i=this,s=new ht;n.name&&(s.name=i.createUniqueName(n.name)),Bn(s,n),n.extensions&&ui(t,s,n);const a=n.nodes||[],o=[];for(let l=0,c=a.length;l<c;l++)o.push(i.getDependency("node",a[l]));return Promise.all(o).then(function(l){for(let h=0,u=l.length;h<u;h++)s.add(l[h]);const c=h=>{const u=new Map;for(const[d,f]of i.associations)(d instanceof wn||d instanceof bt)&&u.set(d,f);return h.traverse(d=>{const f=i.associations.get(d);f!=null&&u.set(d,f)}),u};return i.associations=c(s),s})}_createAnimationTracks(e,t,n,i,s){const a=[],o=e.name?e.name:e.uuid,l=[];Kn[s.path]===Kn.weights?e.traverse(function(d){d.morphTargetInfluences&&l.push(d.name?d.name:d.uuid)}):l.push(o);let c;switch(Kn[s.path]){case Kn.weights:c=es;break;case Kn.rotation:c=ts;break;case Kn.position:case Kn.scale:c=ns;break;default:switch(n.itemSize){case 1:c=es;break;case 2:case 3:default:c=ns;break}break}const h=i.interpolation!==void 0?fx[i.interpolation]:ks,u=this._getArrayFromAccessor(n);for(let d=0,f=l.length;d<f;d++){const m=new c(l[d]+"."+Kn[s.path],t.array,u,h);i.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(m),a.push(m)}return a}_getArrayFromAccessor(e){let t=e.array;if(e.normalized){const n=No(t.constructor),i=new Float32Array(t.length);for(let s=0,a=t.length;s<a;s++)i[s]=t[s]*n;t=i}return t}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(n){const i=this instanceof ts?dx:tu;return new i(this.times,this.values,this.getValueSize()/3,n)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}}function Mx(r,e,t){const n=e.attributes,i=new xn;if(n.POSITION!==void 0){const o=t.json.accessors[n.POSITION],l=o.min,c=o.max;if(l!==void 0&&c!==void 0){if(i.set(new C(l[0],l[1],l[2]),new C(c[0],c[1],c[2])),o.normalized){const h=No(Xi[o.componentType]);i.min.multiplyScalar(h),i.max.multiplyScalar(h)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;const s=e.targets;if(s!==void 0){const o=new C,l=new C;for(let c=0,h=s.length;c<h;c++){const u=s[c];if(u.POSITION!==void 0){const d=t.json.accessors[u.POSITION],f=d.min,m=d.max;if(f!==void 0&&m!==void 0){if(l.setX(Math.max(Math.abs(f[0]),Math.abs(m[0]))),l.setY(Math.max(Math.abs(f[1]),Math.abs(m[1]))),l.setZ(Math.max(Math.abs(f[2]),Math.abs(m[2]))),d.normalized){const _=No(Xi[d.componentType]);l.multiplyScalar(_)}o.max(l)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}i.expandByVector(o)}r.boundingBox=i;const a=new En;i.getCenter(a.center),a.radius=i.min.distanceTo(i.max)/2,r.boundingSphere=a}function qc(r,e,t){const n=e.attributes,i=[];function s(a,o){return t.getDependency("accessor",a).then(function(l){r.setAttribute(o,l)})}for(const a in n){const o=Do[a]||a.toLowerCase();o in r.attributes||i.push(s(n[a],o))}if(e.indices!==void 0&&!r.index){const a=t.getDependency("accessor",e.indices).then(function(o){r.setIndex(o)});i.push(a)}return Je.workingColorSpace!==qt&&"COLOR_0"in n&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${Je.workingColorSpace}" not supported.`),Bn(r,e),Mx(r,e,t),Promise.all(i).then(function(){return e.targets!==void 0?mx(r,e.targets,t):r})}function wx(r){const e=new Map,t=new Map,n=r.clone();return nu(r,n,function(i,s){e.set(s,i),t.set(i,s)}),n.traverse(function(i){if(!i.isSkinnedMesh)return;const s=i,a=e.get(i),o=a.skeleton.bones;s.skeleton=a.skeleton.clone(),s.bindMatrix.copy(a.bindMatrix),s.skeleton.bones=o.map(function(l){return t.get(l)}),s.bind(s.skeleton,s.bindMatrix)}),n}function nu(r,e,t){t(r,e);for(let n=0;n<r.children.length;n++)nu(r.children[n],e.children[n],t)}const bx=new H_,vr={};function Sx(r,e=12e3){return vr[r]||(vr[r]=new Promise((t,n)=>{let i=!1;const s=setTimeout(()=>{i||(i=!0,n(new Error(`[actors] timeout loading ${r}`)))},e);bx.load(`assets/${r}`,a=>{i||(i=!0,clearTimeout(s),t(a))},void 0,a=>{i||(i=!0,clearTimeout(s),n(a||new Error(`[actors] failed ${r}`)))})}).catch(t=>{throw delete vr[r],t})),vr[r]}function Ex(r,e,t="op"){return Promise.race([r,new Promise((n,i)=>setTimeout(()=>i(new Error(`[actors] ${t} timed out after ${e}ms`)),e))])}function Tx(r,e=null){const n=(Array.isArray(r)?r:[r]).map(i=>{if(!i||typeof i.clone!="function")return i;const s=i.clone();return e!=null&&s.color&&s.color.lerp(new Te(e),.22),s.userData={...s.userData||{},owned:!0},s.color&&(s.userData.baseColorHex=s.color.getHex()),"emissiveIntensity"in s&&(s.userData.baseEm=s.emissiveIntensity??0),s});return Array.isArray(r)?n:n[0]}function Ax(r){return r.traverse(e=>{if(e.isLight){e.removeFromParent();return}if(e.isMesh){e.castShadow=!0,e.receiveShadow=!0,e.frustumCulled=!1;const t=Array.isArray(e.material)?e.material:e.material?[e.material]:[];for(const n of t)if(n&&("envMapIntensity"in n&&(n.envMapIntensity=1.1),n.roughness!=null&&n.roughness>.92&&(n.roughness=.78),n.metalness!=null&&n.metalness<.05&&n.color)){const i=n.color;i.r>.25&&Math.abs(i.r-i.g)<.08&&Math.abs(i.g-i.b)<.08&&(n.metalness=.35,n.roughness=Math.min(n.roughness??.6,.55))}}}),r}async function Rx(r,e){const t={};let n=0;return await Promise.all(r.map(async i=>{try{const s=await Sx(`enemies/${i}.glb`);t[i]={scene:Ax(s.scene),animations:s.animations||[]}}catch(s){console.warn("[actors] enemy load failed:",i,s)}e?.(++n/r.length)})),t}async function Cx({onProgress:r,timeoutMs:e=1e4}={}){r?.(.15,"Rousing the legions…");try{const t=await Ex(Rx(["skeleton","imp","orc","brute","wisp","demon"],n=>{r?.(.15+n*.8,"Rousing the legions…")}),e,"enemy pack");return r?.(1,"Ready."),{enemies:t}}catch(t){return console.warn("[actors] enemy pack aborted — procedural enemies",t),{enemies:null}}}function Px(r,e={}){if(!r?.scene)return null;try{return new Ix(r,e)}catch(t){return console.warn("[actors] Actor create failed — procedural fallback",t),null}}const Yc={wisp:"wisp",brute:"brute",stalker:"skeleton",stormling:"imp",boss:"demon"};class Ix{constructor(e,{height:t=1.7,tint:n=null}={}){if(!e?.scene)throw new Error("Actor requires lib.scene");this.root=new ht,this.model=wx(e.scene),this.root.add(this.model),this.height=t,this.model.traverse(f=>{f.isMesh&&f.material&&(f.material=Tx(f.material,n),f.frustumCulled=!1)}),this.mixer=new Xf(this.model),this.actions={};const i=Array.isArray(e.animations)?e.animations:[];for(const f of i)if(f?.name)try{this.actions[f.name]=this.mixer.clipAction(f)}catch(m){console.warn("[actors] clipAction failed",f.name,m)}if(this.current=null,this._oneShot=null,this.armBones=Nx(this.model),this.relaxW=0,this.gait=0,!this.actions.Walk){for(const f of i){const m=(f.name||"").toLowerCase();/walk|run|move|fly/.test(m)&&!this.actions.Walk&&(this.actions.Walk=this.mixer.clipAction(f)),/idle|stand/.test(m)&&!this.actions.Idle&&(this.actions.Idle=this.mixer.clipAction(f)),/attack|bite|punch|slash|hit(?!_react)/.test(m)&&!this.actions.C_attack&&(this.actions.C_attack=this.mixer.clipAction(f))}!this.actions.Idle&&i[0]&&(this.actions.Idle=this.mixer.clipAction(i[0])),this.actions.Walk||(this.actions.Walk=this.actions.Idle)}const s=this.actions.Idle||Object.values(this.actions)[0];s&&(s.play(),this.mixer.update(.05)),this.model.updateMatrixWorld(!0);let a=1/0,o=-1/0,l=!1;const c=new C;this.model.traverse(f=>{f.isBone&&(l=!0,f.getWorldPosition(c),a=Math.min(a,c.y),o=Math.max(o,c.y))});let h,u;if(l&&Number.isFinite(a)&&Number.isFinite(o)&&o>a)h=Math.max(.25,o-a)*1.25,u=Math.min(0,a);else{const f=new xn().setFromObject(this.model);!Number.isFinite(f.min.y)||!Number.isFinite(f.max.y)?(h=1.7,u=0):(h=Math.max(.2,f.max.y-f.min.y),u=f.min.y)}const d=t/Math.max(.2,h);this.model.scale.setScalar(d),this.model.position.y=-u*d,s&&s.stop(),this.play("Idle",{fade:0})}play(e,{fade:t=.12,timeScale:n=1}={}){const i=this.actions[e];if(!i||i===this.current){i&&(i.timeScale=n);return}i.reset().setEffectiveTimeScale(n).setEffectiveWeight(1).fadeIn(t).play(),this.current&&this.current.fadeOut(t),this.current=i,this._oneShot=null}playOnce(e,{timeScale:t=1,fade:n=.06}={}){const i=this.actions[e]||this.actions.C_attack||this.actions.C_melee;return i?(i.reset().setLoop(gh,1),i.clampWhenFinished=!0,i.setEffectiveTimeScale(t).setEffectiveWeight(1).fadeIn(n).play(),this.current&&this.current!==i&&this.current.fadeOut(n),this._oneShot=i,this.current=i,i.getClip().duration/t):.35}update(e){this.mixer.update(e),this._oneShot&&!this._oneShot.isRunning()&&(this._oneShot=null,this.play("Idle",{fade:.15}))}updateRelax(e,t,n,i){if(this.armBones&&(this.relaxW+=(t-this.relaxW)*Math.min(1,e*12),!(this.relaxW<=.02)&&(this.model.updateMatrixWorld(!0),Jc(this.armBones,this.relaxW),n))){this.gait=(this.gait||0)+e*(i?12.5:8.5);const s=Math.sin(this.gait)*(i?.6:.42)*this.relaxW;this.root.getWorldQuaternion(yr),ys.set(1,0,0).applyQuaternion(yr);const a=this.armBones;a.rArm.rotateOnWorldAxis(ys,s),a.rArm.updateMatrixWorld(!0),a.lArm.rotateOnWorldAxis(ys,-s),a.lArm.updateMatrixWorld(!0),a.rFore.rotateOnWorldAxis(ys,s*.35),a.lFore.rotateOnWorldAxis(ys,-s*.35)}}_findBone(e,t){let n=null;return this.model.traverse(i=>{!n&&i.isBone&&i.name.includes(e)&&t.test(i.name)&&(n=i)}),n}attachWeapon(e,t,n){const i=this._findBone(t,/Hand/)||this._findBone(t,/hand|wrist/i);if(!i)return this.root.add(e),null;this.actions.Idle&&(this.actions.Idle.reset().play(),this.mixer.update(.05)),this.model.updateMatrixWorld(!0),this.armBones&&(Jc(this.armBones,1),this.model.updateMatrixWorld(!0)),e.updateMatrixWorld(!0);const s=new xn().setFromObject(e),a=Math.max(.001,s.max.y-s.min.y);e.position.y-=s.min.y+a*(n.gripFrac??.2);const o=new ht;return o.scale.setScalar(Dx(i)*(n.scale||1)),o.add(e),i.add(o),this.model.updateMatrixWorld(!0),i.getWorldQuaternion(yr),jc.fromArray(n.rest).normalize(),$c.setFromUnitVectors(Lx,jc),o.quaternion.copy(yr.invert().multiply($c)),o}dispose(){this.mixer.stopAllAction(),this.root.removeFromParent()}}const yr=new Ct,$c=new Ct,jc=new C,Lx=new C(0,1,0),ys=new C,Uo=new C,Ms=new C,Wr=new C,Dr=new Ct,Kc=new Ct,za=new Ct;function Dx(r){return r.matrixWorld.decompose(Uo,Dr,Wr),1/Math.max(1e-5,Wr.x)}function Nx(r){const e={};return r.traverse(t=>{if(!t.isBone)return;const n=t.name.replace(/^mixamorig:?/i,"");/^RightArm$|RightUpperArm/i.test(n)&&!e.rArm?e.rArm=t:/^RightForeArm$|RightLowerArm/i.test(n)&&!e.rFore?e.rFore=t:/^RightHand$/i.test(n)&&!e.rHand?e.rHand=t:/^LeftArm$|LeftUpperArm/i.test(n)&&!e.lArm?e.lArm=t:/^LeftForeArm$|LeftLowerArm/i.test(n)&&!e.lFore?e.lFore=t:/^LeftHand$/i.test(n)&&!e.lHand&&(e.lHand=t)}),e.rArm&&e.lArm?e:null}function Mr(r,e,t,n,i,s){!r||!e||(r.getWorldPosition(Uo),e.getWorldPosition(Ms),Ms.sub(Uo),!(Ms.lengthSq()<1e-8)&&(Ms.normalize(),Wr.set(t,n,i).normalize(),Dr.setFromUnitVectors(Ms,Wr),r.getWorldQuaternion(Kc),Dr.multiply(Kc),r.parent.getWorldQuaternion(za),za.invert().multiply(Dr),r.quaternion.slerp(za,s),r.updateMatrixWorld(!0)))}function Jc(r,e){if(!r)return;const t=e==null?1:Math.max(0,Math.min(1,e));t<=0||(Mr(r.rArm,r.rFore,-.28,-1,.02,.92*t),Mr(r.lArm,r.lFore,.28,-1,.02,.92*t),Mr(r.rFore,r.rHand,-.08,-1,.05,.85*t),Mr(r.lFore,r.lHand,.08,-1,.05,.85*t))}function Zc(r,e=2.15,t=1.05){const n=new D(new Qt(t,.12),new ut({color:789010,transparent:!0,opacity:.82,depthWrite:!1}));n.position.y=e;const i=new D(new Qt(t,.09),new ut({color:16347926,depthWrite:!1}));i.position.y=e,i.position.z=.02;const s=new D(new Qt(t+.06,.16),new ut({color:16498468,transparent:!0,opacity:.35,depthWrite:!1}));return s.position.y=e,s.position.z=-.01,r.add(s,n,i),r.userData.hpBar=i,r.userData.hpBarBg=n,r.userData.hpBarFrame=s,r.userData.hpBarWidth=t,r}function Ge(r,e=1){return new ut({color:r,transparent:!0,opacity:e,depthWrite:!1,blending:gn,side:rn})}function wr(r,e=1){return new ut({color:r,transparent:e<1,opacity:e,depthWrite:!1})}function br(r,e,t,n){const i=Math.hypot(e,t,n)||1;r.quaternion.setFromUnitVectors(new C(0,1,0),new C(e/i,t/i,n/i))}class Ux{constructor(e,t,n){this.scene=e,this.camera=t,this.floatLayer=n,this.particles=[],this.rings=[],this.bolts=[],this.patches=[],this.slashes=[],this.shake=0,this.hitStop=0,this.timeScale=1,this._tmp=new C}spawnBurst(e,t,n,i,s=14,a=4){const o=new Le(.1,6,6),l=Ge(i,1);for(let c=0;c<s;c++){const h=new D(o,l.clone());h.position.set(e,t,n);const u=new C(Math.random()-.5,Math.random()*.9+.15,Math.random()-.5).normalize();this.scene.add(h),this.particles.push({mesh:h,vel:u.multiplyScalar(a*(.55+Math.random())),life:.4+Math.random()*.4,max:.8})}}spawnEmbers(e,t,n,i=16347926,s=18){for(let a=0;a<s;a++){const o=new D(new Le(.04+Math.random()*.05,5,5),Ge(a%2?16639626:i,1));o.position.set(e,t,n);const l=new C((Math.random()-.5)*2,Math.random()*1.4+.3,(Math.random()-.5)*2).normalize();this.scene.add(o),this.particles.push({mesh:o,vel:l.multiplyScalar(3+Math.random()*5),life:.5+Math.random()*.5,max:1})}}spawnSlash(e,t,n,i=16639626,s=2.5,a=Math.PI*.95){const o=Math.sin(n),l=Math.cos(n),c=e+o*s*.22,h=t+l*s*.22,u=new Wi(s*.28,s*.98,40,1,-a*.5,a),d=Ge(i,.98),f=new D(u,d);f.rotation.x=-Math.PI/2,f.rotation.z=-n,f.position.set(c,.62,h),this.scene.add(f),this.slashes.push({mesh:f,life:.2,max:.2});const m=new D(new Wi(s*.72,s*1.05,32,1,-a*.45,a*.9),Ge(16777215,.9));m.rotation.x=-Math.PI/2,m.rotation.z=-n,m.position.set(c,.82,h),this.scene.add(m),this.slashes.push({mesh:m,life:.12,max:.12});const _=new D(new Qt(s*1.2,.7),Ge(i,.55));_.position.set(c+o*.4,1,h+l*.4),_.rotation.y=n,_.rotation.x=-.35,this.scene.add(_),this.slashes.push({mesh:_,life:.12,max:.12});for(let g=0;g<5;g++){const p=(g/4-.5)*a*.85,x=n+p,y=c+Math.sin(x)*s*.55,v=h+Math.cos(x)*s*.55,A=new D(new Le(.08,6,6),Ge(g%2?16777215:i,.95));A.position.set(y,.9+Math.random()*.3,v),this.scene.add(A),this.particles.push({mesh:A,vel:new C(Math.sin(x)*3,2+Math.random()*2,Math.cos(x)*3),life:.25,max:.25})}}spawnImpact(e,t,n=16498468){this.spawnRing(e,t,n,1.8,.22),this.spawnBurst(e,.9,t,n,12,6)}spawnRing(e,t,n,i=3,s=.4){const a=new Wi(.2,.35,32),o=Ge(n,.9),l=new D(a,o);l.rotation.x=-Math.PI/2,l.position.set(e,.08,t),this.scene.add(l),this.rings.push({mesh:l,life:s,max:s,maxR:i,color:n})}spawnBolt(e,t,n,i,s=10859772){this.spawnChainLightning(e,t,n,i,s,1)}spawnChainLightning(e,t,n,i,s=10859772,a=1){const o=new ht,l=10,c=Ge(s,.95),h=Ge(16777215,.98),u=(d,f,m,_,g=.55,p=1)=>{let x=d,y=f,v=1.25;for(let A=1;A<=l;A++){const E=A/l,T=d+(m-d)*E+(Math.random()-.5)*g*(A<l?1:0),P=f+(_-f)*E+(Math.random()-.5)*g*(A<l?1:0),b=1.05+Math.sin(E*Math.PI)*.9+(Math.random()-.5)*.25,M=T-x,I=b-v,B=P-y,z=Math.hypot(M,I,B)||.05,V=new D(new $t(.1*p,Math.max(.02,z-.14),4,8),c);V.position.set((x+T)*.5,(v+b)*.5,(y+P)*.5),br(V,M,I,B),o.add(V);const q=new D(new $t(.04*p,Math.max(.02,z-.1),3,6),h);if(q.position.copy(V.position),q.quaternion.copy(V.quaternion),o.add(q),a>0&&A>1&&A<l&&Math.random()<.5){const j=T+(Math.random()-.5)*1.4,Q=P+(Math.random()-.5)*1.4,N=b+.5+Math.random()*.6,$=Math.hypot(j-T,N-b,Q-P)||.2,W=new D(new $t(.04,Math.max(.05,$-.05),2,5),c.clone());W.position.set((T+j)*.5,(b+N)*.5,(P+Q)*.5),br(W,j-T,N-b,Q-P),o.add(W)}x=T,v=b,y=P}};u(e,t,n,i,.6,1.15),u(e+.08,t-.06,n+.08,i-.06,.28,.7);for(const[d,f]of[[e,t],[n,i]]){const m=new D(new Le(.22,12,12),h.clone());m.position.set(d,1.2,f),o.add(m);const _=new D(new Le(.42,12,12),Ge(s,.4));_.position.set(d,1.2,f),o.add(_)}this.spawnRing(n,i,s,1.6,.28),this.spawnBurst(n,1.2,i,s,14,7),this.spawnBurst(n,1.2,i,16777215,8,5),this.scene.add(o),this.bolts.push({mesh:o,life:.28,max:.28})}spawnStormLash(e,t,n,i,s=10859772){this.spawnChainLightning(e,t,n,i,s,2);const a=n-e,o=i-t,l=Math.hypot(a,o)||.1,c=new D(new $t(.18,Math.max(.2,l-.3),4,8),Ge(s,.35));c.position.set((e+n)*.5,1.15,(t+i)*.5),br(c,a,0,o),this.scene.add(c),this.bolts.push({mesh:c,life:.2,max:.2}),this.spawnRing(e,t,s,1.4,.25),this.spawnBurst(e,1.3,t,16777215,12,6)}createArrowMesh(e=3003583,t=10090212){const n=new ht,i=new D(new ft(.045,.05,1.15,8),wr(7877903,1));n.add(i);const s=new D(new ft(.065,.07,1.05,8),Ge(e,.55));n.add(s);const a=new D(new wt(.12,.32,7),wr(15197668,1));a.position.y=.7,n.add(a);const o=new D(new wt(.16,.36,7),Ge(t,.7));o.position.y=.7,n.add(o);for(let h=0;h<2;h++){const u=new D(new We(.22,.2,.03),wr(e,.95));u.position.y=-.45,u.rotation.y=h*Math.PI/2,u.rotation.x=.15,n.add(u)}const l=new D(new We(.08,.08,.08),wr(4472892,1));l.position.y=-.58,n.add(l);const c=new D(new Qt(.12,.9),Ge(e,.35));return c.position.y=-.15,c.rotation.y=Math.PI/2,n.add(c),n.userData.trail=c,n}createArcaneBoltMesh(e=10859772){const t=new ht,n=new D(new Le(.2,16,16),Ge(16777215,.98));t.add(n);const i=new D(new Le(.36,16,16),Ge(e,.6));t.add(i);const s=new D(new Le(.55,14,14),Ge(e,.2));t.add(s);for(let o=0;o<4;o++){const l=o/4*Math.PI*2,c=new D(new Mn(.1,0),Ge(16777215,.75));c.position.set(Math.cos(l)*.22,Math.sin(l*1.3)*.12,Math.sin(l)*.22),t.add(c)}for(let o=0;o<3;o++){const l=new D(new Rt(.26+o*.1,.028,6,22),Ge(e,.8-o*.15));l.rotation.x=Math.PI/2+o*.55,l.rotation.y=o*.9,t.add(l),o===0&&(t.userData.spinRing=l)}const a=new D(new Qt(.22,.9),Ge(e,.4));return a.position.y=-.35,t.add(a),t.userData.trail=a,t}createFireballMesh(e=16347926,t=16639626){const n=new ht,i=new D(new Le(.3,16,16),Ge(16777215,.98));n.add(i);const s=new D(new Le(.52,16,16),Ge(e,.88));n.add(s);const a=new D(new Le(.68,14,14),Ge(t,.4));n.add(a);const o=new D(new Le(.9,12,12),Ge(e,.18));n.add(o);for(let l=0;l<7;l++){const c=l/7*Math.PI*2,h=new D(new wt(.11+l%2*.04,.5+l%3*.08,6),Ge(l%2?t:e,.8));h.position.set(Math.cos(c)*.28,.12,Math.sin(c)*.28),h.rotation.x=Math.PI+.35,h.rotation.z=c,n.add(h)}for(let l=0;l<6;l++){const c=l/6*Math.PI*2,h=new D(new Le(.05,6,6),Ge(t,.95));h.position.set(Math.cos(c)*.55,Math.sin(c*2)*.15,Math.sin(c)*.55),n.add(h)}return n.userData.pulse=s,n}spawnMuzzleFlash(e,t,n,i=0){const s=Math.sin(i),a=Math.cos(i);this.spawnBurst(e+s*.4,1.2,t+a*.4,n,10,5),this.spawnBurst(e+s*.4,1.2,t+a*.4,16777215,6,3);const o=new D(new Le(.28,10,10),Ge(n,.9));o.position.set(e+s*.35,1.2,t+a*.35),this.scene.add(o),this.bolts.push({mesh:o,life:.08,max:.08})}spawnArcaneBolt(e,t,n,i,s=10859772){const a=new ht,o=n-e,l=i-t,c=Math.hypot(o,l)||.1,h=Math.max(5,Math.min(16,Math.floor(c*1.8)));for(let d=0;d<=h;d++){const f=d/h,m=e+o*f,_=t+l*f,g=1.15+Math.sin(f*Math.PI)*.3,p=d===h?.22:.07+(1-f)*.12,x=new D(new Le(p,10,10),Ge(d===h||d%2===0?16777215:s,.4+f*.6));x.position.set(m,g,_),a.add(x)}const u=new D(new Le(.36,12,12),Ge(s,.45));u.position.set(n,1.2,i),a.add(u);for(let d=1;d<h;d+=2){const f=d/h,m=new D(new Rt(.16+f*.08,.03,6,14),Ge(s,.6));m.position.set(e+o*f,1.15+Math.sin(f*Math.PI)*.2,t+l*f),m.lookAt(n,1.2,i),a.add(m)}this.scene.add(a),this.bolts.push({mesh:a,life:.22,max:.22}),this.spawnBurst(n,1.2,i,s,12,6)}spawnArrowShot(e,t,n,i,s=3003583){const a=this.createArrowMesh(s,16777215),o=n-e,l=i-t,c=Math.hypot(o,l)||.1;a.position.set((e+n)*.5,1.2,(t+i)*.5),br(a,o,0,l),a.scale.set(1,Math.min(1.6,.7+c*.08),1),this.scene.add(a),this.bolts.push({mesh:a,life:.18,max:.18}),this.spawnBurst(n,1.15,i,s,8,4)}spawnArrowVolley(e,t,n,i=3003583,s=7){for(let a=0;a<s;a++){const o=a/s*Math.PI*2+Math.random()*.3,l=Math.random()*n*.85,c=e+Math.cos(o)*l,h=t+Math.sin(o)*l,u=c+(Math.random()-.5)*1.5,d=h-2.5-Math.random();this.spawnArrowShot(u,d,c,h,a%2===0?i:16777215),this.spawnImpact(c,h,i)}this.spawnRing(e,t,i,n,.45)}spawnFanArrows(e,t,n,i=3003583,s=8,a=5,o=.55){for(let l=0;l<a;l++){const c=a===1?.5:l/(a-1),h=n+(c-.5)*o,u=e+Math.sin(h)*s,d=t+Math.cos(h)*s;this.spawnArrowShot(e,t,u,d,l===Math.floor(a/2)?16777215:i)}}spawnFireballExplosion(e,t,n=16347926,i=4){this.spawnRing(e,t,n,i,.55),this.spawnRing(e,t,16639626,i*.7,.4),this.spawnRing(e,t,16777215,i*.4,.28),this.spawnEmbers(e,1.2,t,n,28),this.spawnBurst(e,1.4,t,16639626,22,11),this.spawnBurst(e,.6,t,n,18,8);const s=new D(new ft(.2,i*.45,2.8,18,1,!0),Ge(n,.55));s.position.set(e,1.4,t),this.scene.add(s),this.slashes.push({mesh:s,life:.45,max:.45});const a=new D(new on(i*.55,28),Ge(8138002,.5));a.rotation.x=-Math.PI/2,a.position.set(e,.06,t),this.scene.add(a),this.slashes.push({mesh:a,life:.8,max:.8})}spawnNova(e,t,n=16347926,i=4){this.spawnRing(e,t,n,i,.5),this.spawnRing(e,t,16777215,i*.55,.28),this.spawnBurst(e,1,t,n,28,10),this.spawnBurst(e,.4,t,16639626,16,6);const s=new D(new ft(.15,i*.35,2.2,16,1,!0),Ge(n,.45));s.position.set(e,1.1,t),this.scene.add(s),this.slashes.push({mesh:s,life:.4,max:.4})}spawnFrostNova(e,t,n=10859772,i=5){this.spawnNova(e,t,n,i),this.spawnRing(e,t,14739455,i*.85,.45),this.spawnRing(e,t,16777215,i*.45,.3);const s=new D(new ft(i*.15,i*.5,1.8,16,1,!0),Ge(13095678,.35));s.position.set(e,.95,t),this.scene.add(s),this.slashes.push({mesh:s,life:.5,max:.5});for(let a=0;a<12;a++){const o=a/12*Math.PI*2,l=i*(.28+a%3*.12),c=new D(new wt(.09+a%2*.04,.5+a%4*.12,5),Ge(a%2?16777215:n,.92)),h=e+Math.cos(o)*l,u=t+Math.sin(o)*l;if(c.position.set(h,.7+a%3*.15,u),c.rotation.z=o,c.rotation.x=.35+a%2*.2,this.scene.add(c),this.slashes.push({mesh:c,life:.5,max:.5}),a%2===0){const d=new D(new Mn(.14+a%3*.04,0),Ge(n,.75));d.position.set(h,.25,u),this.scene.add(d),this.slashes.push({mesh:d,life:.65,max:.65})}}}spawnGroundRise(e,t,n=16347926){this.spawnRing(e,t,n,1.6,.4),this.spawnRing(e,t,16777215,.9,.22),this.spawnBurst(e,.15,t,n,16,5),this.spawnBurst(e,.4,t,16639626,8,3.5);const i=new D(new ft(.12,.45,1.6,10,1,!0),Ge(n,.55));i.position.set(e,.8,t),this.scene.add(i),this.slashes.push({mesh:i,life:.35,max:.35})}spawnPatch(e,t,n,i=2,s=2.5){const a=new on(i,28),o=Ge(n,.45),l=new D(a,o);l.rotation.x=-Math.PI/2,l.position.set(e,.05,t),this.scene.add(l),this.patches.push({mesh:l,life:s,max:s,radius:i,x:e,z:t,dps:0,burn:!1})}floatText(e,t,n,i,s=""){if(!this.floatLayer)return;const a=new C(e,t,n);a.project(this.camera);const o=document.createElement("div");o.className=`float-text ${s}`,o.textContent=i;const l=(a.x*.5+.5)*window.innerWidth,c=(-a.y*.5+.5)*window.innerHeight;o.style.left=`${l}px`,o.style.top=`${c}px`,this.floatLayer.appendChild(o),setTimeout(()=>o.remove(),900)}addShake(e){this.shake=Math.min(1.2,this.shake+e)}addHitStop(e=.05){this.hitStop=Math.min(.09,Math.max(this.hitStop,e))}update(e){this.hitStop>0?(this.hitStop=Math.max(0,this.hitStop-e),this.timeScale=this.hitStop>0?.12:1):this.timeScale=1;const t=e;for(let n=this.particles.length-1;n>=0;n--){const i=this.particles[n];i.life-=t,i.mesh.position.addScaledVector(i.vel,t),i.vel.y-=6*t,i.mesh.material.opacity=Math.max(0,i.life/i.max),i.mesh.scale.setScalar(Math.max(.1,i.life/i.max)),i.life<=0&&(this.scene.remove(i.mesh),i.mesh.geometry?.dispose?.(),i.mesh.material?.dispose?.(),this.particles.splice(n,1))}for(let n=this.rings.length-1;n>=0;n--){const i=this.rings[n];i.life-=t;const s=1-i.life/i.max,a=.3+s*i.maxR;i.mesh.scale.set(a,a,a),i.mesh.material.opacity=(1-s)*.85,i.life<=0&&(this.scene.remove(i.mesh),i.mesh.geometry.dispose(),i.mesh.material.dispose(),this.rings.splice(n,1))}for(let n=this.bolts.length-1;n>=0;n--){const i=this.bolts[n];i.life-=t;const s=i.max||.25,a=Math.max(0,i.life/s);i.mesh.traverse?.(o=>{o.material&&"opacity"in o.material&&(o.userData?.baseOp??o.material.opacity,o.userData?.baseOp==null&&(o.userData={...o.userData||{},baseOp:o.material.opacity}),o.material.opacity=(o.userData.baseOp??1)*a)}),i.mesh.material&&"opacity"in i.mesh.material&&(i.mesh.material.opacity=a),i.life<=0&&(this._disposeObject(i.mesh),this.bolts.splice(n,1))}for(let n=this.patches.length-1;n>=0;n--){const i=this.patches[n];i.life-=t,i.mesh.material.opacity=.15+.35*(i.life/i.max),i.mesh.scale.setScalar(.9+Math.sin(performance.now()*.01)*.05),i.life<=0&&(this.scene.remove(i.mesh),i.mesh.geometry.dispose(),i.mesh.material.dispose(),this.patches.splice(n,1))}for(let n=this.slashes.length-1;n>=0;n--){const i=this.slashes[n];i.life-=t;const s=1-i.life/Math.max(.001,i.max||.2);i.mesh.scale.setScalar(1+s*.35),i.mesh.material&&"opacity"in i.mesh.material&&(i.mesh.material.opacity=Math.max(0,(1-s)*.95)),i.mesh.position.y+=t*.8,i.life<=0&&(this._disposeObject(i.mesh),this.slashes.splice(n,1))}this.shake=Math.max(0,this.shake-t*2.8)}applyCameraShake(e,t){if(this.shake<=0){t.position.copy(e);return}const n=this.shake*.35;t.position.set(e.x+(Math.random()-.5)*n,e.y+(Math.random()-.5)*n*.5,e.z+(Math.random()-.5)*n)}_disposeObject(e){e&&(this.scene.remove(e),e.traverse?.(t=>{t.geometry?.dispose?.(),Array.isArray(t.material)?t.material.forEach(n=>n?.dispose?.()):t.material?.dispose?.()}),e.geometry?.dispose?.(),Array.isArray(e.material)?e.material.forEach(t=>t?.dispose?.()):e.material?.dispose?.())}clear(){[...this.particles,...this.rings,...this.bolts,...this.patches,...this.slashes].forEach(e=>this._disposeObject(e.mesh)),this.particles=[],this.rings=[],this.bolts=[],this.patches=[],this.slashes=[],this.shake=0,this.hitStop=0}}class kx{constructor(e){this.canvas=e,this.keys=new Set,this.mouse={x:0,y:0,down:!1,worldX:0,worldZ:0,rightDown:!1},this.move={x:0,z:0},this.attackPressed=!1,this.abilityPressed={q:!1,e:!1,r:!1,dodge:!1},this.pausePressed=!1,this.modePressed=!1,this.debugPressed=!1,this._touchId=null,this._stick={active:!1,ox:0,oy:0,x:0,y:0},this.stickVec={x:0,z:0},this.lookDelta={x:0,y:0},this.zoomDelta=0,this._lastX=0,this._lastY=0,this._looking=!1,window.addEventListener("keydown",i=>this._onKey(i,!0)),window.addEventListener("keyup",i=>this._onKey(i,!1)),e.addEventListener("pointerdown",i=>this._onPointerDown(i)),e.addEventListener("pointermove",i=>this._onPointerMove(i)),window.addEventListener("pointerup",i=>this._onPointerUp(i)),window.addEventListener("blur",()=>this.reset()),e.addEventListener("contextmenu",i=>{i.preventDefault(),i.stopPropagation()}),document.addEventListener("contextmenu",i=>{(i.target===e||e.contains?.(i.target))&&i.preventDefault()}),e.addEventListener("wheel",i=>{i.preventDefault(),this.zoomDelta+=Math.sign(i.deltaY)*.12},{passive:!1});const t=document.getElementById("stick-base"),n=document.getElementById("stick-knob");if(t&&n){t.addEventListener("pointerdown",s=>{s.preventDefault(),t.setPointerCapture(s.pointerId),this._stick.active=!0,this._touchId=s.pointerId;const a=t.getBoundingClientRect();this._stick.ox=a.left+a.width/2,this._stick.oy=a.top+a.height/2,this._updateStick(s.clientX,s.clientY,n,a.width/2)}),t.addEventListener("pointermove",s=>{if(!this._stick.active||s.pointerId!==this._touchId)return;const a=t.getBoundingClientRect();this._updateStick(s.clientX,s.clientY,n,a.width/2)});const i=s=>{s.pointerId===this._touchId&&(this._stick.active=!1,this.stickVec.x=0,this.stickVec.z=0,n.style.transform="translate(-50%, -50%)")};t.addEventListener("pointerup",i),t.addEventListener("pointercancel",i)}document.querySelectorAll(".touch-btn").forEach(i=>{const s=i.dataset.ability,a=o=>{o.preventDefault(),s==="attack"?this.attackPressed=!0:s==="q"?this.abilityPressed.q=!0:s==="e"?this.abilityPressed.e=!0:s==="r"?this.abilityPressed.r=!0:s==="dodge"?this.abilityPressed.dodge=!0:s==="mode"&&(this.modePressed=!0)};i.addEventListener("pointerdown",a)})}_updateStick(e,t,n,i){let s=e-this._stick.ox,a=t-this._stick.oy;const o=Math.hypot(s,a)||1,l=Math.min(o,i*.7);s=s/o*l,a=a/o*l,n.style.transform=`translate(calc(-50% + ${s}px), calc(-50% + ${a}px))`,this.stickVec.x=s/(i*.7),this.stickVec.z=a/(i*.7)}_onKey(e,t){const n=e.key.toLowerCase();([" ","arrowup","arrowdown","arrowleft","arrowright"].includes(n)||e.code==="Space")&&e.preventDefault(),t?(this.keys.add(n),(n===" "||n==="j")&&(this.attackPressed=!0),(n==="1"||n==="q")&&(this.abilityPressed.q=!0),(n==="2"||n==="e")&&(this.abilityPressed.e=!0),(n==="3"||n==="r")&&(this.abilityPressed.r=!0),n==="shift"&&(this.abilityPressed.dodge=!0),(n==="v"||n==="tab")&&(e.preventDefault(),this.modePressed=!0),(n==="escape"||n==="p")&&(this.pausePressed=!0),(e.code==="F3"||n==="f3")&&(e.preventDefault(),this.debugPressed=!0)):this.keys.delete(n)}_onPointerDown(e){if(!e.target.closest?.(".hud, .screen, .ability-btn, .touch-zone")){if(this.mouse.x=e.clientX,this.mouse.y=e.clientY,this._lastX=e.clientX,this._lastY=e.clientY,e.button===0)this.mouse.down=!0,this.attackPressed=!0;else if(e.button===2){this.mouse.rightDown=!0,this._looking=!0;try{this.canvas.setPointerCapture?.(e.pointerId)}catch{}}}}_onPointerMove(e){if(this.mouse.x=e.clientX,this.mouse.y=e.clientY,this._looking||this.mouse.rightDown){const t=e.clientX-this._lastX,n=e.clientY-this._lastY;this.lookDelta.x+=t,this.lookDelta.y+=n,this._lastX=e.clientX,this._lastY=e.clientY}}_onPointerUp(e){e&&e.button===2?(this.mouse.rightDown=!1,this._looking=!1):(!e||e.button===0||e.button==null)&&(this.mouse.down=!1,(!e||e.button==null)&&(this.mouse.rightDown=!1,this._looking=!1))}reset(){this.keys.clear(),this.mouse.down=!1,this.mouse.rightDown=!1,this._looking=!1,this.move.x=0,this.move.z=0,this.stickVec.x=0,this.stickVec.z=0,this.lookDelta.x=0,this.lookDelta.y=0,this.zoomDelta=0}consumeLook(){const e={dx:this.lookDelta.x,dy:this.lookDelta.y,zoom:this.zoomDelta,looking:this._looking||this.mouse.rightDown};return this.lookDelta.x=0,this.lookDelta.y=0,this.zoomDelta=0,e}poll(){let e=0,t=0;(this.keys.has("w")||this.keys.has("arrowup"))&&(t-=1),(this.keys.has("s")||this.keys.has("arrowdown"))&&(t+=1),(this.keys.has("a")||this.keys.has("arrowleft"))&&(e-=1),(this.keys.has("d")||this.keys.has("arrowright"))&&(e+=1),e+=this.stickVec.x,t+=this.stickVec.z;const n=Math.hypot(e,t);n>1?(e/=n,t/=n):n>0&&n<1e-6&&(e=0,t=0),this.move.x=e,this.move.z=t;const i={attack:this.attackPressed,q:this.abilityPressed.q,e:this.abilityPressed.e,r:this.abilityPressed.r,dodge:this.abilityPressed.dodge,pause:this.pausePressed,mode:this.modePressed};return this.attackPressed=!1,this.abilityPressed.q=!1,this.abilityPressed.e=!1,this.abilityPressed.r=!1,this.abilityPressed.dodge=!1,this.pausePressed=!1,this.modePressed=!1,i}}class Fx{constructor(){this.ctx=null,this.muted=!1,this.master=.32,this.sfxGain=1,this.musicGain=.34,this._music=null,this._musicEl=null,this._started=!1,this._noiseBuf=null}ensure(){if(!this.ctx){const e=window.AudioContext||window.webkitAudioContext;if(!e)return null;this.ctx=new e}return this.ctx.state==="suspended"&&this.ctx.resume().catch(()=>{}),this._started||(this._started=!0,this.playMusic("battle")),this.ctx}playMusic(e="battle"){if(this.muted)return;const t={battle:"assets/audio/music/battle.mp3",battle_alt:"assets/audio/music/battle_alt.mp3",victory_theme:"assets/audio/music/victory_theme.mp3"},n=t[e]||t.battle;try{this._musicEl||(this._musicEl=new Audio,this._musicEl.loop=!0,this._musicEl.preload="auto",this._musicEl.volume=this.musicGain);const i=this._musicEl;if(i.dataset.src===n&&!i.paused)return;i.dataset.src=n,i.src=n,i.loop=e!=="victory_theme",i.volume=this.musicGain;const s=i.play();s&&typeof s.catch=="function"&&s.catch(()=>{})}catch{}}stopMusic(){try{this._musicEl?.pause()}catch{}}setMusicVolume(e){this.musicGain=Math.max(0,Math.min(1,e)),this._musicEl&&(this._musicEl.volume=this.musicGain)}_bus(){const e=this.ensure();if(!e)return null;const t=e.createGain();return t.gain.value=this.master*this.sfxGain,t.connect(e.destination),{ctx:e,g:t}}tone({freq:e=440,dur:t=.1,type:n="square",gain:i=.2,slide:s=0,delay:a=0,dest:o=null}){if(this.muted)return;const l=this._bus();if(!l)return;const{ctx:c,g:h}=l,u=c.currentTime+a,d=c.createOscillator(),f=c.createGain();d.type=n,d.frequency.setValueAtTime(Math.max(20,e),u),s&&d.frequency.exponentialRampToValueAtTime(Math.max(40,e+s),u+t),f.gain.setValueAtTime(1e-4,u),f.gain.exponentialRampToValueAtTime(Math.max(1e-4,i),u+.012),f.gain.exponentialRampToValueAtTime(1e-4,u+t),d.connect(f),f.connect(o||h),d.start(u),d.stop(u+t+.03)}_noiseBuffer(e){if(this._noiseBuf)return this._noiseBuf;const t=e.sampleRate*.35,n=e.createBuffer(1,t,e.sampleRate),i=n.getChannelData(0);for(let s=0;s<t;s++)i[s]=Math.random()*2-1;return this._noiseBuf=n,n}noiseBurst({dur:e=.08,gain:t=.15,delay:n=0,filterFreq:i=1200,type:s="bandpass"}={}){if(this.muted)return;const a=this._bus();if(!a)return;const{ctx:o,g:l}=a,c=o.currentTime+n,h=o.createBufferSource();h.buffer=this._noiseBuffer(o);const u=o.createBiquadFilter();u.type=s,u.frequency.setValueAtTime(i,c),u.Q.value=.7;const d=o.createGain();d.gain.setValueAtTime(1e-4,c),d.gain.exponentialRampToValueAtTime(t,c+.008),d.gain.exponentialRampToValueAtTime(1e-4,c+e),h.connect(u),u.connect(d),d.connect(l),h.start(c),h.stop(c+e+.02)}hit(){this.slash()}slash(){this.noiseBurst({dur:.06,gain:.12,filterFreq:2800,type:"highpass"}),this.tone({freq:280,dur:.07,type:"sawtooth",gain:.14,slide:-160}),this.tone({freq:180,dur:.05,type:"triangle",gain:.1,delay:.015,slide:-60})}heavySlash(){this.noiseBurst({dur:.09,gain:.16,filterFreq:900,type:"lowpass"}),this.tone({freq:160,dur:.1,type:"sawtooth",gain:.18,slide:-90}),this.tone({freq:90,dur:.12,type:"triangle",gain:.14,delay:.02}),this.tone({freq:420,dur:.05,type:"square",gain:.08,delay:.04,slide:-200})}swipe(){this.noiseBurst({dur:.05,gain:.1,filterFreq:3200,type:"bandpass"}),this.tone({freq:360,dur:.06,type:"triangle",gain:.12,slide:-120})}arrow(){this.noiseBurst({dur:.04,gain:.08,filterFreq:4500,type:"highpass"}),this.tone({freq:880,dur:.05,type:"triangle",gain:.1,slide:-400}),this.tone({freq:1320,dur:.04,type:"sine",gain:.06,delay:.02,slide:-600})}arcBolt(){this.tone({freq:520,dur:.08,type:"sine",gain:.12,slide:280}),this.tone({freq:780,dur:.1,type:"triangle",gain:.1,delay:.02}),this.tone({freq:1040,dur:.06,type:"sine",gain:.07,delay:.05,slide:-200})}whirlwind(){this.noiseBurst({dur:.22,gain:.14,filterFreq:600,type:"bandpass"});for(let e=0;e<4;e++)this.tone({freq:200+e*40,dur:.08,type:"sawtooth",gain:.1,delay:e*.05,slide:-80})}groundSlam(){this.noiseBurst({dur:.15,gain:.2,filterFreq:180,type:"lowpass"}),this.tone({freq:55,dur:.22,type:"sine",gain:.22,slide:-20}),this.tone({freq:110,dur:.12,type:"triangle",gain:.14,delay:.03})}earthsplitter(){this.noiseBurst({dur:.18,gain:.16,filterFreq:280,type:"lowpass"}),this.tone({freq:70,dur:.2,type:"sawtooth",gain:.16,slide:40});for(let e=0;e<3;e++)this.tone({freq:140+e*30,dur:.08,type:"square",gain:.08,delay:.05+e*.04,slide:-50})}block(){this.tone({freq:240,dur:.06,type:"triangle",gain:.12}),this.tone({freq:360,dur:.1,type:"sine",gain:.1,delay:.02}),this.noiseBurst({dur:.05,gain:.08,filterFreq:1800,type:"bandpass"})}bash(){this.noiseBurst({dur:.08,gain:.14,filterFreq:500,type:"lowpass"}),this.tone({freq:120,dur:.1,type:"square",gain:.16,slide:-40}),this.tone({freq:200,dur:.06,type:"triangle",gain:.1,delay:.03})}charge(){this.tone({freq:180,dur:.16,type:"sawtooth",gain:.14,slide:320}),this.noiseBurst({dur:.12,gain:.1,filterFreq:900,type:"bandpass",delay:.02}),this.tone({freq:440,dur:.08,type:"triangle",gain:.1,delay:.08,slide:100})}frost(){this.noiseBurst({dur:.14,gain:.1,filterFreq:5e3,type:"highpass"}),this.tone({freq:920,dur:.12,type:"sine",gain:.11,slide:180}),this.tone({freq:1240,dur:.14,type:"triangle",gain:.09,delay:.04,slide:-120}),this.tone({freq:1560,dur:.1,type:"sine",gain:.06,delay:.08})}fireball(){this.noiseBurst({dur:.16,gain:.14,filterFreq:400,type:"lowpass"}),this.tone({freq:140,dur:.18,type:"sawtooth",gain:.16,slide:100}),this.tone({freq:280,dur:.12,type:"triangle",gain:.12,delay:.05,slide:200}),this.tone({freq:90,dur:.2,type:"sine",gain:.1,delay:.02})}fireburst(){this.noiseBurst({dur:.12,gain:.15,filterFreq:600,type:"bandpass"}),this.tone({freq:200,dur:.14,type:"sawtooth",gain:.15,slide:160}),this.tone({freq:360,dur:.1,type:"triangle",gain:.1,delay:.04})}lightning(){this.noiseBurst({dur:.08,gain:.16,filterFreq:3500,type:"highpass"}),this.tone({freq:1200,dur:.04,type:"square",gain:.12,slide:-800}),this.tone({freq:600,dur:.06,type:"sawtooth",gain:.1,delay:.03,slide:-300}),this.tone({freq:1800,dur:.03,type:"square",gain:.08,delay:.06})}volley(){for(let e=0;e<5;e++)this.tone({freq:700+e*60,dur:.04,type:"triangle",gain:.07,delay:e*.035,slide:-300});this.noiseBurst({dur:.12,gain:.08,filterFreq:3e3,type:"highpass"})}multishot(){for(let e=0;e<4;e++)this.tone({freq:900-e*40,dur:.045,type:"sine",gain:.08,delay:e*.025,slide:-250})}dodge(){this.noiseBurst({dur:.07,gain:.08,filterFreq:2200,type:"bandpass"}),this.tone({freq:480,dur:.08,type:"sine",gain:.1,slide:200})}crit(){this.tone({freq:620,dur:.08,type:"sawtooth",gain:.16,slide:240}),this.tone({freq:920,dur:.06,type:"triangle",gain:.1,delay:.03})}hurt(){this.tone({freq:90,dur:.16,type:"sawtooth",gain:.2,slide:-50}),this.noiseBurst({dur:.1,gain:.1,filterFreq:400,type:"lowpass"})}kill(){this.tone({freq:420,dur:.07,type:"triangle",gain:.12,slide:180}),this.tone({freq:640,dur:.05,type:"sine",gain:.08,delay:.04})}waveClear(){[523,659,784,1046].forEach((e,t)=>{this.tone({freq:e,dur:.16,type:"triangle",gain:.12,delay:t*.08})})}victory(){this.playMusic("victory_theme"),[392,523,659,784,1046].forEach((e,t)=>{this.tone({freq:e,dur:.2,type:"triangle",gain:.12,delay:t*.1})})}defeat(){this.tone({freq:220,dur:.35,type:"sawtooth",gain:.16,slide:-140}),this.tone({freq:110,dur:.4,type:"triangle",gain:.12,delay:.08})}ui(){this.tone({freq:660,dur:.05,type:"sine",gain:.08})}modeSwap(){this.tone({freq:300,dur:.06,type:"triangle",gain:.1,slide:200}),this.tone({freq:500,dur:.08,type:"sine",gain:.08,delay:.04})}playSkill(e,t="attack"){if(this.ensure(),!e){t==="dodge"?this.dodge():t==="q"?this.fireburst():t==="e"?this.lightning():t==="r"?this.charge():this.slash();return}const n=e.mode||"",i=e.element||"",s=(e.name||"").toLowerCase(),a=e.projectile||"";if(t==="dodge"||n==="dodge"){this.dodge();return}if(n==="block"||s.includes("block")){this.block();return}if(n==="whirlwind"){this.whirlwind();return}if(n==="groundslam"){this.groundSlam();return}if(n==="earthsplitter"){this.earthsplitter();return}if(n==="bash"){this.bash();return}if(n==="charge"){this.charge();return}if(n==="fireball"||a==="fireball"){this.fireball();return}if(n==="multishot"){this.multishot();return}if(e.volley){this.volley();return}if(e.frost||i==="frost"){this.frost();return}if(i==="lightning"||n==="stormlash"||s.includes("lash")){this.lightning();return}if(i==="fire"||s.includes("ember")||s.includes("burst")){this.fireburst();return}if(a==="arrow"||i==="shadow"){this.arrow();return}if(a==="arcane"||i==="arcane"||e.ranged){this.arcBolt();return}if(s.includes("heavy")||s.includes("cleave")){this.heavySlash();return}if(s.includes("swipe")){this.swipe();return}t==="q"?this.fireburst():t==="e"?this.lightning():t==="r"?this.charge():this.slash()}ability(e){e==="q"?this.fireburst():e==="e"?this.lightning():e==="r"?this.charge():e==="dodge"?this.dodge():this.slash()}}const di=["dance","wave","cheer","flourish","bounce","shimmy"];class Bx{constructor(e){this.row=e,this.items=[],this._raf=0,this._last=performance.now(),this._running=!1}build(){if(this.dispose(),!this.row)return;this.row.querySelectorAll(".class-card").forEach((t,n)=>{const i=t.dataset.classId,s=t.querySelector(".class-preview");if(!s||!i)return;let a=s.querySelector("canvas");a||(a=document.createElement("canvas"),a.width=256,a.height=256,s.appendChild(a)),s.classList.add("preview-rotatable"),s.title="Drag to rotate · auto emotes";try{const o=this._makeItem(a,s,i,n);this._wireRotate(o,s),this.items.push(o)}catch(o){console.warn("[classPreview]",i,o)}}),this.start()}_makeItem(e,t,n,i){const s=new jh({canvas:e,alpha:!0,antialias:!0,powerPreference:"low-power"});s.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5)),s.setSize(e.clientWidth||160,e.clientHeight||160,!1),s.setClearColor(0,0),s.outputColorSpace=Mt;const a=new Ch,o=new Bt(32,1,.1,40);o.position.set(0,1.55,4.2),o.lookAt(0,1.15,0),a.add(new cl(16777215,.55));const l=new is(16769200,1.15);l.position.set(2.5,5,3),a.add(l);const c=new is(8956671,.35);c.position.set(-3,2,-2),a.add(c);const h=new ol(16498468,.6,8);h.position.set(0,2.2,-1.5),a.add(h);const u=Gr(n,"twoHand");u.position.set(0,0,0),u.rotation.y=.35+i*.4,a.add(u);const d=new D(new on(.85,28),new ut({color:1708072,transparent:!0,opacity:.55,depthWrite:!1}));return d.rotation.x=-Math.PI/2,d.position.y=.01,a.add(d),{classId:n,host:t,canvas:e,renderer:s,scene:a,camera:o,mesh:u,t:Math.random()*10,userYaw:u.rotation.y,autoSpin:.12,dragging:!1,lastX:0,emote:di[i%di.length],emoteT:0,emoteDur:2.8+Math.random()*1.4}}_wireRotate(e,t){const n=a=>{a.preventDefault(),a.stopPropagation(),e.dragging=!0,e.lastX=a.clientX??a.touches?.[0]?.clientX??0,t.setPointerCapture?.(a.pointerId)},i=a=>{if(!e.dragging)return;a.preventDefault();const o=a.clientX??a.touches?.[0]?.clientX??e.lastX,l=o-e.lastX;e.lastX=o,e.userYaw+=l*.012,e.autoSpin=0},s=a=>{if(e.dragging){e.dragging=!1;try{t.releasePointerCapture?.(a.pointerId)}catch{}setTimeout(()=>{e.dragging||(e.autoSpin=.1)},1200)}};t.addEventListener("pointerdown",n),t.addEventListener("pointermove",i),t.addEventListener("pointerup",s),t.addEventListener("pointercancel",s),t.addEventListener("pointerleave",s),t.addEventListener("dblclick",a=>{a.preventDefault(),a.stopPropagation();const o=di.indexOf(e.emote);e.emote=di[(o+1)%di.length],e.emoteT=0}),e._unwire=()=>{t.removeEventListener("pointerdown",n),t.removeEventListener("pointermove",i),t.removeEventListener("pointerup",s),t.removeEventListener("pointercancel",s),t.removeEventListener("pointerleave",s)}}start(){if(this._running)return;this._running=!0,this._last=performance.now();const e=t=>{if(!this._running)return;const n=Math.min(.05,(t-this._last)/1e3);this._last=t,this._update(n),this._raf=requestAnimationFrame(e)};this._raf=requestAnimationFrame(e)}stop(){this._running=!1,this._raf&&cancelAnimationFrame(this._raf),this._raf=0}_applyEmote(e,t,n){const i=e.userData.body,s=e.userData.legL,a=e.userData.legR,o=e.userData.armL,l=e.userData.armR,c=e.userData.head,h=e.userData.cape;s&&(s.rotation.x=0,s.rotation.z=0),a&&(a.rotation.x=0,a.rotation.z=0);const u=Math.sin(n*Math.PI*2),d=Math.cos(n*Math.PI*2),f=Math.sin(n*Math.PI*4);if(t==="dance"?(i&&(i.rotation.z=u*.18),i&&(i.rotation.y=d*.08),o&&(o.rotation.x=-.4+u*.85,o.rotation.z=.35+f*.25),l&&(l.rotation.x=-.25-u*.7,l.rotation.z=-.25-f*.2),c&&(c.rotation.y=u*.25),h&&(h.rotation.x=.2+Math.abs(u)*.12),e.position.y=Math.abs(f)*.06):t==="wave"?(o&&(o.rotation.x=-1.6+f*.45,o.rotation.z=.9),l&&(l.rotation.x=.15,l.rotation.z=-.1),i&&(i.rotation.z=u*.05),c&&(c.rotation.y=.2+u*.15),e.position.y=0):t==="cheer"?(o&&(o.rotation.x=-2.2,o.rotation.z=.4+u*.15),l&&(l.rotation.x=-2.1,l.rotation.z=-.35-u*.15),i&&(i.rotation.x=-.08+Math.abs(u)*.06),e.position.y=Math.abs(u)*.1,c&&(c.rotation.x=-.15)):t==="flourish"?(l&&(l.rotation.x=-.6+u*1.1,l.rotation.y=d*.6,l.rotation.z=-.3+f*.4),o&&(o.rotation.x=.2,o.rotation.z=.25),i&&(i.rotation.y=u*.2),c&&(c.rotation.y=-u*.15),e.position.y=0):t==="bounce"?(e.position.y=Math.abs(f)*.14,s&&(s.rotation.x=Math.abs(u)*.15),a&&(a.rotation.x=Math.abs(d)*.15),o&&(o.rotation.z=.5+u*.3),l&&(l.rotation.z=-.5-u*.3),i&&(i.rotation.x=-Math.abs(f)*.08)):(i&&(i.rotation.z=f*.22),o&&(o.rotation.x=u*.5,o.rotation.z=.55),l&&(l.rotation.x=-u*.5,l.rotation.z=-.55),c&&(c.rotation.z=u*.12),e.position.y=Math.abs(u)*.03),e.userData.chestGem?.scale){const m=1+Math.sin(n*Math.PI*6)*.12;e.userData.chestGem.scale.setScalar(m)}}_update(e){for(const t of this.items){if(t.t+=e,t.emoteT+=e,t.emoteT>=t.emoteDur){t.emoteT=0,t.emoteDur=2.6+Math.random()*1.8;let o=t.emote;for(let l=0;l<4&&o===t.emote;l++)o=di[Math.random()*di.length|0];t.emote=o}const n=t.mesh;if(!n)continue;t.dragging||(t.userYaw+=e*t.autoSpin),n.rotation.y=t.userYaw;const i=t.emoteT/Math.max(.01,t.emoteDur)%1;this._applyEmote(n,t.emote,i+t.t*.15);const s=t.canvas.clientWidth||160,a=t.canvas.clientHeight||160;(t.canvas.width!==s||t.canvas.height!==a)&&(t.renderer.setSize(s,a,!1),t.camera.aspect=s/Math.max(1,a),t.camera.updateProjectionMatrix()),t.renderer.render(t.scene,t.camera)}}setSelected(e){for(const t of this.items)t.mesh&&t.mesh.scale.setScalar(t.classId===e?1.06:1)}dispose(){this.stop();for(const e of this.items)try{e._unwire?.(),e.renderer?.dispose(),e.scene?.traverse(t=>{t.geometry?.dispose?.(),Array.isArray(t.material)?t.material.forEach(n=>n?.dispose?.()):t.material?.dispose?.()})}catch{}this.items=[]}}const ko={duel:{id:"duel",name:"Duel of Champions",icon:"⚔",tagline:"1v1 · best of 3 rounds",desc:"A mirror of your own power. Face a rival champion in single combat — first to two round wins takes the crown. No waves, no help: two full class kits and the board between you.",rules:["Best of 3 rounds","Full class kits on both sides","Champions reset each round"],accent:"#e11d48"},rush:{id:"rush",name:"Ember Rush",icon:"⏱",tagline:"Score race · 120 seconds",desc:"One board, one horde, two champions. Waves never stop for 120 seconds — every kill you land is yours, every kill the rival steals is theirs. Highest score when the clock dies wins. Fall in battle and you respawn — but the clock keeps running.",rules:["120s timer · shared waves","Kills credit whoever lands them","Deaths cost 3s of respawn time"],accent:"#f59e0b"},last:{id:"last",name:"Last Sanctum",icon:"🕯",tagline:"Survival gauntlet · last champion standing",desc:"Endless escalating waves hunt you both, and the horde always turns on whoever stands closest. No respawns. Outlast the rival champion — if they fall first, the sanctum is yours.",rules:["Endless escalating waves","Enemies hunt the nearest champion","No respawns — last one standing wins"],accent:"#8b5cf6"}},Ox=["duel","rush","last"];let zx=0;class Hx{constructor(e,{classId:t=null,mode:n="duel"}={}){this.game=e,this.mode=n,this.classId=t||Vr[Math.random()*Vr.length|0];const i=Xt[this.classId]||Xt.warrior;this.cls=i,this.id=`rival_${++zx}`,this.typeId="rival",this.isRival=!0,this.def={id:"rival",name:`Rival ${i.name}`,radius:.8,score:0,color:i.color,accent:14753096,scale:1,attackRange:0,attackCd:999,isRival:!0},this.x=0,this.z=6,this.facing=Math.PI,this.maxHp=Math.floor(i.maxHp*(n==="duel"?1:1.35)),this.hp=this.maxHp,this.alive=!0,this.riseT=0,this.riseMax=0,this.stun=0,this.burn=0,this.burnDps=0,this.hitFlash=0,this.knockVx=0,this.knockVz=0,this.actor=null,this.vx=0,this.vz=0,this.speed=i.speed*.92,this.invuln=0,this.dodgeT=0,this.attackAnim=0,this.attackAnimMax=.24,this.walkPhase=0,this.walkAmp=0,this.respawnT=0,this.kills=0;const s=i.abilities;this.cds={attack:.8,q:3.5+Math.random()*2,e:5+Math.random()*2,r:7+Math.random()*2,dodge:1.5},this._cdMax={attack:(s.attack.cooldown||.3)*1.9,q:(s.q.cooldown||5)*1.35,e:(s.e.cooldown||5)*1.35,r:(s.r.cooldown||5)*1.45,dodge:2.6},this._strafeDir=Math.random()<.5?1:-1,this._strafeT=2+Math.random()*2,this._buildMesh()}_buildMesh(){this.mesh=Gr(this.classId,"twoHand"),this.mesh.name="rival",this.mesh.userData.groundRing&&this.mesh.userData.groundRing.material.color.setHex(14753096),this.mesh.userData.aura&&this.mesh.userData.aura.material.color.setHex(14753096),this.mesh.position.set(this.x,0,this.z),this.mesh.rotation.y=this.facing}dispose(){try{this.mesh&&(this.game.scene.remove(this.mesh),this.mesh.traverse?.(e=>{e.geometry?.dispose?.(),Array.isArray(e.material)?e.material.forEach(t=>t?.dispose?.()):e.material?.dispose?.()}),this.mesh=null)}catch{}}reset(e=0,t=6){this.hp=this.maxHp,this.alive=!0,this.stun=0,this.burn=0,this.hitFlash=0,this.knockVx=0,this.knockVz=0,this.vx=0,this.vz=0,this.invuln=1.2,this.respawnT=0,this.x=e,this.z=t,this.mesh||this._buildMesh(),this.mesh.visible=!0,this.mesh.position.set(e,0,t),this.mesh.parent!==this.game.scene&&this.game.scene.add(this.mesh)}hurt(e){!this.alive||this.invuln>0||(this.hp-=e,this.hitFlash=.14,this.invuln=.4,this.game.vfx.floatText(this.x,2,this.z,`-${Math.floor(e)}`,""),this.hp<=0&&(this.die(),this.mode==="rush"&&(this.respawnT=3)))}die(){this.hp=0,this.alive=!1,this.game.vfx.spawnBurst(this.x,1.1,this.z,14753096,30,8),this.game.vfx.spawnRing(this.x,this.z,14753096,3,.4),this.game.audio.kill(),this.mesh&&(this.mesh.visible=!1)}_target(){const e=this.game;if(this.mode==="duel")return e.player.alive?e.player:null;let t=null,n=1/0;for(const i of e.enemies){if(!i.alive||i.riseT>0||i.def?.isRival)continue;const s=Math.hypot(i.x-this.x,i.z-this.z);s<n&&(n=s,t=i)}return t}_dealTo(e,t,n={}){const i=this.game;this.mode==="duel"?i._hurtPlayer(t):e&&e.def&&i._rivalDamageEnemy(this,e,t,n.crit||!1,n.knock||null)}update(e){const t=this.game;if(!this.alive){if(this.mode==="rush"&&this.respawnT>0&&(this.respawnT-=e,this.respawnT<=0)){const h=Math.random()*Math.PI*2;this.reset(Math.cos(h)*6,Math.sin(h)*6),t.ui.toast("Rival respawned")}return}this.invuln>0&&(this.invuln-=e),this.attackAnim>0&&(this.attackAnim-=e);for(const h of Object.keys(this.cds))this.cds[h]>0&&(this.cds[h]-=e);if(this.stun>0){this.mode!=="duel"&&(this.stun-=e),this._syncMesh(e,0);return}if(this.mode!=="duel"&&this.burn>0&&(this.burn-=e,this.hp-=(this.burnDps||0)*e,this.hp<=0)){this.die(),this.mode==="rush"&&(this.respawnT=3);return}this.hitFlash>0&&(this.hitFlash-=e);const n=this._target(),i=this.cls.abilities,s=!!i.attack.ranged,a=s?(i.attack.range||8)*.75:(i.attack.range||2.8)*.8;let o=0,l=0;if(n){const h=n.x-this.x,u=n.z-this.z,d=Math.hypot(h,u)||1,f=h/d,m=u/d;if(this.facing=Math.atan2(h,u),this._strafeT-=e,this._strafeT<=0&&(this._strafeDir*=-1,this._strafeT=1.6+Math.random()*2.2),d>a*1.15?(o=f,l=m):d<a*.55?(o=-f,l=-m):(o=-m*this._strafeDir,l=f*this._strafeDir),this.dodgeT<=0&&this.cds.dodge<=0&&Math.random()<e*.5&&(this.cds.dodge=this._cdMax.dodge,this.dodgeT=.18,this.invuln=Math.max(this.invuln,.22),this.vx=-m*this._strafeDir*ge.dodgeSpeed*.9,this.vz=f*this._strafeDir*ge.dodgeSpeed*.9,t.vfx.spawnBurst(this.x,.5,this.z,14753096,10,5)),this.cds.attack<=0&&d<=(s?i.attack.range:i.attack.range+.6)){this.cds.attack=this._cdMax.attack,this.attackAnim=.24,this.attackAnimMax=.24;try{t.audio.playSkill?.(i.attack,"attack")}catch{}s?t._spawnRivalProjectile(this,{kind:i.attack.projectile==="arrow"?"arrow":"arcane",speed:(i.attack.speed||22)*.9,range:i.attack.range,damage:i.attack.damage*.85}):(t.vfx.spawnSlash(this.x,this.z,this.facing,14753096,i.attack.range,i.attack.arc||Math.PI),d<=(i.attack.range||2.8)+(n.def?.radius||.6)&&this._dealTo(n,i.attack.damage*.85,{knock:{knock:4,fx:f,fz:m}}))}if(this.cds.q<=0&&d<6.5){this.cds.q=this._cdMax.q,(i.q.element||"ember")==="frost"?t.vfx.spawnFrostNova(this.x,this.z,this.cls.accent,4):t.vfx.spawnNova(this.x,this.z,this.cls.color,4),t.vfx.addShake(.25);const g=this.mode==="duel"?[t.player.alive?t.player:null].filter(Boolean):t.enemies.filter(p=>p.alive&&!p.riseT&&!p.def?.isRival);for(const p of g)Math.hypot(p.x-this.x,p.z-this.z)<=4+(p.def?.radius||.6)&&this._dealTo(p,(i.q.damage||20)*.8)}if(this.cds.e<=0&&d<=(i.e.range||8)&&(this.cds.e=this._cdMax.e,t.vfx.spawnChainLightning(this.x,this.z,n.x,n.z,this.cls.accent,1),this._dealTo(n,(i.e.damage||18)*.85)),this.cds.r<=0&&(d>a*1.8||this.hp<this.maxHp*.3)){this.cds.r=this._cdMax.r;const _=this.hp<this.maxHp*.3?-1:1,g=Math.min(6.5,d),p=this.x+f*g*_,x=this.z+m*g*_,y=At(p,x);t.vfx.spawnRing(this.x,this.z,this.cls.accent,1.8,.25),this.x=y.x,this.z=y.z,this.invuln=Math.max(this.invuln,.35),t.vfx.spawnRing(this.x,this.z,this.cls.accent,2.2,.3),t.vfx.spawnBurst(this.x,1,this.z,this.cls.accent,14,6)}}if(this.dodgeT>0)this.dodgeT-=e,this.x+=this.vx*e,this.z+=this.vz*e;else{const h=this.speed,u=Math.min(1,12*e);this.vx+=(o*h-this.vx)*u,this.vz+=(l*h-this.vz)*u,this.x+=this.vx*e,this.z+=this.vz*e}this.mode!=="duel"&&(this.knockVx||this.knockVz)&&(this.x+=this.knockVx*e,this.z+=this.knockVz*e,this.knockVx*=Math.max(0,1-8*e),this.knockVz*=Math.max(0,1-8*e));const c=At(this.x,this.z,ge.arenaRadius-.8);this.x=c.x,this.z=c.z,this._syncMesh(e,Math.hypot(this.vx,this.vz))}_syncMesh(e,t){const n=this.mesh;if(!n)return;const s=t>.6?Math.min(1,t/6):0;this.walkAmp+=(s-this.walkAmp)*Math.min(1,10*e),this.walkAmp>.02&&(this.walkPhase+=e*(4.5+t*.55));const a=this.walkPhase;n.position.set(this.x,Math.sin(a*2)*.05*this.walkAmp,this.z),n.rotation.y=this.facing;const o=Math.sin(a)*.78*this.walkAmp;if(n.userData.legL&&(n.userData.legL.rotation.x=o),n.userData.legR&&(n.userData.legR.rotation.x=-o),n.userData.armL&&(n.userData.armL.rotation.x=-o*.7),n.userData.armR)if(this.attackAnim>0){const l=1-this.attackAnim/(this.attackAnimMax||.24);n.userData.armR.rotation.x=-Math.sin(l*Math.PI)*.9}else n.userData.armR.rotation.x=o*.3;n.visible=this.alive&&(this.invuln<=0||Math.floor(performance.now()*.018)%2===0)}}function ss(){return{levelsCleared:0,bossDefeated:!1,levelBest:{}}}function Ds(r={}){const e={unlocked:1,bestScores:{},realms:{},...r};for(const t of Lt){const n=e.realms[t.id]||{};e.realms[t.id]={...ss(),...n,levelBest:{...n.levelBest||{}}},t.index<(e.unlocked||1)}return e.realms.ember=e.realms.ember||ss(),e}function Xr(){try{const r=localStorage.getItem(Jh);return r?Ds(JSON.parse(r)):Ds()}catch{return Ds()}}function Vx(r){localStorage.setItem(Jh,JSON.stringify(Ds(r)))}function Ts(r,e){if(e<=0||e<(r.unlocked||1))return!0;const t=Lt[e-1];return t?!!r.realms?.[t.id]?.bossDefeated:!1}function Gx(r,e){const t=r.realms?.[e]||ss(),n=ge.levelsPerRealm;return t.bossDefeated?n:Math.min(n,(t.levelsCleared||0)+1)}function Qc(r,e,t){const n=Lt.find(i=>i.id===e);return!n||!Ts(r,n.index)?!1:t<=Gx(r,e)}function eh(r,e,t){const n=r.realms?.[e]||ss();return t<ge.levelsPerRealm?(n.levelsCleared||0)>=t:!!n.bossDefeated}function ws(r){return`#${(r>>>0).toString(16).padStart(6,"0")}`}class Wx{constructor({onCampaign:e,onSelectArena:t,onPause:n,onResume:i,onRestart:s,onMenu:a,onNext:o,onHow:l,onSettings:c,onSettingsChange:h,onClassPick:u,onModeToggle:d,onStartLevel:f,onStartPvp:m,onFullscreen:_}){this._onSettingsChange=h,this._onStartLevel=f,this._onStartPvp=m,this._onFullscreen=_,this._campaignMode=!0,this._detailArenaId=null,this.els={title:document.getElementById("screen-title"),how:document.getElementById("screen-how"),settings:document.getElementById("screen-settings"),arena:document.getElementById("screen-arena"),pvp:document.getElementById("screen-pvp"),campaign:document.getElementById("screen-campaign"),realmDetail:document.getElementById("screen-realm-detail"),pause:document.getElementById("screen-pause"),wave:document.getElementById("screen-wave"),result:document.getElementById("screen-result"),hud:document.getElementById("hud"),hpFill:document.getElementById("hp-fill"),hpText:document.getElementById("hp-text"),hearts:document.getElementById("hearts"),score:document.getElementById("score-text"),combo:document.getElementById("combo-text"),waveText:document.getElementById("wave-text"),arenaName:document.getElementById("arena-name"),pvpStatus:document.getElementById("pvp-status"),champLabel:document.getElementById("champ-label"),abilityBar:document.getElementById("ability-bar"),status:document.getElementById("status-icons"),toast:document.getElementById("toast"),resultEyebrow:document.getElementById("result-eyebrow"),resultTitle:document.getElementById("result-title"),resultFlavor:document.getElementById("result-flavor"),resultScore:document.getElementById("result-score"),resultWave:document.getElementById("result-wave"),resultKills:document.getElementById("result-kills"),resultCombo:document.getElementById("result-combo"),btnNext:document.getElementById("btn-result-next"),waveArena:document.getElementById("wave-banner-arena"),waveTitle:document.getElementById("wave-banner-title"),waveSub:document.getElementById("wave-banner-sub"),classRow:document.getElementById("class-row"),modeLabel:document.getElementById("mode-label"),debug:document.getElementById("debug-overlay"),campaignPath:document.getElementById("campaign-path"),realmLevels:document.getElementById("realm-levels"),realmDetailTitle:document.getElementById("realm-detail-title"),realmDetailSub:document.getElementById("realm-detail-sub"),realmDetailSwatch:document.getElementById("realm-detail-swatch")},this.abilityNodes={},this._abilityDefs=Xt.warrior.abilities,this._weaponMode="twoHand",this._showModeToggle=!0,this._onModeToggle=d,this._buildAbilities(this._abilityDefs,{showModeToggle:!0,weaponMode:"twoHand"}),this._onClassPick=u,this.classPreviews=null,this._buildClassPicker(),document.getElementById("btn-campaign")?.addEventListener("click",()=>{this._campaignMode=!0,e?.()}),document.getElementById("btn-arena-select")?.addEventListener("click",()=>{this._campaignMode=!1,t?.()}),document.getElementById("btn-pvp-back")?.addEventListener("click",()=>this.showOnly("title"));for(const g of["btn-fullscreen","btn-fullscreen-pause","btn-fs-hud"])document.getElementById(g)?.addEventListener("click",()=>this._onFullscreen?.());document.getElementById("btn-campaign-back")?.addEventListener("click",()=>this.showOnly("title")),document.getElementById("btn-realm-back")?.addEventListener("click",()=>{this.showCampaignMap(this._campaignMode)}),document.getElementById("btn-how-to")?.addEventListener("click",()=>{this.showOnly("how"),l?.()}),document.getElementById("btn-how-back")?.addEventListener("click",()=>this.showOnly("title")),document.getElementById("btn-settings")?.addEventListener("click",()=>c?.()),document.getElementById("btn-settings-back")?.addEventListener("click",()=>this.showOnly("title")),document.getElementById("btn-settings-test-sfx")?.addEventListener("click",()=>{window.dispatchEvent(new CustomEvent("ability-click",{detail:"attack"}));const g=window.__emberSanctum;g?.audio&&(g.audio.ensure(),g.audio.slash(),setTimeout(()=>g.audio.fireball(),120),setTimeout(()=>g.audio.arrow(),240),setTimeout(()=>g.audio.lightning(),360))}),this._wireSettingsInputs(),document.getElementById("btn-arena-back")?.addEventListener("click",()=>this.showOnly("title")),document.getElementById("btn-resume")?.addEventListener("click",i),document.getElementById("btn-restart-run")?.addEventListener("click",s),document.getElementById("btn-quit-menu")?.addEventListener("click",a),document.getElementById("btn-pause")?.addEventListener("click",n),document.getElementById("btn-result-restart")?.addEventListener("click",s),document.getElementById("btn-result-menu")?.addEventListener("click",a),document.getElementById("btn-result-next")?.addEventListener("click",o),this._onPickArena=null}_wireSettingsInputs(){const e=document.getElementById("set-music"),t=document.getElementById("set-sfx"),n=document.getElementById("set-mute"),i=document.getElementById("set-invert-y"),s=document.getElementById("set-music-val"),a=document.getElementById("set-sfx-val"),o=()=>{this._onSettingsChange?.({music:(Number(e?.value)||0)/100,sfx:(Number(t?.value)||0)/100,muted:!!n?.checked,invertY:!!i?.checked})};e?.addEventListener("input",()=>{s&&(s.textContent=`${e.value}%`),o()}),t?.addEventListener("input",()=>{a&&(a.textContent=`${t.value}%`),o()}),n?.addEventListener("change",o),i?.addEventListener("change",o)}showSettings(e){this.syncSettings(e),this.showOnly("settings")}syncSettings(e={}){const t=document.getElementById("set-music"),n=document.getElementById("set-sfx"),i=document.getElementById("set-mute"),s=document.getElementById("set-invert-y"),a=document.getElementById("set-music-val"),o=document.getElementById("set-sfx-val");t&&(t.value=String(Math.round((e.music??.34)*100))),n&&(n.value=String(Math.round((e.sfx??.9)*100))),a&&(a.textContent=`${t?.value??34}%`),o&&(o.textContent=`${n?.value??90}%`),i&&(i.checked=!!e.muted),s&&(s.checked=!!e.invertY)}setDebugVisible(e){const t=this.els.debug;t&&(t.classList.toggle("hidden",!e),t.setAttribute("aria-hidden",e?"false":"true"))}updateDebug(e){const t=this.els.debug;!t||t.classList.contains("hidden")||(t.innerHTML=`
      <div class="dbg-title">F3 DEBUG · v${e.version||ge.version}</div>
      <div>FPS ${e.fps?.toFixed?.(0)??"—"} · mode <b>${e.mode}</b></div>
      <div>${e.classId}${e.weaponMode?" · "+e.weaponMode:""} · ${e.arena}${e.campaign?" · campaign":""}</div>
      <div>L${e.level}/${e.levels} · wave ${e.waveInLevel}/${e.wavesPerLevel} (realm ${e.wave}/${e.maxWaves})</div>
      <div>enemies ${e.enemies} · proj ${e.projectiles} · plan ${e.plan}${e.boss?" · BOSS":""}</div>
      <div>HP ${Math.ceil(e.hp)}/${e.maxHp} · score ${e.score}</div>
      <div>pos ${e.pos} · pitch ${e.pitch} yaw ${e.yaw} zoom ${e.zoom}</div>
    `)}_buildClassPicker(){const e=this.els.classRow;if(e){e.innerHTML="";for(const t of Vr){const n=Xt[t],i=document.createElement("button");i.type="button",i.className="class-card",i.dataset.classId=t,i.innerHTML=`
        <div class="class-swatch" style="background:linear-gradient(135deg,${ws(n.color)},${ws(n.accent)})"></div>
        <div class="class-preview" data-preview="${t}" aria-hidden="true"></div>
        <div class="class-icon">${n.icon}</div>
        <h3>${n.name}</h3>
        <p>${n.tagline}</p>
        <span class="class-stat">HP ${n.maxHp} · SPD ${n.speed.toFixed(1)}</span>
      `,i.addEventListener("click",()=>this._onClassPick?.(t)),e.appendChild(i)}try{this.classPreviews?.dispose?.(),this.classPreviews=new Bx(e),requestAnimationFrame(()=>this.classPreviews?.build?.())}catch(t){console.warn("[class picker previews]",t)}}}setClassSelection(e){const t=this.els.classRow;t&&(t.querySelectorAll(".class-card").forEach(n=>{n.classList.toggle("selected",n.dataset.classId===e)}),this.classPreviews?.setSelected?.(e))}rebuildAbilities(e,t={}){this._abilityDefs=e||Xt.warrior.abilities,t.weaponMode&&(this._weaponMode=t.weaponMode),t.showModeToggle!=null&&(this._showModeToggle=!!t.showModeToggle),this._buildAbilities(this._abilityDefs,{showModeToggle:this._showModeToggle,weaponMode:this._weaponMode})}setWeaponMode(e,t){this._weaponMode=e||"twoHand";const n=t||Qn(this._weaponMode),i=this.abilityNodes.mode?.btn;if(i){const s=i.querySelector(".icon"),a=i.querySelector(".name");s&&(s.textContent=n.icon),a&&(a.textContent=n.short),i.title=`Stance: ${n.label} (V / Tab)`,i.dataset.mode=this._weaponMode,i.classList.toggle("mode-2h",this._weaponMode==="twoHand"),i.classList.toggle("mode-ss",this._weaponMode==="swordShield")}this.els.modeLabel&&(this.els.modeLabel.textContent=n.label,this.els.modeLabel.hidden=!this._showModeToggle),this.els.champLabel&&this._showModeToggle}_buildAbilities(e,t={}){const n=["attack","q","e","r","dodge"];this.els.abilityBar.innerHTML="",this.abilityNodes={};for(const i of n){const s=e[i];if(!s)continue;const a=document.createElement("button");a.className="ability-btn ready",a.dataset.ability=i,a.title=`${s.name} (${s.key})`,a.innerHTML=`
        <span class="key">${s.key}</span>
        <span class="icon">${s.icon}</span>
        <span class="name">${s.name}</span>
        <span class="cd-timer" aria-hidden="true"></span>
        <svg class="cd-ring" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r="32" pathLength="201"></circle>
        </svg>
      `,this.els.abilityBar.appendChild(a),this.abilityNodes[i]={btn:a,circle:a.querySelector("circle"),timer:a.querySelector(".cd-timer"),icon:a.querySelector(".icon"),name:a.querySelector(".name")},a.addEventListener("click",()=>{window.dispatchEvent(new CustomEvent("ability-click",{detail:i}))})}if(t.showModeToggle){const i=Qn(t.weaponMode||"twoHand"),s=document.createElement("button");s.className=`ability-btn mode-btn ready mode-${t.weaponMode==="swordShield"?"ss":"2h"}`,s.dataset.ability="mode",s.dataset.mode=t.weaponMode||"twoHand",s.title=`Stance: ${i.label} (V / Tab)`,s.innerHTML=`
        <span class="key">V</span>
        <span class="icon">${i.icon}</span>
        <span class="name">${i.short}</span>
        <span class="cd-timer" aria-hidden="true"></span>
        <svg class="cd-ring" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r="32" pathLength="201"></circle>
        </svg>
      `,this.els.abilityBar.appendChild(s),this.abilityNodes.mode={btn:s,circle:s.querySelector("circle"),timer:s.querySelector(".cd-timer"),icon:s.querySelector(".icon"),name:s.querySelector(".name")},s.addEventListener("click",()=>{window.dispatchEvent(new CustomEvent("ability-click",{detail:"mode"}))})}}showOnly(e){for(const t of["title","how","settings","arena","pvp","campaign","realmDetail","pause","wave","result"])this.els[t]?.classList.toggle("active",t===e)}hideMenus(){for(const e of["title","how","settings","arena","pvp","campaign","realmDetail","pause","wave","result"])this.els[e]?.classList.remove("active")}showPvpMenu(){const e=document.getElementById("pvp-grid");if(e){e.innerHTML="";for(const t of Ox){const n=ko[t],i=document.createElement("button");i.type="button",i.className="pvp-card",i.style.setProperty("--pvp-accent",n.accent),i.innerHTML=`
        <div class="pvp-icon">${n.icon}</div>
        <h3>${n.name}</h3>
        <p class="pvp-tagline">${n.tagline}</p>
        <p class="pvp-desc">${n.desc}</p>
        <ul class="pvp-rules">${n.rules.map(s=>`<li>${s}</li>`).join("")}</ul>
        <span class="pvp-cta">ENTER</span>
      `,i.addEventListener("click",()=>this._onStartPvp?.(t)),e.appendChild(i)}this.showOnly("pvp")}}setPvpStatus(e){const t=this.els.pvpStatus;t&&(e?(t.classList.remove("hidden"),t.textContent=e):(t.classList.add("hidden"),t.textContent=""))}showCampaignMap(e=!0){this._campaignMode=e;const t=Xr(),n=this.els.campaignPath||document.getElementById("campaign-path"),i=document.getElementById("campaign-map-title"),s=document.getElementById("campaign-map-sub");i&&(i.textContent=e?"Campaign — Realm Lineup":"Realm Select"),s&&(s.textContent=e?`${ge.levelsPerRealm} levels · ~4–8 waves per level (varies by realm) · boss on final level · locked until earned`:"Pick a realm board. Locked realms stay sealed until the previous Warden falls."),n&&(n.innerHTML="",Lt.forEach((a,o)=>{const l=Ts(t,o),h=!!(t.realms[a.id]||ss()).bossDefeated;let u=!1;if(l&&!h){u=!0;for(let p=0;p<o;p++)if(Ts(t,p)&&!t.realms[Lt[p].id]?.bossDefeated){u=!1;break}}const d=document.createElement("button");d.type="button",d.className="realm-node",l||d.classList.add("locked"),h&&d.classList.add("cleared"),u&&d.classList.add("current"),d.disabled=!l;const f=l?h?"CLEARED":u?"CURRENT":"AVAILABLE":"LOCKED",m=Bc(o),_=Hr(o),g=Ls(a.bossId||a.id);if(d.innerHTML=`
        <div class="realm-node-index">0${o+1}</div>
        <div class="realm-node-art" style="background-image:url('${a.art||""}'), ${a.swatch}">
          ${l?h?'<span class="art-lock done">✓</span>':"":'<span class="art-lock">🔒</span>'}
        </div>
        <div class="realm-node-body">
          <h3>${a.name}</h3>
          <p>${a.storyBeat||a.subtitle}</p>
          <div class="realm-meta">
            <span>${ge.levelsPerRealm} levels</span>
            <span>${m.min}–${m.max} waves / level</span>
            <span>~${_} total</span>
            <span class="boss-chip">☠ ${g.name}</span>
          </div>
          <div class="realm-progress-pips">
            ${Array.from({length:ge.levelsPerRealm},(p,x)=>{const y=x+1,v=eh(t,a.id,y),A=l&&Qc(t,a.id,y);return`<i class="pip ${v?"done":A?"open":"lock"}" title="Level ${y}"></i>`}).join("")}
          </div>
          <div class="realm-status ${f.toLowerCase()}">${f}</div>
        </div>
        ${l?h?'<div class="realm-lock-badge done">✓</div>':"":'<div class="realm-lock-badge">🔒</div>'}
      `,l&&d.addEventListener("click",()=>this.showRealmDetail(a.id,e)),n.appendChild(d),o<Lt.length-1){const p=document.createElement("div");p.className="realm-connector"+(l&&Ts(t,o+1)?" lit":""),n.appendChild(p)}}),this.showOnly("campaign"))}showRealmDetail(e,t=!0){this._campaignMode=t,this._detailArenaId=e;const n=Lt.find(l=>l.id===e);if(!n)return;const i=Xr();if(!Ts(i,n.index)){this.toast("Realm sealed — clear the previous Warden first.");return}const a=Ls(n.bossId||n.id);if(this.els.realmDetailTitle&&(this.els.realmDetailTitle.textContent=n.name),this.els.realmDetailSub){const l=Bc(n.index);this.els.realmDetailSub.textContent=`${n.storyBeat||n.subtitle} · ${ge.levelsPerRealm} levels · ${l.min}–${l.max} waves per level · Warden: ${a.name}, ${a.title}`}this.els.realmDetailSwatch&&(this.els.realmDetailSwatch.style.backgroundImage=n.art?`url('${n.art}')`:"",this.els.realmDetailSwatch.style.backgroundColor="transparent",this.els.realmDetailSwatch.style.backgroundSize="cover",this.els.realmDetailSwatch.style.backgroundPosition="center",n.art||(this.els.realmDetailSwatch.style.background=n.swatch));const o=this.els.realmLevels||document.getElementById("realm-levels");if(o){o.innerHTML="";for(let l=1;l<=ge.levelsPerRealm;l++){const c=Qc(i,e,l),h=eh(i,e,l),u=l===ge.levelsPerRealm,f=(i.realms[e]||ss()).levelBest?.[l],m=yi(n.index,l),_=document.createElement("button");_.type="button",_.className="level-card",c||_.classList.add("locked"),h&&_.classList.add("cleared"),c&&!h&&_.classList.add("available"),u&&_.classList.add("boss"),_.disabled=!c;const g=c?h?"CLEARED":"PLAY":"LOCKED",p=n.art||"";_.innerHTML=`
        <div class="level-art" style="background-image:url('${p}')"></div>
        <div class="level-body">
          <div class="level-num">LEVEL ${l}</div>
          <div class="level-title">${u?a.name:`Assault ${l}`}</div>
          <div class="level-waves">
            <strong>${m} waves</strong>
            ${u?`<span class="boss-tag">☠ ${a.title.toUpperCase()}</span>`:'<span class="elite-tag">ELITE FINISH</span>'}
          </div>
          <p class="level-wave-hint">${u?`${a.epithet} — survive the packs, then face ${a.name} and their signature attacks`:"Clear all packs in this stage · last pack is an elite"}</p>
          <div class="level-foot">
            <span class="level-status">${g}</span>
            <span class="level-best">${f!=null?`Best ${Math.floor(f)}`:"—"}</span>
          </div>
        </div>
      `,c&&_.addEventListener("click",()=>{this._onStartLevel?.(e,l,t)}),o.appendChild(_)}this.showOnly("realmDetail")}}setHudVisible(e){this.els.hud.classList.toggle("hidden",!e)}showArenaSelect(e){this._onPickArena=e,this.showCampaignMap(!1)}_renderHearts(e,t){const n=this.els.hearts;if(!n)return;const i=ge.hudHearts,s=Math.max(1,t||1),a=Math.max(0,Math.min(s,e||0)),o=a/s*i;if(n.children.length!==i){n.innerHTML="";for(let c=0;c<i;c++){const h=document.createElement("span");h.className="heart empty",h.setAttribute("role","img"),h.setAttribute("aria-hidden","true"),n.appendChild(h)}}const l=this._lastHeartUnits;for(let c=0;c<i;c++){const h=n.children[c],u=o-c;let d="empty";u>=.99?d="full":u>=.35&&(d="half");let f=`heart ${d}`;l!=null&&o<l&&c>=Math.floor(o)&&c<Math.ceil(l)&&(f+=" hit"),h.className!==f&&(h.className=f)}this._lastHeartUnits=o,n.setAttribute("aria-label",`Health ${Math.ceil(a)} of ${Math.ceil(s)}`)}updateHud({hp:e,maxHp:t,score:n,combo:i,wave:s,maxWaves:a,waveInLevel:o,wavesPerLevel:l,level:c,levels:h,arenaName:u,cds:d,statuses:f,className:m,weaponMode:_,modeSwapCd:g}){const p=Math.max(0,Math.min(1,e/Math.max(1,t)));this.els.hpFill&&(this.els.hpFill.style.width=`${p*100}%`),this.els.hpText&&(this.els.hpText.textContent=Math.ceil(e)),this._renderHearts(e,t),this.els.score.textContent=Math.floor(n).toLocaleString(),this.els.combo.textContent=`×${i.toFixed(1)}`;const x=o??s,y=l??4,v=c??1,A=h??3;if(this.els.waveText.textContent=`L${v}/${A} · W${x}/${y}`,this.els.arenaName.textContent=u,this.els.champLabel&&m)if(_){const E=Qn(_);this.els.champLabel.textContent=`${m} · ${E.short}`}else this.els.champLabel.textContent=m;_&&this.setWeaponMode(_);for(const[E,T]of Object.entries(this.abilityNodes)){if(E==="mode"){const I=g||0,B=I<=0;if(T.btn.classList.toggle("ready",B),T.btn.classList.toggle("cooling",!B),T.circle){const z=B?0:Math.min(1,I/.35);T.circle.style.strokeDashoffset=String(201*(1-z))}T.timer&&(B?(T.timer.textContent="",T.timer.classList.remove("show")):(T.timer.textContent=I.toFixed(1),T.timer.classList.add("show")));continue}const P=d[E]||{t:0,max:1},b=P.t<=0;T.btn.classList.toggle("ready",b),T.btn.classList.toggle("cooling",!b);const M=b?0:Math.min(1,P.t/Math.max(.001,P.max));if(T.circle&&(T.circle.style.strokeDashoffset=String(201*(1-M))),T.timer)if(b)T.timer.textContent="",T.timer.classList.remove("show");else{const I=P.t;T.timer.textContent=I>=10?String(Math.ceil(I)):I.toFixed(1),T.timer.classList.add("show")}}if(this.els.status.innerHTML="",f?.block){const E=document.createElement("span");E.className="status-chip block",E.textContent="BLOCK",this.els.status.appendChild(E)}if(f?.shock){const E=document.createElement("span");E.className="status-chip shock",E.textContent="SHOCK",this.els.status.appendChild(E)}if(f?.burn){const E=document.createElement("span");E.className="status-chip burn",E.textContent="BURN",this.els.status.appendChild(E)}if(f?.chill){const E=document.createElement("span");E.className="status-chip shock",E.textContent="CHILL",this.els.status.appendChild(E)}if(f?.root){const E=document.createElement("span");E.className="status-chip block",E.textContent="ROOTED",this.els.status.appendChild(E)}}showWaveBanner(e,t,n,i={}){this.els.waveArena.textContent=e.name,n||i.boss?(this.els.waveTitle.textContent=e.clearTitle||"REALM CLEARED",this.els.waveSub.textContent=i.boss?`Realm Warden fallen · ${e.clearFlavor||"The board is yours."}`:e.clearFlavor||"The realm steadies…"):i.levelClear?(this.els.waveTitle.textContent=`LEVEL ${i.level||"?"} CLEAR`,this.els.waveSub.textContent=`Level ${(i.level||0)+1}/${i.levels||3} rising…`):(this.els.waveTitle.textContent="WAVE CLEAR",this.els.waveSub.textContent=`L${i.level||1} · Wave cleared — next pack rising…`),this.els.wave.classList.add("active"),setTimeout(()=>this.els.wave.classList.remove("active"),i.levelClear||n?1600:1400)}showResult({victory:e,arena:t,score:n,wave:i,kills:s,bestCombo:a,canNext:o,level:l,eyebrow:c,title:h,flavor:u,waveLabel:d}){this.els.resultEyebrow.textContent=c||(e?"VICTORY":"DEFEAT"),this.els.resultTitle.textContent=h||(e?t.clearTitle:"Sanctum Falls"),this.els.resultFlavor.textContent=u||(e?t.clearFlavor:"The realm board darkens. Rise again, champion."),this.els.resultScore.textContent=Math.floor(n).toLocaleString(),this.els.resultWave.textContent=d||(l?`L${l} · W${i}`:String(i)),this.els.resultKills.textContent=String(s),this.els.resultCombo.textContent=`×${a.toFixed(1)}`,this.els.btnNext.hidden=!o,this.els.btnNext&&o&&(this.els.btnNext.textContent="Next Realm"),this.showOnly("result"),this.setHudVisible(!1)}toast(e){this.els.toast.textContent=e,this.els.toast.classList.add("show"),clearTimeout(this._toastT),this._toastT=setTimeout(()=>this.els.toast.classList.remove("show"),1600)}showBossDialogue(e,t,n,i={}){this.hideBossDialogue();const s=document.getElementById("screen-dialogue");if(!s||!e?.dialogue?.length){n?.();return}const a=[];t?.storyBeat&&a.push({speaker:"narrator",name:t.name,text:t.storyBeat});for(const p of e.dialogue)a.push(p);const o=ws(e.accent??16498468),l=ws(e.color??12131356),c=i.playerName||"You",h=ws(i.playerColor??16498468);let u=!1;const d=()=>{u||(u=!0,this.hideBossDialogue(),n?.())},f={i:0,typeTimer:null,typing:!1};this._dlg={state:f,finish:d,keyHandler:null};const m=()=>{const p=a[f.i];if(!p){d();return}const x=p.speaker==="boss",y=p.speaker==="narrator",v=y?p.name||"":x?e.name:c,A=x?e.title:"";s.innerHTML=`
        <div class="dlg-stage ${x?"dlg-boss":y?"dlg-narr":"dlg-player"}">
          <div class="dlg-panel" style="--dlg-accent:${x?o:h};--dlg-color:${x?l:"#1e1b4b"}">
            <div class="dlg-head">
              <span class="dlg-emblem">${x?"☠":y?"❖":"🛡"}</span>
              <span class="dlg-name">${v}</span>
              ${A?`<span class="dlg-title">${A}</span>`:""}
              <span class="dlg-count">${f.i+1}/${a.length}</span>
            </div>
            <p class="dlg-text" id="dlg-text"></p>
            <div class="dlg-foot">
              <button class="btn ghost dlg-skip" id="dlg-skip">Skip ⏭</button>
              <span class="dlg-hint">Click / Space — continue</span>
            </div>
          </div>
        </div>`;const E=s.querySelector("#dlg-text"),T=p.text||"";let P=0;f.typing=!0,clearInterval(f.typeTimer),f.typeTimer=setInterval(()=>{P+=2,E&&(E.textContent=T.slice(0,P),P>=T.length&&(clearInterval(f.typeTimer),f.typing=!1))},16),s.querySelector("#dlg-skip")?.addEventListener("click",b=>{b.stopPropagation(),d()})},_=()=>{const p=a[f.i];if(f.typing&&p){clearInterval(f.typeTimer),f.typing=!1;const x=s.querySelector("#dlg-text");x&&(x.textContent=p.text||"");return}f.i++,f.i>=a.length?d():m()};s.onclick=_;const g=p=>{p.key===" "||p.key==="Enter"?(p.preventDefault(),_()):p.key==="Escape"&&d()};this._dlg.keyHandler=g,window.addEventListener("keydown",g),s.classList.add("active"),m()}hideBossDialogue(){const e=document.getElementById("screen-dialogue");this._dlg&&(clearInterval(this._dlg.state?.typeTimer),this._dlg.keyHandler&&window.removeEventListener("keydown",this._dlg.keyHandler),this._dlg=null),e&&(e.classList.remove("active"),e.onclick=null,e.innerHTML="")}showPause(){this.els.pause.classList.add("active")}hidePause(){this.els.pause.classList.remove("active")}}function Xx(r,e=0){const t=Hr(e),n=$r(r,e),i=Ir(r,e),s=yi(e,n),a=1+(r-1)*.12+e*.14+(n-1)*.2,o=[],l=(d,f)=>{for(let m=0;m<f;m++)o.push(d)},c=r>=t,h=i===s&&!c;if(c)return l("boss",1),l("brute",Math.floor(1+e*.45)),l("stormling",Math.floor(2+a*.45)),l("wisp",Math.floor(3+a*.55)),{enemies:o,isBoss:!0,isRealmBoss:!0,isLevelBoss:!0,level:n,waveInLevel:i,wavesInLevel:s,label:"REALM WARDEN"};if(h)return l("brute",Math.floor(1+n*.45+e*.3)),l("stalker",Math.floor(2+a*.35)),l("stormling",Math.floor(1+a*.4)),l("wisp",Math.floor(3+a*.4)),{enemies:o,isBoss:!1,isRealmBoss:!1,isLevelBoss:!0,level:n,waveInLevel:i,wavesInLevel:s,label:`Level ${n} Elite`};const u=Math.floor(4+r*1.05+e+n);return l("wisp",Math.floor(u*.45)),l("brute",Math.max(0,Math.floor(u*.12+(r>2?1:0)))),l("stalker",Math.max(0,Math.floor(u*.18+(n>1?1:0)))),l("stormling",Math.max(0,Math.floor(u*.16+(n>2?1:0)))),o.length<4&&l("wisp",4-o.length),{enemies:o,isBoss:!1,isRealmBoss:!1,isLevelBoss:!1,level:n,waveInLevel:i,wavesInLevel:s,label:`L${n} Wave ${i}/${s}`}}function qx(r=0,e=8,t=null){const n=ge.arenaRadius-ge.spawnEdgeInset-.6,i=3.2;let s=null;for(let a=0;a<10;a++){const o=Math.random()*Math.PI*2+r*.7,l=Math.random(),c=i+(n-i)*Math.sqrt(l),h=(Math.random()-.5)*1.4,u=(Math.random()-.5)*1.4,d=Math.cos(o)*c+h,f=Math.sin(o)*c+u,m=Math.hypot(d,f);if(m>n){const _=n/m;s={x:d*_,z:f*_}}else s={x:d,z:f};if(!(t&&Math.hypot(s.x-t.x,s.z-t.z)<3))return s}return s||{x:i+2,z:0}}function Yx(r,e,t){const n=$r(e,t);return Math.floor(r*(1+(e-1)*.09+t*.09+(n-1)*.11))}const kn={yaw:Math.atan2(6,16),pitch:Math.atan2(14,Math.hypot(6,16))-.92,dist:Math.hypot(14,Math.hypot(6,16))/Math.hypot(ge.cameraHeight,ge.cameraOffset)};class $x{constructor(e,t={}){this.canvas=e,this.enemyLibs=t.enemies||null,this.mode="menu",this.campaign=!1,this.classId="warrior",this.weaponMode="twoHand",this.modeSwapCd=0,this.arenaId="ember",this.arena=Na("ember"),this.builtArena=null,this.wave=1,this.level=1,this.score=0,this.kills=0,this.combo=1,this.bestCombo=1,this.comboTimer=0,this.enemies=[],this.projectiles=[],this.cds=this._freshCds(),this.spawnQueue=[],this.bossCasts=[],this.pvp=null,this.rival=null,this.spawnTimer=0,this.waveClearTimer=0,this.pendingVictory=!1,this.pendingLevelClear=!1,this.time=0,this.settings=P_(),this.debug=!1,this._fps=60,this._fpsAcc=0,this._fpsFrames=0,this._lastWavePlan=null,this._bossDialoguePending=!1,this._activeBossProfile=null,this._dialogueResumeMode="playing",this._camTarget=new C,this._camPos=new C,this._look=new C,this._raycaster=new qf,this._ndc=new pe,this._groundPlane=new Jn(new C(0,1,0),0),this._hit=new C,this._slashFlip=!1,this._tmpQ=new Ct,this._invQ=new Ct,this.camOrbit={yaw:kn.yaw,pitch:kn.pitch,dist:kn.dist,targetYaw:kn.yaw,targetPitch:kn.pitch,targetDist:kn.dist,manualT:0},this._startLevel=1,this._runScoreBase=0,this._initThree(),this.audio=new Fx,this.input=new kx(e),this.vfx=new Ux(this.scene,this.camera,document.getElementById("float-layer")),this.player=xs(this.classId,this.weaponMode),this._attachPlayerVisual(),this.ui=new Wx({onCampaign:()=>this.openCampaignMap(!0),onSelectArena:()=>this.openPvpMenu(),onPause:()=>this.pause(),onResume:()=>this.resume(),onRestart:()=>this.restart(),onMenu:()=>this.toMenu(),onNext:()=>this.nextCampaignArena(),onHow:()=>this.audio.ui(),onSettings:()=>{this.audio.ui(),this.ui.showSettings(this.settings)},onSettingsChange:n=>this.applySettings(n),onClassPick:n=>this.setClass(n),onModeToggle:()=>this.toggleWeaponMode(),onStartLevel:(n,i,s)=>this.startArena(n,s,{startLevel:i}),onStartPvp:n=>this.startPvp(n),onFullscreen:()=>this.toggleFullscreen()}),this.ui.setClassSelection(this.classId),this.ui.rebuildAbilities(this._abilities(),{weaponMode:this.weaponMode,showModeToggle:this.classId==="warrior"}),this.ui.setWeaponMode?.(this.weaponMode,Qn(this.weaponMode)),this.applySettings(this.settings,!1),window.addEventListener("ability-click",n=>{try{const i=n.detail;if(i==="mode"){this.toggleWeaponMode();return}if(this.mode!=="playing")return;i==="attack"?this.tryAttack():i==="q"?this.tryAbilityQ():i==="e"?this.tryAbilityE():i==="r"?this.tryAbilityR():i==="dodge"&&this.tryDodge()}catch(i){console.error("[ability-click]",i)}}),window.addEventListener("resize",()=>this._onResize()),this._onResize(),this._showMenuShowcase(),this._last=performance.now(),requestAnimationFrame(n=>this._frame(n))}_classDef(){return Xt[this.classId]||Xt.warrior}_abilities(){return D_(this.classId,this.weaponMode)}toggleWeaponMode(e=null){if(this.classId!=="warrior"||this.mode==="playing"&&this.modeSwapCd>0&&e==null||this.mode==="playing"&&this.player&&!this.player.alive)return!1;const t=e==="twoHand"||e==="swordShield"?e:this.weaponMode==="twoHand"?"swordShield":"twoHand",n=t!==this.weaponMode;this.weaponMode=t,this.player&&(this.player.weaponMode=t),e==null&&n&&(this.modeSwapCd=ge.warriorModeCooldown);const i=this.cds;this.cds=this._freshCds();for(const a of Object.keys(this.cds))if(i[a]&&i[a].max>0){const o=i[a].t/i[a].max;this.cds[a].t=o*this.cds[a].max}if(this.player?.mesh?.userData?.weapon2H)Qh(this.player.mesh,t);else if(this.player&&(this.mode==="playing"||this.mode==="menu")){const a=this.player.x,o=this.player.z,l=this.player.facing,c=this.player.hp,h=this.player.alive;this._disposePlayerVisual(),this.player=xs(this.classId,t),this.player.x=a,this.player.z=o,this.player.facing=l,this.player.hp=c,this.player.alive=h,this._attachPlayerVisual(),this.player.mesh&&(this.player.mesh.position.set(a,0,o),this.player.mesh.rotation.y=l)}this.ui.rebuildAbilities(this._abilities(),{weaponMode:t,showModeToggle:!0});const s=Qn(t);this.ui.toast(`${s.label} stance`),this.ui.setWeaponMode?.(t,s);try{this.audio.modeSwap?this.audio.modeSwap():this.audio.ui()}catch{}return!0}_classColor(){return this._classDef().color}_classAccent(){return this._classDef().accent}_freshCds(){const e=this._abilities();return{attack:{t:0,max:e.attack.cooldown},q:{t:0,max:e.q.cooldown},e:{t:0,max:e.e.cooldown},r:{t:0,max:e.r.cooldown},dodge:{t:0,max:e.dodge.cooldown}}}setClass(e){Vr.includes(e)&&(this.classId=e,e==="warrior"?this.weaponMode=this.weaponMode||"twoHand":this.weaponMode="twoHand",this.audio.ui(),this.ui.setClassSelection(e),this.ui.rebuildAbilities(this._abilities(),{weaponMode:this.weaponMode,showModeToggle:e==="warrior"}),this.ui.setWeaponMode?.(this.weaponMode,Qn(this.weaponMode)),(this.mode==="menu"||this.mode==="result")&&(this._disposePlayerVisual(),this.player=xs(this.classId,this.weaponMode),this._attachPlayerVisual(),this.player.mesh.position.set(0,0,0),this.player.mesh.rotation.y=.6,this.player.mesh.visible=!0))}_disposePlayerVisual(){try{this.player?.actor&&(this.player.actor.dispose(),this.player.actor=null),this.player?.mesh&&(this.scene.remove(this.player.mesh),this.player.mesh.traverse?.(e=>{e.geometry?.dispose?.(),Array.isArray(e.material)?e.material.forEach(t=>t?.dispose?.()):e.material?.dispose?.()}),this.player.mesh=null)}catch(e){console.warn("[disposePlayerVisual]",e)}}_attachPlayerVisual(){try{this._disposePlayerVisual(),this.player.actor=null;const e=this.player.weaponMode||this.weaponMode||"twoHand";this.player.mesh=Gr(this.classId||this.player.classId||"warrior",e),this.scene.add(this.player.mesh),this.player.mesh.visible=!0}catch(e){console.error("[attachPlayerVisual]",e),this.player.actor=null,this.player.mesh=Gr("warrior",this.weaponMode||"twoHand"),this.scene.add(this.player.mesh),this.player.mesh.visible=!0}}_attachEnemyVisual(e){try{const t=Yc[e.typeId]||Yc.wisp,n=this.enemyLibs?.[t],i=e.def.isBoss?2.6:e.def.scale*1.55,s=n?Px(n,{height:i,tint:e.def.accent}):null;s?(s.play("Idle",{fade:0}),Zc(s.root,i+.25,e.def.isBoss?1.4:1.05),e.actor=s,e.mesh=s.root):(e.actor=null,e.mesh=Hc(e.typeId)),e.mesh.position.set(e.x,0,e.z),this.scene.add(e.mesh)}catch(t){console.error("[attachEnemyVisual]",t),e.actor=null,e.mesh=Hc(e.typeId),e.mesh.position.set(e.x,0,e.z),this.scene.add(e.mesh)}}_showMenuShowcase(){this.arena=Na("ember"),this.arenaId="ember",this.builtArena?.root&&this.scene.remove(this.builtArena.root),this.builtArena=Ua(this.arena),this.scene.add(this.builtArena.root),ka(this.scene,this.arena),this.player.mesh.visible=!0,this.player.mesh.position.set(0,0,0),this.player.mesh.rotation.y=.6,this.camera.position.set(6,14,16),this.camera.lookAt(0,.8,0)}_initThree(){this.renderer=new jh({canvas:this.canvas,antialias:!0,alpha:!1,powerPreference:"high-performance"}),this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),this.renderer.shadowMap.enabled=!0,this.renderer.shadowMap.type=nh,this.renderer.outputColorSpace=Mt,this.renderer.toneMapping=sh,this.renderer.toneMappingExposure=1.05,this.renderer.shadowMap&&(this.renderer.shadowMap.autoUpdate=!0),this.scene=new Ch,this.camera=new Bt(ge.cameraFov,1,.1,160),this.camera.position.set(0,ge.cameraHeight,ge.cameraOffset),this.camera.lookAt(0,0,0),this.scene.background=new Te(656914);const e=new cl(8141549,.45);this.scene.add(e);const t=new is(16498468,.95);t.position.set(5,14,8),t.castShadow=!0,t.shadow.mapSize.set(2048,2048),t.shadow.bias=-25e-5,this.scene.add(t);const n=new Gh(16762016,1706536,.35);this.scene.add(n)}_onResize(){const e=window.innerWidth,t=window.innerHeight;this.renderer.setSize(e,t,!1),this.camera.aspect=e/t,this.camera.updateProjectionMatrix()}applySettings(e={},t=!0){this.settings={...Lr(),...this.settings,...e},t&&I_(this.settings),this.audio.muted=!!this.settings.muted,this.audio.setMusicVolume?.(this.settings.music??.34),this.audio.sfxGain=Math.max(0,Math.min(1.2,this.settings.sfx??.9)),this.audio.master=this.settings.muted?0:.32,this._musicEl||this.audio._musicEl,this.ui.syncSettings?.(this.settings)}openCampaignMap(e=!0){this.audio.ui(),this.audio.ensure(),this.campaign=!!e,this.ui.showCampaignMap(e)}startCampaign(){this.openCampaignMap(!0)}_resetCameraToDefault(){const e=this.camOrbit;e.yaw=e.targetYaw=kn.yaw,e.pitch=e.targetPitch=kn.pitch,e.dist=e.targetDist=kn.dist,e.manualT=0;const t=Math.max(.18,Math.min(1.42,.92+e.pitch)),n=Math.hypot(ge.cameraHeight,ge.cameraOffset)*e.dist,i=Math.sin(t)*n,s=Math.cos(t)*n,a=this.player?.x||0,o=this.player?.z||0;this.camera.position.set(a+Math.sin(e.yaw)*s,Math.max(2.8,i),o+Math.cos(e.yaw)*s),this.camera.lookAt(a,.9,o)}startArena(e,t=!1,n={}){try{this._clearPvp(),this.audio.ensure(),this.audio.playMusic?.("battle"),this.campaign=t,this.arenaId=e,this.arena=Na(e);const i=Math.max(1,Math.min(ge.levelsPerRealm||5,n.startLevel||1));this._startLevel=i;const s=this.arena?.index??0,a=n.startWave||C_(s,i);this.wave=a,this.level=i,this.score=0,this.kills=0,this.combo=1,this.bestCombo=1,this.comboTimer=0,this.pendingVictory=!1,this.pendingLevelClear=!1,this.waveClearTimer=0,this.projectiles.forEach(l=>this._disposeProjectile(l)),this.projectiles=[],this._clearEnemies(),this.vfx.clear(),this.cds=this._freshCds(),this.ui.rebuildAbilities(this._abilities(),{weaponMode:this.weaponMode,showModeToggle:this.classId==="warrior"}),this.ui.setWeaponMode?.(this.weaponMode,Qn(this.weaponMode)),this.builtArena?.root&&this.scene.remove(this.builtArena.root),this.builtArena=Ua(this.arena),this.scene.add(this.builtArena.root),ka(this.scene,this.arena),this._disposePlayerVisual(),this.player=xs(this.classId,this.weaponMode),this._attachPlayerVisual(),this.player.mesh.position.set(0,0,0),this.player.mesh.rotation.set(0,0,0),this._resetCameraToDefault(),this.mode="playing",this.ui.hideMenus(),this.ui.setHudVisible(!0);const o=this.classId==="warrior"?` · ${Qn(this.weaponMode).short}`:"";this.ui.toast(`${this.arena.name} · L${i}/${ge.levelsPerRealm} · ${this._classDef().name}${o}`),this._beginWave(a)}catch(i){console.error("[startArena]",i),this.ui.toast("Failed to start — see console")}}_recordLevelProgress(e,t=!1){const n=Ds(Xr()),i=this.arenaId;n.realms[i]||(n.realms[i]={levelsCleared:0,bossDefeated:!1,levelBest:{}});const s=n.realms[i];s.levelsCleared=Math.max(s.levelsCleared||0,e);const a=s.levelBest[e]||0;if(s.levelBest[e]=Math.max(a,Math.floor(this.score)),n.bestScores[i]=Math.max(n.bestScores[i]||0,Math.floor(this.score)),t){s.bossDefeated=!0,s.levelsCleared=Math.max(s.levelsCleared,ge.levelsPerRealm);const o=this.arena.index;n.unlocked=Math.max(n.unlocked||1,Math.min(Lt.length,o+2))}Vx(n)}_clearEnemies(){for(const e of this.enemies)e.actor?e.actor.dispose():e.mesh&&this.scene.remove(e.mesh);this.enemies=[],this.spawnQueue=[]}_maxWaves(){return Hr(this.arena?.index??0)}_beginWave(e){this.wave=e,this.level=$r(e,this.arena.index);const t=Hr(this.arena.index),n=this.pvp?(e-1)%t+1:e,i=Xx(n,this.arena.index);if(this._lastWavePlan=i,i.isRealmBoss){const s=Ls(this.arena.bossId||this.arenaId);if(this._activeBossProfile=s,i.label=s.name,i.bossName=s.name,i.bossTitle=s.title,this.pvp){this.ui.toast(`${s.name} rises!`),this._finishBossDialogue(i);return}this._bossDialoguePending=!0,this._dialogueResumeMode=(this.mode==="playing","playing"),this.mode="dialogue",this.spawnQueue=[],this.spawnTimer=0,this.ui.showBossDialogue?.(s,this.arena,()=>this._finishBossDialogue(i),{playerName:this._classDef().name,playerColor:this._classDef().accent}),this.audio.playSkill?.({element:s.element||"solar",name:"boss"},"r");return}this.spawnQueue=i.enemies.map((s,a)=>({typeId:s,delay:a*.28})),this.spawnTimer=.6,i.isLevelBoss&&this.ui.toast(i.label)}_finishBossDialogue(e){this._bossDialoguePending=!1,this.mode="playing",this.ui.hideBossDialogue?.();const t=this._activeBossProfile||Ls(this.arenaId);this.ui.toast(`${t.name} — ${t.title}`),this.spawnQueue=[{typeId:"boss",delay:.15},...e.enemies.filter(n=>n!=="boss").map((n,i)=>({typeId:n,delay:.4+i*.25}))],this.spawnTimer=.35}pause(){this.mode==="playing"&&(this.mode="paused",this.ui.showPause())}resume(){this.mode==="paused"&&(this.mode="playing",this.ui.hidePause())}restart(){if(this.audio.ui(),this.pvp){const e=this.pvp.mode;this.startPvp(e);return}this.startArena(this.arenaId,this.campaign,{startLevel:this._startLevel||1})}toMenu(){this.mode="menu",this.ui.hideBossDialogue?.(),this._clearPvp(),this.ui.setHudVisible(!1),this.ui.showOnly("title"),this._clearEnemies(),this.vfx.clear(),this.projectiles.forEach(e=>this._disposeProjectile(e)),this.projectiles=[],this._showMenuShowcase()}nextCampaignArena(){const e=this.arena.index+1;if(e>=Lt.length){this.toMenu();return}this.campaign=!0,this.ui.showRealmDetail(Lt[e].id,!0)}openPvpMenu(){this.audio.ui(),this.audio.ensure(),this.ui.showPvpMenu()}toggleFullscreen(){try{document.fullscreenElement?document.exitFullscreen?.():(document.documentElement.requestFullscreen||document.documentElement.webkitRequestFullscreen)?.call(document.documentElement)}catch(e){console.warn("[fullscreen]",e)}}startPvp(e){try{const t=ko[e];if(!t)return;this._clearPvp(),this.audio.ensure(),this.audio.playMusic?.("battle_alt"),this.campaign=!1;const n=Lt[Math.random()*Lt.length|0];this.arenaId=n.id,this.arena=n,this._startLevel=1,this.wave=1,this.level=1,this.score=0,this.kills=0,this.combo=1,this.bestCombo=1,this.comboTimer=0,this.pendingVictory=!1,this.pendingLevelClear=!1,this.waveClearTimer=0,this.projectiles.forEach(i=>this._disposeProjectile(i)),this.projectiles=[],this._clearEnemies(),this.vfx.clear(),this.bossCasts=[],this.cds=this._freshCds(),this.ui.rebuildAbilities(this._abilities(),{weaponMode:this.weaponMode,showModeToggle:this.classId==="warrior"}),this.builtArena?.root&&this.scene.remove(this.builtArena.root),this.builtArena=Ua(this.arena),this.scene.add(this.builtArena.root),ka(this.scene,this.arena),this._disposePlayerVisual(),this.player=xs(this.classId,this.weaponMode),this._attachPlayerVisual(),this.player.x=0,this.player.z=-6,this.player.facing=0,this.player.mesh.position.set(0,0,-6),this.rival=new Hx(this,{mode:e}),this.rival.x=0,this.rival.z=6,this.scene.add(this.rival.mesh),Zc(this.rival.mesh,2.35,1.1),this.pvp={mode:e,round:1,wins:0,losses:0,timer:e==="rush"?120:0,rivalScore:0,playerRespawnT:0,resetT:0,over:!1},e==="duel"?(this.enemies.push(this.rival),this.spawnQueue=[]):this._beginWave(1),this._resetCameraToDefault(),this.mode="playing",this.ui.hideMenus(),this.ui.setHudVisible(!0),this.ui.toast(`${t.name} — ${this.arena.name} · vs Rival ${this.rival.cls.name}`)}catch(t){console.error("[startPvp]",t),this.ui.toast("Failed to start PVP — see console")}}_clearPvp(){this.rival&&(this.enemies=this.enemies.filter(e=>!e.def?.isRival),this.rival.dispose(),this.rival=null),this.pvp=null,this.bossCasts=[],this.ui?.setPvpStatus?.(null)}_pvpOnPlayerDeath(){if(!this.pvp||this.pvp.over)return!1;const e=this.pvp.mode;return e==="duel"?(this.pvp.losses++,this.player.alive=!1,this.player.mesh&&(this.player.mesh.visible=!1),this.vfx.spawnBurst(this.player.x,1.1,this.player.z,14753096,26,8),this.ui.toast(`Round ${this.pvp.round} — Rival takes it`),this.pvp.resetT=1.9,!0):e==="rush"?(this.player.alive=!1,this.player.mesh&&(this.player.mesh.visible=!1),this.pvp.playerRespawnT=3,this.ui.toast("Down! Respawning…"),!0):!1}_pvpRespawnPlayer(){const e=Math.random()*Math.PI*2;this.player.hp=this.player.maxHp,this.player.alive=!0,this.player.invuln=2,this.player.x=Math.cos(e)*5,this.player.z=Math.sin(e)*5,this.player.mesh&&(this.player.mesh.visible=!0,this.player.mesh.position.set(this.player.x,0,this.player.z)),this.vfx.spawnRing(this.player.x,this.player.z,this._classAccent(),2.4,.4)}_pvpRoundReset(){const e=this.pvp;e.round++,this.player.hp=this.player.maxHp,this.player.alive=!0,this.player.invuln=1.2,this.player.x=0,this.player.z=-6,this.player.blockT=0,this.player.statuses={},this.player.mesh&&(this.player.mesh.visible=!0,this.player.mesh.position.set(0,0,-6)),this.enemies=this.enemies.filter(t=>!t.def?.isRival),this.rival.reset(0,6),this.enemies.push(this.rival),this.projectiles.forEach(t=>this._disposeProjectile(t)),this.projectiles=[],this.cds=this._freshCds(),this.ui.toast(`Round ${e.round} — FIGHT`)}_updatePvp(e){const t=this.pvp;if(!(!t||t.over)){if(this.rival?.update(e),t.mode==="duel")t.resetT>0?(t.resetT-=e,t.resetT<=0&&(t.wins>=2||t.losses>=2?this._endPvp(t.wins>=2):this._pvpRoundReset())):this.rival&&!this.rival.alive&&(t.wins++,this.ui.toast(`Round ${t.round} — YOURS`),t.resetT=1.9);else if(t.mode==="rush"){if(t.timer-=e,t.playerRespawnT>0&&!this.player.alive&&(t.playerRespawnT-=e,t.playerRespawnT<=0&&this._pvpRespawnPlayer()),t.timer<=0){this._endPvp(this.score>=t.rivalScore);return}}else if(t.mode==="last"&&this.rival&&!this.rival.alive){this._endPvp(!0);return}this.ui.setPvpStatus(this._pvpStatusText())}}_pvpStatusText(){const e=this.pvp;if(!e)return"";if(e.mode==="duel"){const n=this.rival?Math.max(0,Math.round(this.rival.hp/this.rival.maxHp*100)):0;return`DUEL · Round ${e.round} · You ${e.wins} — ${e.losses} Rival · Rival HP ${n}%`}if(e.mode==="rush")return`⏱ ${Math.max(0,Math.ceil(e.timer))}s · You ${Math.floor(this.score)} — ${Math.floor(e.rivalScore)} Rival`;const t=this.rival?.alive?Math.max(0,Math.round(this.rival.hp/this.rival.maxHp*100)):0;return`LAST SANCTUM · Wave ${this.wave} · Rival HP ${t}%`}_endPvp(e){const t=this.pvp;if(!t||t.over)return;t.over=!0,this.mode="result",e?this.audio.victory():this.audio.defeat();const n=ko[t.mode];let i,s,a;t.mode==="duel"?(i=e?"Duel Won":"Duel Lost",s=e?`Your rival ${this.rival?.cls.name||"champion"} kneels. The crowd of embers roars.`:"The rival champion stands over you. Demand a rematch.",a=`Rounds ${t.wins}–${t.losses}`):t.mode==="rush"?(i=e?"Rush Champion":"Out-Rushed",s=e?"The clock died and your name burned brightest on the board.":"The rival read the horde better this time. Run it back.",a=`You ${Math.floor(this.score)} — ${Math.floor(t.rivalScore)}`):(i=e?"Last One Standing":"The Rival Outlasts You",s=e?"The rival champion fell to the horde — you did not. The sanctum is yours.":"You fell first. The rival claims the empty sanctum.",a=`Wave ${this.wave}`),this.ui.setPvpStatus(null),this.ui.showResult({victory:e,arena:this.arena,score:this.score,wave:this.wave,kills:this.kills,bestCombo:this.bestCombo,canNext:!1,eyebrow:`PVP — ${n?.name?.toUpperCase()||"MATCH"}`,title:i,flavor:s,waveLabel:a})}_updateRivalBody(e,t){if(e.alive){if(e.stun>0&&(e.stun-=t),e.burn>0&&(e.burn-=t,e.hp-=(e.burnDps||0)*t,e.hp<=0)){this._killEnemy(e);return}if(e.hitFlash>0&&(e.hitFlash-=t),e.knockVx||e.knockVz){e.x+=e.knockVx*t,e.z+=e.knockVz*t,e.knockVx*=Math.max(0,1-8*t),e.knockVz*=Math.max(0,1-8*t);const n=At(e.x,e.z,ge.arenaRadius-.8);e.x=n.x,e.z=n.z}e.mesh&&(this._updateEnemyHpBar(e),this._billboardHp(e.mesh))}}_rivalDamageEnemy(e,t,n,i=!1,s=null){!t.alive||t.def?.isRival||(t.hp-=n,t.hitFlash=.12,this.vfx.floatText(t.x,1.55+Math.random()*.3,t.z,`${Math.floor(n)}`,"shock"),s&&(t.knockVx=(t.knockVx||0)+s.fx*s.knock,t.knockVz=(t.knockVz||0)+s.fz*s.knock),t.hp<=0?this._killEnemy(t,{byRival:!0}):this._updateEnemyHpBar(t))}_spawnRivalProjectile(e,t={}){const n=t.kind||"arcane",i=Math.sin(e.facing),s=Math.cos(e.facing),a=n==="arrow"?this.vfx.createArrowMesh(14753096,16622767):this.vfx.createArcaneBoltMesh(14753096);n==="arrow"&&a.quaternion.setFromUnitVectors(new C(0,1,0),new C(i,0,s).normalize()),a.position.set(e.x+i*.6,1.2,e.z+s*.6),this.scene.add(a);const o=t.speed||18,l=t.range||8;this.projectiles.push({owner:"rival",kind:n,x:e.x+i*.6,z:e.z+s*.6,y:1.2,vx:i*o,vz:s*o,life:l/o+.15,maxLife:l/o+.15,travel:0,maxTravel:l,damage:t.damage||12,radius:.55,mesh:a,hitIds:new Set})}_startBossCast(e,t){const n=this.player.x,i=this.player.z,s=e.def.accent??16498468,a={e,name:t,t:0,max:.9,data:{}},o=(l,c,h,u)=>this.vfx.spawnRing(l,c,s,h,u);switch(t){case"meteor_ring":{a.max=1.05,a.data.points=[];for(let l=0;l<6;l++){const c=l/6*Math.PI*2+Math.random()*.4,h=At(n+Math.cos(c)*3.2,i+Math.sin(c)*3.2);a.data.points.push(h),o(h.x,h.z,1.5,a.max)}break}case"lava_burst":{a.max=.95,a.data.points=[];for(let l=0;l<4;l++){const c=At(n+(Math.random()-.5)*7,i+(Math.random()-.5)*7);a.data.points.push(c),o(c.x,c.z,1.7,a.max)}break}case"ember_charge":{a.max=.7;const l=n-e.x,c=i-e.z,h=Math.hypot(l,c)||1;a.data.nx=l/h,a.data.nz=c/h;for(let u=1;u<=4;u++){const d=u/4;o(e.x+l*d,e.z+c*d,1.1,a.max)}break}case"frost_nova":{a.max=.95,o(e.x,e.z,5.2,a.max);break}case"ice_shards":{a.max=.55,this.vfx.spawnBurst(e.x,1.6,e.z,6809849,14,5);break}case"glacial_lock":{a.max=.85,a.data.x=n,a.data.z=i,o(n,i,2.1,a.max);break}case"chain_bolt":{a.max=.55,this.vfx.spawnBurst(e.x,1.8,e.z,12891645,16,6);break}case"static_field":{a.max=.8,a.data.points=[];for(let l=0;l<3;l++){const c=At(n+(Math.random()-.5)*6,i+(Math.random()-.5)*6);a.data.points.push(c),o(c.x,c.z,2,a.max)}break}case"thunder_dive":{a.max=1,a.data.x=n,a.data.z=i,o(n,i,3.2,a.max);break}case"void_blink":{a.max=.5,this.vfx.spawnBurst(e.x,1.4,e.z,15235577,18,6);break}case"shadow_orbs":{a.max=.6,this.vfx.spawnRing(e.x,e.z,15235577,2.4,.6);break}case"mire_pull":{a.max=.9,a.data.x=n,a.data.z=i,o(n,i,2.6,a.max);break}case"solar_beam":{a.max=1.1;const l=n-e.x,c=i-e.z,h=Math.hypot(l,c)||1;a.data.nx=l/h,a.data.nz=c/h;for(let u=1;u<=6;u++)o(e.x+a.data.nx*u*2,e.z+a.data.nz*u*2,1,a.max);break}case"radiant_nova":{a.max=1.2,o(e.x,e.z,6.6,a.max);break}case"judgment_slam":{a.max=1,a.data.x=n,a.data.z=i,o(n,i,3.2,a.max),this.vfx.spawnRing(n,i,16777215,1.6,a.max);break}default:return}this.bossCasts.push(a)}_updateBossCasts(e){for(let t=this.bossCasts.length-1;t>=0;t--){const n=this.bossCasts[t];if(!n.e.alive){this.bossCasts.splice(t,1);continue}if(n.t+=e,n.t>=n.max){this.bossCasts.splice(t,1);try{this._resolveBossSpecial(n.e,n.name,n.data)}catch(i){console.error("[bossSpecial]",n.name,i)}}}}_playerIn(e,t,n){return this.player.alive&&Math.hypot(this.player.x-e,this.player.z-t)<=n}_hostilePatch(e,t,n,i,s,a,{chill:o=!1}={}){this.vfx.spawnPatch(e,t,n,i,s);const l=this.vfx.patches[this.vfx.patches.length-1];l&&(l.hostile=!0,l.dps=a,l.chill=o)}_applyPlayerStatus(e,t){this.player.statuses[e]=Math.max(this.player.statuses[e]||0,t),this.vfx.floatText(this.player.x,2.2,this.player.z,e.toUpperCase(),"shock")}_resolveBossSpecial(e,t,n){switch(e.def.accent,t){case"meteor_ring":{for(const i of n.points)this.vfx.spawnFireballExplosion(i.x,i.z,16347926,1.7),this._hostilePatch(i.x,i.z,16347926,1.4,2.2,10),this._playerIn(i.x,i.z,1.9)&&this._hurtPlayer(16);this.vfx.addShake(.5);break}case"lava_burst":{for(const i of n.points)this.vfx.spawnNova(i.x,i.z,15357964,1.8),this._hostilePatch(i.x,i.z,15357964,1.5,2.6,12),this._playerIn(i.x,i.z,1.9)&&this._hurtPlayer(14);break}case"ember_charge":{e.charge={nx:n.nx,nz:n.nz,t:.55,speed:17,hit:!1},this.vfx.spawnBurst(e.x,1,e.z,16347926,20,7);break}case"frost_nova":{this.vfx.spawnFrostNova(e.x,e.z,6809849,5.2),this._playerIn(e.x,e.z,5.5)&&(this._hurtPlayer(16),this._applyPlayerStatus("chill",2.2));break}case"ice_shards":{const i=this.player.x-e.x,s=this.player.z-e.z,a=Math.atan2(i,s);for(let o=0;o<6;o++){const l=a+(o-2.5)*.16;this._spawnBossProjectile(e,Math.sin(l),Math.cos(l),{speed:12,damage:10,color:6809849,chill:!0})}break}case"glacial_lock":{this.vfx.spawnFrostNova(n.x,n.z,10875900,2.1),this._playerIn(n.x,n.z,2.3)&&(this._hurtPlayer(10),this._applyPlayerStatus("root",1.2));break}case"chain_bolt":{const i=Math.hypot(this.player.x-e.x,this.player.z-e.z);this.vfx.spawnChainLightning(e.x,e.z,this.player.x,this.player.z,12891645,2),i<=12&&this.player.alive&&(this._hurtPlayer(14),this._applyPlayerStatus("shock",.7));break}case"static_field":{for(const i of n.points)this.vfx.spawnChainLightning(i.x-1,i.z,i.x+1,i.z,10980346,1),this._hostilePatch(i.x,i.z,9133302,2,4,9);break}case"thunder_dive":{e.x=n.x,e.z=n.z,e.mesh&&e.mesh.position.set(e.x,0,e.z),this.vfx.spawnNova(e.x,e.z,9133302,3.2),this.vfx.spawnChainLightning(e.x-2,e.z,e.x+2,e.z,12891645,2),this.vfx.addShake(.55),this._playerIn(e.x,e.z,3.4)&&(this._hurtPlayer(20),this._applyPlayerStatus("shock",.8));break}case"void_blink":{const i=Math.sin(this.player.facing),s=Math.cos(this.player.facing),a=At(this.player.x-i*1.9,this.player.z-s*1.9);e.x=a.x,e.z=a.z,e.mesh&&e.mesh.position.set(e.x,0,e.z),this.vfx.spawnBurst(e.x,1.2,e.z,15235577,22,7),this.vfx.spawnSlash(e.x,e.z,Math.atan2(this.player.x-e.x,this.player.z-e.z),15235577,2.6,Math.PI*.8),this._playerIn(e.x,e.z,2.5)&&this._hurtPlayer(16);break}case"shadow_orbs":{for(let i=0;i<8;i++){const s=i/8*Math.PI*2;this._spawnBossProjectile(e,Math.sin(s),Math.cos(s),{speed:7,damage:11,color:14239471})}break}case"mire_pull":{if(this._playerIn(n.x,n.z,2.8)){const i=e.x-this.player.x,s=e.z-this.player.z,a=At(this.player.x+i*.6,this.player.z+s*.6);this.player.x=a.x,this.player.z=a.z,this._hurtPlayer(8),this._applyPlayerStatus("chill",1.6)}this._hostilePatch(n.x,n.z,12592851,2.2,3,6,{chill:!0}),this.vfx.spawnRing(n.x,n.z,15235577,2.8,.4);break}case"solar_beam":{const s=e.x+n.nx*13,a=e.z+n.nz*13;this.vfx.spawnStormLash(e.x,e.z,s,a,16639626),this.vfx.spawnStormLash(e.x,e.z,s,a,16498468);const o=Math.max(0,Math.min(1,((this.player.x-e.x)*n.nx+(this.player.z-e.z)*n.nz)/13)),l=e.x+n.nx*13*o,c=e.z+n.nz*13*o;this._playerIn(l,c,1.7)&&this._hurtPlayer(24),this.vfx.addShake(.4);break}case"radiant_nova":{this.vfx.spawnNova(e.x,e.z,16639626,6.6),this.vfx.spawnRing(e.x,e.z,16777215,4.5,.4),this.vfx.spawnEmbers(e.x,1.4,e.z,16498468,26),this._playerIn(e.x,e.z,6.8)&&this._hurtPlayer(18),this.vfx.addShake(.5);break}case"judgment_slam":{e.x=n.x,e.z=n.z,e.mesh&&e.mesh.position.set(e.x,0,e.z),this.vfx.spawnFireballExplosion(e.x,e.z,16498468,3.4),this._hostilePatch(e.x,e.z,16096779,2.4,2.2,10),this._playerIn(e.x,e.z,3.5)&&this._hurtPlayer(22),this.vfx.addShake(.6);break}}this.vfx.floatText(e.x,3,e.z,t.replace(/_/g," ").toUpperCase(),"crit")}_spawnBossProjectile(e,t,n,{speed:i=10,damage:s=10,color:a=10980346,chill:o=!1}={}){const l=new D(new Le(.24,10,10),new ut({color:a,transparent:!0,opacity:.95,blending:gn,depthWrite:!1}));l.position.set(e.x,1.15,e.z),this.scene.add(l),this.projectiles.push({x:e.x,z:e.z,vx:t*i,vz:n*i,life:3.2,damage:s,shock:!1,chill:o,mesh:l})}_aimPoint(){return this._ndc.x=this.input.mouse.x/window.innerWidth*2-1,this._ndc.y=-(this.input.mouse.y/window.innerHeight)*2+1,this._raycaster.setFromCamera(this._ndc,this.camera),this._raycaster.ray.intersectPlane(this._groundPlane,this._hit)?this._hit:null}_updateFacing(){const e=this._aimPoint();if(e){const t=e.x-this.player.x,n=e.z-this.player.z;Math.hypot(t,n)>.1&&(this.player.facing=Math.atan2(t,n))}else(this.input.move.x||this.input.move.z)&&(this.player.facing=Math.atan2(this.input.move.x,this.input.move.z))}tryAttack(){if(this.cds.attack.t>0||!this.player.alive||this.player.statuses.shock)return;this.cds.attack.t=this.cds.attack.max;const e=this._abilities().attack;this.player.attackAnim=e.projectile==="arrow"?.18:e.ranged?.26:.24,this.player.attackAnimMax=this.player.attackAnim;try{try{this.audio.playSkill?this.audio.playSkill(e,"attack"):this.audio.hit()}catch{}const t=(this.arena.mods.playerDamageMul||1)*this.combo,n=this._classAccent(),i=this._classColor(),s=Math.sin(this.player.facing),a=Math.cos(this.player.facing);this.player.attackLunge=e.lunge||1.2;const o=this.player.attackLunge,l=At(this.player.x+s*o*.35,this.player.z+a*o*.35);this.player.x=l.x,this.player.z=l.z;let c=0;if(e.ranged)this.vfx.spawnMuzzleFlash(this.player.x,this.player.z,n,this.player.facing),this._spawnPlayerProjectile({kind:e.projectile==="arrow"?"arrow":"arcane",x:this.player.x+s*.55,z:this.player.z+a*.55,facing:this.player.facing,speed:e.speed||(e.projectile==="arrow"?28:22),range:e.range,damage:e.damage*t,knock:e.knockback,color:n,primary:i,critChance:e.projectile==="arrow"?.2:.16,radius:e.projectile==="arrow"?.45:.55});else{for(const d of this.enemies){if(!d.alive||d.riseT>0)continue;const f=d.x-this.player.x,m=d.z-this.player.z;if(Math.hypot(f,m)>e.range+d.def.radius)continue;let p=Math.atan2(f,m)-this.player.facing;for(;p>Math.PI;)p-=Math.PI*2;for(;p<-Math.PI;)p+=Math.PI*2;if(Math.abs(p)>e.arc*.5)continue;const x=Math.random()<.14,y=e.damage*t*(x?1.85:1);this._damageEnemy(d,y,x,{knock:e.knockback,fx:s,fz:a}),c++}this.vfx.spawnSlash(this.player.x,this.player.z,this.player.facing,n,e.range,e.arc),this.vfx.spawnSlash(this.player.x,this.player.z,this.player.facing,i,e.range*.75,e.arc*.7);const h=this.player.x+s*1.4,u=this.player.z+a*1.4;this.vfx.spawnBurst(h,1.1,u,i,c?14:6,c?7:4),c&&(this.vfx.spawnImpact(h,u,n),this.vfx.addHitStop(.045+c*.008),this.vfx.addShake(.12+c*.06))}}catch(t){console.error("[tryAttack]",t)}}_spawnPlayerProjectile(e){const t=e.kind||"arcane",n=e.speed||20,i=e.facing??this.player.facing,s=Math.sin(i),a=Math.cos(i),o=e.color??this._classAccent(),l=e.primary??this._classColor();let c;t==="arrow"?(c=this.vfx.createArrowMesh(o,16777215),c.quaternion.setFromUnitVectors(new C(0,1,0),new C(s,0,a).normalize())):t==="fireball"?c=this.vfx.createFireballMesh(l,o):c=this.vfx.createArcaneBoltMesh(o),c.position.set(e.x,t==="fireball"?1.45:1.2,e.z),this.scene.add(c);const h=e.range||8;this.projectiles.push({owner:"player",kind:t,x:e.x,z:e.z,vx:s*n,vz:a*n,y:c.position.y,life:h/n+.15,maxLife:h/n+.15,travel:0,maxTravel:h,damage:e.damage||10,knock:e.knock||2,radius:e.radius||.5,explodeRadius:e.explodeRadius||0,burnDps:e.burnDps||0,burnDuration:e.burnDuration||0,critChance:e.critChance||.12,color:o,primary:l,mesh:c,hitIds:new Set,pierce:!!e.pierce,fx:s,fz:a})}tryAbilityQ(){if(this.cds.q.t>0||!this.player.alive||this.player.statuses.shock)return;this.cds.q.t=this.cds.q.max;const e=this._abilities().q,t=this._classAccent(),n=this._classColor();this.player.attackAnim=.32,this.player.attackAnimMax=.32;try{this.audio.playSkill?this.audio.playSkill(e,"q"):this.audio.ability("q")}catch{}if(e.mode==="block"){const a=e.duration||1.35;if(this.player.blockT=a,this.player.blockMax=a,this.player.blockDamageMul=e.damageMul??.22,this.player.invuln=Math.max(this.player.invuln,.12),this.vfx.spawnRing(this.player.x,this.player.z,t,2.2,.4),this.vfx.spawnRing(this.player.x,this.player.z,16498468,1.4,.28),this.vfx.floatText(this.player.x,2.1,this.player.z,"BLOCK","combo"),this.player.mesh?.userData?.shield){const o=this.player.mesh.userData.shield;o.position.set(-.05,-.35,.45),o.rotation.set(.55,.1,-.05)}this.vfx.addShake(.12);return}if(e.mode==="whirlwind"){const a=(this.arena.mods.playerDamageMul||1)*this.combo,o=e.ticks||4,l=e.radius||4;this.player.attackAnim=.55,this.player.attackAnimMax=.55;for(let c=0;c<o;c++){const h=this.player.facing+c/o*Math.PI*2;this.vfx.spawnSlash(this.player.x,this.player.z,h,t,l*.85,Math.PI*.9),this.vfx.spawnSlash(this.player.x,this.player.z,h+.4,n,l*.65,Math.PI*.7)}this.vfx.spawnRing(this.player.x,this.player.z,t,l,.45),this.vfx.spawnEmbers(this.player.x,1,this.player.z,n,22),this.vfx.addShake(.4),this.vfx.addHitStop(.07);for(const c of this.enemies){if(!c.alive||c.riseT>0)continue;const h=Math.hypot(c.x-this.player.x,c.z-this.player.z);h<=l+c.def.radius&&this._damageEnemy(c,e.damage*o*.55*a,!1,{knock:5.5,fx:(c.x-this.player.x)/(h||1),fz:(c.z-this.player.z)/(h||1)})}return}if(e.volley){this.vfx.spawnArrowVolley(this.player.x,this.player.z,e.radius,t,e.arrows||7),this.vfx.addShake(.38),this.vfx.addHitStop(.06);const a=(this.arena.mods.playerDamageMul||1)*this.combo;for(const o of this.enemies){if(!o.alive||o.riseT>0)continue;Math.hypot(o.x-this.player.x,o.z-this.player.z)<=e.radius+o.def.radius&&this._damageEnemy(o,e.damage*a,!1)}return}e.frost?(this.vfx.spawnFrostNova(this.player.x,this.player.z,t,e.radius),this.vfx.spawnBurst(this.player.x,1.4,this.player.z,t,28,8),this.vfx.spawnBurst(this.player.x,.6,this.player.z,12891645,18,5)):(this.vfx.spawnNova(this.player.x,this.player.z,n,e.radius),this.vfx.spawnRing(this.player.x,this.player.z,t,e.radius*.6,.35),this.vfx.spawnEmbers?.(this.player.x,1,this.player.z,n,20)),this.vfx.addShake(.42),this.vfx.addHitStop(.07);const i=(e.burnDuration||0)*(this.arena.mods.burnDurationMul||1);if(e.burnDps>0&&i>0){this.vfx.spawnPatch(this.player.x,this.player.z,n,e.radius*.85,i);const a=this.vfx.patches[this.vfx.patches.length-1];a&&(a.dps=e.burnDps,a.burn=!0)}else(e.smoke||e.frost)&&this.vfx.spawnPatch(this.player.x,this.player.z,t,e.radius*.9,1.6);const s=(this.arena.mods.playerDamageMul||1)*this.combo;for(const a of this.enemies){if(!a.alive||a.riseT>0)continue;Math.hypot(a.x-this.player.x,a.z-this.player.z)<=e.radius+a.def.radius&&(this._damageEnemy(a,e.damage*s,!1),e.burnDps>0&&i>0&&(a.burn=i,a.burnDps=e.burnDps),e.frost&&(a.stun=Math.max(a.stun||0,.85),this.vfx.floatText(a.x,1.8,a.z,"CHILL","shock")),e.smoke&&(a.stun=Math.max(a.stun||0,.55)))}e.smoke&&(this.player.invuln=Math.max(this.player.invuln,.55))}tryAbilityE(){if(this.cds.e.t>0||!this.player.alive||this.player.statuses.shock)return;this.cds.e.t=this.cds.e.max;const e=this._abilities().e,t=this._classAccent(),n=this._classColor();try{this.audio.playSkill?this.audio.playSkill(e,"e"):this.audio.ability("e")}catch{}const i=this.arena.mods.shockDurationMul||1,s=this.arena.mods.shockVfxMul||1,a=(this.arena.mods.playerDamageMul||1)*this.combo;this.player.attackAnim=.28,this.player.attackAnimMax=.28;let o=this.enemies.filter(p=>p.alive&&!(p.riseT>0)).map(p=>({e:p,d:Math.hypot(p.x-this.player.x,p.z-this.player.z)})).filter(p=>p.d<=e.range).sort((p,x)=>p.d-x.d);if(e.mode==="groundslam"){const p=e.radius||4.4;this.vfx.spawnNova(this.player.x,this.player.z,n,p),this.vfx.spawnRing(this.player.x,this.player.z,t,p*.7,.4),this.vfx.spawnRing(this.player.x,this.player.z,16777215,p*.35,.25),this.vfx.spawnBurst(this.player.x,.5,this.player.z,t,28,9),this.vfx.spawnEmbers(this.player.x,.8,this.player.z,n,18),this.vfx.addShake(.55),this.vfx.addHitStop(.09);for(const x of this.enemies){if(!x.alive||x.riseT>0)continue;const y=Math.hypot(x.x-this.player.x,x.z-this.player.z);if(y<=p+x.def.radius){const v=(x.x-this.player.x)/(y||1),A=(x.z-this.player.z)/(y||1);this._damageEnemy(x,e.damage*a,y<p*.4,{knock:7.5,fx:v,fz:A}),x.stun=Math.max(x.stun||0,(e.shockDuration||1)*i),this.vfx.floatText(x.x,1.7,x.z,"SLAM","crit")}}return}if(e.mode==="bash"){if(!o.length){this.vfx.spawnSlash(this.player.x,this.player.z,this.player.facing,t,3,Math.PI*.85),this.vfx.spawnBurst(this.player.x,1.2,this.player.z,t,12,5),this.vfx.floatText(this.player.x,1.8,this.player.z,"BASH","shock");return}const p=o[0].e;this.vfx.spawnImpact(p.x,p.z,t),this.vfx.spawnSlash(this.player.x,this.player.z,this.player.facing,t,3.2,Math.PI*.9),this.vfx.spawnBurst(p.x,1.2,p.z,t,18,8);const x=(p.x-this.player.x)/(o[0].d||1),y=(p.z-this.player.z)/(o[0].d||1),v=e.knockback||8.5;this._damageEnemy(p,e.damage*a,!0,{knock:v,fx:x,fz:y}),p.stun=e.shockDuration*i,this.vfx.floatText(p.x,1.8,p.z,"SHOCK","shock"),this.vfx.floatText(p.x,2.15,p.z,"BASH","crit"),this.vfx.addHitStop(.08),this.vfx.addShake(.32);return}if(e.mode==="multishot"){const p=e.arrows||5,x=e.spread||.55;this.vfx.spawnFanArrows(this.player.x,this.player.z,this.player.facing,t,e.range,p,x);for(let y=0;y<p;y++){const v=p===1?.5:y/(p-1),A=this.player.facing+(v-.5)*x;this._spawnPlayerProjectile({kind:"arrow",x:this.player.x+Math.sin(A)*.4,z:this.player.z+Math.cos(A)*.4,facing:A,speed:26,range:e.range,damage:e.damage*a,knock:4,color:y===Math.floor(p/2)?16777215:t,primary:n,critChance:.12,radius:.42})}this.vfx.addHitStop(.06),this.vfx.addShake(.22);return}const l=Math.sin(this.player.facing),c=Math.cos(this.player.facing),h=this.player.x+l*e.range,u=this.player.z+c*e.range;let d=o.filter(p=>{const x=p.e.x-this.player.x,y=p.e.z-this.player.z;let v=Math.atan2(x,y)-this.player.facing;for(;v>Math.PI;)v-=Math.PI*2;for(;v<-Math.PI;)v+=Math.PI*2;return Math.abs(v)<Math.PI*.55}).map(p=>p.e);if(!d.length&&o.length&&(d=o.map(p=>p.e)),d.length){const p=d[0];this.vfx.spawnStormLash(this.player.x,this.player.z,p.x,p.z,t)}else this.vfx.spawnStormLash(this.player.x,this.player.z,h,u,t),this.vfx.spawnImpact(h,u,t),this.vfx.floatText(h,1.6,u,"LASH","shock");let f={x:this.player.x,z:this.player.z},m=[...d];const _=e.chains||6;let g=!1;for(let p=0;p<_&&m.length;p++){m.sort((y,v)=>Math.hypot(y.x-f.x,y.z-f.z)-Math.hypot(v.x-f.x,v.z-f.z));const x=m.shift();p>0&&(this.vfx.spawnChainLightning(f.x,f.z,x.x,x.z,t,1),s>1&&this.vfx.spawnChainLightning(f.x,f.z,x.x,x.z,16777215,0)),this._damageEnemy(x,e.damage*a*(1-p*.08),!1),x.stun=e.shockDuration*i,this.vfx.floatText(x.x,1.8,x.z,"SHOCK","shock"),this.vfx.spawnBurst(x.x,1.2,x.z,t,Math.floor(14*s),8),this.vfx.spawnImpact(x.x,x.z,16777215),f={x:x.x,z:x.z},g=!0}this.vfx.addHitStop(g?.08:.04),this.vfx.addShake(g?.32:.18)}tryAbilityR(){if(this.cds.r.t>0||!this.player.alive||this.player.statuses.shock)return;this.cds.r.t=this.cds.r.max;const e=this._abilities().r,t=this._classAccent(),n=this._classColor();this.player.attackAnim=.32,this.player.attackAnimMax=.32;try{this.audio.playSkill?this.audio.playSkill(e,"r"):this.audio.ability("r")}catch{}const i=(this.arena.mods.playerDamageMul||1)*this.combo,s=Math.sin(this.player.facing),a=Math.cos(this.player.facing);if(e.mode==="fireball"||e.projectile==="fireball"){this.vfx.spawnMuzzleFlash(this.player.x,this.player.z,16347926,this.player.facing),this.vfx.spawnRing(this.player.x,this.player.z,16347926,1.4,.22),this.vfx.spawnEmbers(this.player.x,1.2,this.player.z,16347926,14),this._spawnPlayerProjectile({kind:"fireball",x:this.player.x+s*.6,z:this.player.z+a*.6,facing:this.player.facing,speed:e.speed||14,range:e.range||10,damage:e.damage*i,knock:5,color:16639626,primary:16347926,explodeRadius:e.radius||3.6,burnDps:e.burnDps||12,burnDuration:(e.burnDuration||2.2)*(this.arena.mods.burnDurationMul||1),critChance:.1,radius:.75}),this.vfx.addShake(.2);return}if(e.mode==="earthsplitter"){const _=e.distance||8.5,g=e.width||2.4,p=this.arena.mods.shockDurationMul||1;this.vfx.spawnRing(this.player.x,this.player.z,n,1.6,.25),this.vfx.spawnSlash(this.player.x,this.player.z,this.player.facing,t,_*.55,Math.PI*.35);const x=new Set,y=12;for(let A=1;A<=y;A++){const E=A/y,T=this.player.x+s*_*E,P=this.player.z+a*_*E,b=At(T,P);A%2===0&&(this.vfx.spawnBurst(b.x,.4,b.z,n,8,5),this.vfx.spawnRing(b.x,b.z,t,g*.55,.2));for(const M of this.enemies)!M.alive||M.riseT>0||x.has(M.id)||Math.hypot(M.x-b.x,M.z-b.z)<g+M.def.radius&&(x.add(M.id),this._damageEnemy(M,e.damage*i,!0,{knock:6,fx:s,fz:a}),M.stun=Math.max(M.stun||0,(e.shockDuration||.85)*p),this.vfx.floatText(M.x,1.8,M.z,"SPLIT","crit"),this.vfx.spawnImpact(M.x,M.z,t))}const v=At(this.player.x+s*_,this.player.z+a*_);this.vfx.spawnNova(v.x,v.z,t,g*1.1),this.vfx.addShake(.42),this.vfx.addHitStop(.07);return}const o=this.player.x,l=this.player.z,c=10,h=new Set,u=this.player.mesh?.userData?.weaponStyle||"greatblade",d=e.distance||7,f=this.arena.mods.shockDurationMul||1;this.vfx.spawnRing(o,l,t,1.8,.28),this.vfx.spawnBurst(o,1,l,n,16,7);for(let _=1;_<=c;_++){const g=_/c,p=o+s*d*g,x=l+a*d*g,y=At(p,x);for(const v of this.enemies)!v.alive||v.riseT>0||h.has(v.id)||Math.hypot(v.x-y.x,v.z-y.z)<(e.width||2)+v.def.radius&&(h.add(v.id),this._damageEnemy(v,e.damage*i,!0,{knock:5,fx:s,fz:a}),e.shockDuration&&(v.stun=Math.max(v.stun||0,e.shockDuration*f),this.vfx.floatText(v.x,1.8,v.z,"SHOCK","shock")),u==="bow"?this.vfx.spawnArrowShot(y.x,y.z,v.x,v.z,t):u==="sword_shield"?(this.vfx.spawnImpact(v.x,v.z,t),this.vfx.spawnSlash(y.x,y.z,this.player.facing,t,2,Math.PI*.55)):this.vfx.spawnSlash(y.x,y.z,this.player.facing,t,2.2,Math.PI*.5));_%2===0&&(u==="bow"?this.vfx.spawnBurst(y.x,.7,y.z,t,4,3):this.vfx.spawnBurst(y.x,.8,y.z,t,5,4))}const m=At(o+s*d,l+a*d);this.player.x=m.x,this.player.z=m.z,this.player.invuln=Math.max(this.player.invuln,e.iframe||.4),this.vfx.spawnRing(m.x,m.z,t,2.6,.35),this.vfx.spawnBurst(m.x,1.2,m.z,t,18,8),u==="greatblade"?(this.vfx.spawnSlash(m.x,m.z,this.player.facing,t,3.2,Math.PI*.7),this.vfx.spawnEmbers(m.x,1,m.z,n,16)):u==="sword_shield"?(this.vfx.spawnSlash(m.x,m.z,this.player.facing,t,2.6,Math.PI*.6),this.vfx.spawnRing(m.x,m.z,16498468,2,.3)):this.vfx.spawnFanArrows(m.x,m.z,this.player.facing,t,4.5,3,.4),this.vfx.addShake(.28),this.vfx.addHitStop(.05)}tryDodge(){if(this.cds.dodge.t>0||!this.player.alive||this.player.statuses.shock)return;let e=this.input.move.x,t=this.input.move.z;!e&&!t&&(e=Math.sin(this.player.facing),t=Math.cos(this.player.facing));const n=Math.hypot(e,t)||1;this.player.vx=e/n*ge.dodgeSpeed,this.player.vz=t/n*ge.dodgeSpeed,this.player.dodgeT=ge.dodgeDuration,this.player.invuln=Math.max(this.player.invuln,ge.dodgeIFrames),this.cds.dodge.t=this.cds.dodge.max;try{this.audio.playSkill?this.audio.playSkill({mode:"dodge"},"dodge"):this.audio.ability("dodge")}catch{}this.vfx.spawnBurst(this.player.x,.55,this.player.z,this._classAccent(),14,6),this.vfx.spawnRing(this.player.x,this.player.z,this._classColor(),1.4,.2)}_damageEnemy(e,t,n=!1,i=null){if(e.alive){if(e.hp-=t,e.hitFlash=.14,this.vfx.floatText(e.x,1.7+Math.random()*.35,e.z,n?`${Math.floor(t)}!`:`${Math.floor(t)}`,n?"crit":""),n&&this.audio.crit(),i){const s=i.knock*(n?1.35:1);e.knockVx=(e.knockVx||0)+i.fx*s,e.knockVz=(e.knockVz||0)+i.fz*s,e.x+=i.fx*s*.08,e.z+=i.fz*s*.08;const a=At(e.x,e.z,ge.arenaRadius-e.def.radius);e.x=a.x,e.z=a.z}e.hp<=0?this._killEnemy(e):this._updateEnemyHpBar(e)}}_updateEnemyHpBar(e){if(!e.mesh?.userData?.hpBar)return;const t=Math.max(0,e.hp/e.maxHp);e.mesh.userData.hpBar.scale.x=Math.max(.05,t),e.mesh.userData.hpBar.position.x=-((1-t)*e.mesh.userData.hpBarWidth)*.5}_killEnemy(e,t={}){if(e.def?.isRival){e.alive=!1,e.hp=0,this.kills++,this.rival?.die(),this.vfx.addShake(.5),this.vfx.addHitStop(.09);return}if(e.alive=!1,e.hp=0,t.byRival&&this.pvp){const i=e.def.score*(this.arena.mods.scoreMul||1);this.pvp.rivalScore+=i,this.rival&&this.rival.kills++,this.vfx.spawnBurst(e.x,1.1,e.z,14753096,18,7),this.vfx.spawnRing(e.x,e.z,14753096,2,.3),this.vfx.floatText(e.x,2.1,e.z,`RIVAL +${Math.floor(i)}`,"shock"),this.audio.kill(),e.actor?(e.actor.dispose(),e.actor=null,e.mesh=null):e.mesh&&(this.scene.remove(e.mesh),e.mesh=null);return}this.kills++;const n=e.def.score*this.combo*(this.arena.mods.scoreMul||1);this.score+=n,this.combo=Math.min(ge.comboMax,this.combo+ge.comboStep),this.bestCombo=Math.max(this.bestCombo,this.combo),this.comboTimer=ge.comboDecay,this.audio.kill(),this.vfx.spawnBurst(e.x,1.1,e.z,e.def.accent,e.def.isBoss?36:22,8),this.vfx.spawnRing(e.x,e.z,e.def.color,e.def.isBoss?3.5:2.2,.35),this.vfx.spawnBurst(e.x,.6,e.z,16777215,8,5),this.vfx.floatText(e.x,2.1,e.z,`+${Math.floor(n)}`,"combo"),this.vfx.addShake(e.def.isBoss?.7:.16),this.vfx.addHitStop(e.def.isBoss?.1:.03),e.actor?(e.actor.dispose(),e.actor=null,e.mesh=null):e.mesh&&(this.scene.remove(e.mesh),e.mesh=null)}_hurtPlayer(e){if(this.player.invuln>0||!this.player.alive)return;let t=e,n=!1;if(this.player.blockT>0){n=!0,t=e*(this.player.blockDamageMul??.22),this.vfx.floatText(this.player.x,2.2,this.player.z,"BLOCK","combo"),this.vfx.spawnRing(this.player.x,this.player.z,16498468,1.6,.18);const i=this._abilities().q;if(i?.reflectShock){let s=null,a=3.2;for(const o of this.enemies){if(!o.alive)continue;const l=Math.hypot(o.x-this.player.x,o.z-this.player.z);l<a&&(a=l,s=o)}s&&(s.stun=Math.max(s.stun||0,i.reflectShock),this.vfx.floatText(s.x,1.8,s.z,"SHOCK","shock"))}}if(this.player.hp-=t,this.player.invuln=n?.28:.55,this.audio.hurt(),this.vfx.addShake(n?.18:.4),this.vfx.addHitStop(n?.03:.05),this.vfx.floatText(this.player.x,2,this.player.z,`-${Math.floor(t)}`,n?"combo":""),this.player.hp<=0){if(this.player.hp=0,this._pvpOnPlayerDeath())return;this.player.alive=!1,this._endRun(!1)}}_endRun(e){if(this.pvp&&!this.pvp.over){this._endPvp(e);return}this.mode="result",e?(this.audio.victory(),this._recordLevelProgress(ge.levelsPerRealm,!0)):(this.audio.defeat(),this._recordLevelProgress(this.level,!1)),Xr();const t=this.arena.index,n=e&&this.campaign&&t<Lt.length-1,i=e&&this.arena.isFinalRealm;this.ui.showResult({victory:e,arena:this.arena,score:this.score,wave:this.wave,level:this.level,kills:this.kills,bestCombo:this.bestCombo,canNext:n,eyebrow:i?"SANCTUM SEALED · STORY COMPLETE":void 0,title:i?"The Last Light Yields":void 0,flavor:i?"Five realms. Five Wardens — Colossus, Matron, Sovereign, Herald, Archon — each fell and each seal closed behind you. The Ember Sanctum is quiet at last, and it remembers exactly one name: yours.":void 0})}_spawnEnemy(e){try{const t=qx(this.enemies.length,Math.max(8,this.spawnQueue.length+this.enemies.length+1),{x:this.player.x,z:this.player.z}),n=z_(e,t.x,t.z);if(e==="boss"||n.def?.isBoss){const i=this._activeBossProfile||Ls(this.arena.bossId||this.arenaId);n.bossProfile=i,n.def={...n.def,name:i.name,color:i.color??n.def.color,accent:i.accent??n.def.accent,hp:Math.floor(n.def.hp*(i.hpMul||1)),damage:Math.floor(n.def.damage*(i.damageMul||1)),specials:i.specials||[],element:i.element||"ember",isBoss:!0},n.specialCd=1.2,n.specialIdx=0}n.maxHp=Yx(n.def.hp,this.wave,this.arena.index),n.hp=n.maxHp,n.riseT=.55,n.riseMax=.55,this._attachEnemyVisual(n),n.mesh&&n.mesh.position.set(n.x,-1.35,n.z),this.vfx.spawnGroundRise(n.x,n.z,n.def.accent||this.arena.portal),this.enemies.push(n)}catch(t){console.error("[spawnEnemy]",e,t)}}_updatePlayer(e,t){if(!this.player.alive)return;if(this.modeSwapCd>0&&(this.modeSwapCd=Math.max(0,this.modeSwapCd-e)),this.player.invuln>0&&(this.player.invuln-=e),this.player.attackAnim>0&&(this.player.attackAnim-=e),this.player.blockT>0){if(this.player.blockT-=e,this.player.blockT<=0){if(this.player.blockT=0,this.player.blockDamageMul=1,this.player.mesh?.userData?.shield){const f=this.player.mesh.userData.shield;f.position.set(-.18,-.52,.28),f.rotation.set(.25,.35,-.2)}}else if(this.player.mesh?.userData?.shield){const f=this.player.mesh.userData.shield,m=Math.sin(this.time*14)*.03;f.position.set(-.05,-.35+m,.45)}}if(this.player.statuses.shock&&(this.player.statuses.shock-=e,this.player.statuses.shock<=0&&delete this.player.statuses.shock),this.player.statuses.chill&&(this.player.statuses.chill-=e,this.player.statuses.chill<=0&&delete this.player.statuses.chill),this.player.statuses.root&&(this.player.statuses.root-=e,this.player.statuses.root<=0&&delete this.player.statuses.root),(t.mode||this.input.modePressed)&&(this.input.modePressed=!1,this.toggleWeaponMode()),this.player.dodgeT>0)this.player.dodgeT-=e,this.player.x+=this.player.vx*e,this.player.z+=this.player.vz*e;else if(!this.player.statuses.shock&&!this.player.statuses.root){const f=(this._classDef().speed||ge.playerSpeed)*(this.player.statuses.chill?.5:1),m=ge.playerFriction,_=this.input.move.x*f,g=this.input.move.z*f,p=Math.min(1,16*e);if(this.player.vx+=(_-this.player.vx)*p,this.player.vz+=(g-this.player.vz)*p,!this.input.move.x&&!this.input.move.z){const x=Math.max(0,1-m*e);this.player.vx*=x,this.player.vz*=x}this.player.x+=this.player.vx*e,this.player.z+=this.player.vz*e}const n=At(this.player.x,this.player.z);this.player.x=n.x,this.player.z=n.z,this._updateFacing(),(t.attack||this.input.mouse.down&&!this.input.mouse.rightDown)&&this.tryAttack(),t.q&&this.tryAbilityQ(),t.e&&this.tryAbilityE(),t.r&&this.tryAbilityR(),t.dodge&&this.tryDodge();const i=this.player.mesh;if(!i)return;const s=Math.hypot(this.player.vx,this.player.vz),a=s>.6,o=a?Math.min(1,s/6):0;this.player.walkAmp=(this.player.walkAmp||0)+(o-(this.player.walkAmp||0))*Math.min(1,10*(e||.016));const l=this.player.walkAmp;l>.02&&(this.player.walkPhase+=(e||.016)*(4.5+s*.55));const c=this.player.walkPhase,h=Math.sin(c*2)*.055*Math.max(l,a?1:0);i.position.set(this.player.x,h,this.player.z),i.rotation.y=this.player.facing,i.rotation.z=Math.sin(c*2)*.035*l;const u=Math.sin(c)*.78*l,d=Math.sin(c)*.58*l;if(i.userData.legL&&(i.userData.legL.rotation.x=u,i.userData.legL.rotation.z=0),i.userData.legR&&(i.userData.legR.rotation.x=-u,i.userData.legR.rotation.z=0),i.userData.armL&&(i.userData.armL.rotation.x=-d,i.userData.armL.rotation.z=.05*l),i.userData.armR&&this.player.attackAnim<=0&&(i.userData.armR.rotation.x=d*.35,i.userData.armR.rotation.z=-.04*l,i.userData.armR.rotation.y=0),i.userData.body&&(i.userData.body.rotation.x=-l*.06),i.userData.weapon){const f=i.userData.weaponStyle||"greatblade",m=i.userData.weaponRest||{rx:0,ry:0,rz:0,px:.2,py:-.6,pz:.2},_=this.player.attackAnimMax||.22,g=i.userData.weapon;if(this.player.attackAnim>0){const p=1-this.player.attackAnim/_,x=Math.sin(p*Math.PI);f==="bow"?(g.rotation.x=m.rx-x*.45,g.rotation.y=m.ry+x*.2,g.rotation.z=m.rz,g.position.set(m.px,m.py,m.pz-x*.1),i.userData.armR&&(i.userData.armR.rotation.x=-x*.55,i.userData.armR.rotation.y=x*.15),i.userData.blade&&(i.userData.blade.visible=p<.55)):f==="staff"?(g.rotation.x=m.rx-x*.75,g.rotation.y=m.ry+x*.15,g.rotation.z=m.rz+x*.2,g.position.set(m.px,m.py+x*.05,m.pz+x*.12),i.userData.armR&&(i.userData.armR.rotation.x=-x*.9,i.userData.armR.rotation.z=x*.2),i.userData.blade?.scale&&i.userData.blade.scale.setScalar(1+x*.55)):(g.rotation.x=m.rx-x*.35,g.rotation.y=m.ry+Math.sin(p*Math.PI)*1.35,g.rotation.z=m.rz+Math.sin(p*Math.PI)*.45,g.position.set(m.px,m.py,m.pz),i.userData.armR&&(i.userData.armR.rotation.x=-x*.4,i.userData.armR.rotation.y=x*1.1,i.userData.armR.rotation.z=x*.35))}else if(g.rotation.x+=(m.rx-g.rotation.x)*.22,g.rotation.y+=(m.ry-g.rotation.y)*.22,g.rotation.z+=(m.rz-g.rotation.z)*.22,g.position.x+=(m.px-g.position.x)*.22,g.position.y+=(m.py-g.position.y)*.22,g.position.z+=(m.pz-g.position.z)*.22,i.userData.blade&&(i.userData.blade.visible=!0,f==="staff"&&i.userData.blade.scale)){const p=i.userData.blade.scale;p.set(p.x+(1-p.x)*.25,p.y+(1-p.y)*.25,p.z+(1-p.z)*.25)}}if(i.userData.cape&&(i.userData.cape.rotation.x=.18+s*.035+Math.sin(c*2)*.04*l),i.userData.aura){i.userData.aura.material.opacity=.08+Math.sin(this.time*3)*.04;const f=1+Math.sin(this.time*2.2)*.04;i.userData.aura.scale.setScalar(f)}if(i.userData.groundRing&&(i.userData.groundRing.rotation.z=this.time*.8,i.userData.groundRing.material.opacity=.28+Math.sin(this.time*3.5)*.1),i.userData.chestGem?.scale){const f=1+Math.sin(this.time*4)*.12;i.userData.chestGem.scale.setScalar(f)}if(i.userData.headGem?.rotation&&(i.userData.headGem.rotation.y=this.time*2.5),this.player.invuln>0){const f=Math.floor(this.time*18)%2===0;i.visible=f}else i.visible=!0}_billboardHp(e){e&&(e.getWorldQuaternion(this._invQ),this._invQ.invert(),this._tmpQ.copy(this.camera.quaternion).premultiply(this._invQ),e.userData.hpBar&&e.userData.hpBar.quaternion.copy(this._tmpQ),e.userData.hpBarBg&&e.userData.hpBarBg.quaternion.copy(this._tmpQ),e.userData.hpBarFrame&&e.userData.hpBarFrame.quaternion.copy(this._tmpQ))}_updateEnemies(e){const t=this.arena.mods.enemySpeedMul||1,n=ge.enemySepForce;for(let i=0;i<this.enemies.length;i++){const s=this.enemies[i];if(s.alive)for(let a=i+1;a<this.enemies.length;a++){const o=this.enemies[a];if(!o.alive)continue;const l=o.x-s.x,c=o.z-s.z,h=s.def.radius+o.def.radius+.15,u=Math.hypot(l,c)||.001;if(u<h){const d=(h-u)/h*n*e,f=l/u,m=c/u;s.x-=f*d*.5,s.z-=m*d*.5,o.x+=f*d*.5,o.z+=m*d*.5}}}for(const i of this.enemies){if(!i.alive)continue;if(i.def?.isRival){this._updateRivalBody(i,e);continue}if(i.riseT>0){i.riseT=Math.max(0,i.riseT-e);const m=1-i.riseT/(i.riseMax||.55),_=1-Math.pow(1-m,3);i.mesh&&(i.mesh.position.set(i.x,-1.35+_*1.35,i.z),i.mesh.rotation.y=this.time*2+i.x,i.actor||i.mesh.scale.setScalar(.55+_*.45));continue}if((i.knockVx||i.knockVz)&&(i.x+=i.knockVx*e,i.z+=i.knockVz*e,i.knockVx*=Math.max(0,1-8*e),i.knockVz*=Math.max(0,1-8*e),Math.abs(i.knockVx)<.05&&(i.knockVx=0),Math.abs(i.knockVz)<.05&&(i.knockVz=0)),i.stun>0){i.stun-=e,i.mesh&&(i.mesh.position.set(i.x,.05+Math.sin(this.time*30)*.04,i.z),i.mesh.rotation.y+=e*3,this._billboardHp(i.mesh));continue}if(i.burn>0){if(i.burn-=e,i.hp-=i.burnDps*e,i.hp<=0){this._killEnemy(i);continue}this._updateEnemyHpBar(i)}if(i.hitFlash>0&&(i.hitFlash-=e),i.attackCd>0&&(i.attackCd-=e),i.def.isBoss&&i.def.specials?.length&&i.riseT<=0&&(i.specialCd=(i.specialCd??2.2)-e,i.specialCd<=0&&this.player.alive)){const m=i.def.specials[(i.specialIdx||0)%i.def.specials.length];i.specialIdx=(i.specialIdx||0)+1,i.specialCd=5+Math.random()*1.8,this._startBossCast(i,m)}if(i.charge){i.charge.t-=e,i.x+=i.charge.nx*i.charge.speed*e,i.z+=i.charge.nz*i.charge.speed*e;const m=At(i.x,i.z,ge.arenaRadius-i.def.radius);i.x=m.x,i.z=m.z,this.vfx.spawnBurst(i.x,.6,i.z,16347926,3,3),!i.charge.hit&&this._playerIn(i.x,i.z,i.def.radius+.9)&&(i.charge.hit=!0,this._hurtPlayer(20),this.vfx.addShake(.5)),i.charge.t<=0&&(i.charge=null),i.mesh&&(i.mesh.position.set(i.x,0,i.z),this._billboardHp(i.mesh));continue}let s=this.player.x,a=this.player.z,o=!1;if(this.pvp&&this.pvp.mode!=="duel"&&this.rival?.alive){const m=this.player.alive?Math.hypot(this.player.x-i.x,this.player.z-i.z):1/0;Math.hypot(this.rival.x-i.x,this.rival.z-i.z)<m&&(s=this.rival.x,a=this.rival.z,o=!0)}const l=s-i.x,c=a-i.z,h=Math.hypot(l,c)||1,u=l/h,d=c/h;if(i.def.blink&&i.blinkCd>0&&(i.blinkCd-=e),i.def.blink&&i.blinkCd<=0&&h>3&&h<10){i.x=s-u*2.2+(Math.random()-.5),i.z=a-d*2.2+(Math.random()-.5);const m=At(i.x,i.z,ge.arenaRadius-i.def.radius);i.x=m.x,i.z=m.z,i.blinkCd=3.5+Math.random()*2,this.vfx.spawnBurst(i.x,1,i.z,i.def.accent,14,6),this.vfx.spawnRing(i.x,i.z,i.def.accent,1.4,.25)}if(i.def.ranged){h<i.def.attackRange*.55?(i.x-=u*i.def.speed*t*e,i.z-=d*i.def.speed*t*e):h>i.def.attackRange*.9?(i.x+=u*i.def.speed*t*e,i.z+=d*i.def.speed*t*e):(i.x+=-d*i.def.speed*.65*t*e,i.z+=u*i.def.speed*.65*t*e);const m=o?this.rival?.alive:this.player.alive;if(i.attackCd<=0&&h<=i.def.attackRange&&m){i.attackCd=i.def.attackCd,this.projectiles.push({x:i.x,z:i.z,vx:u*11,vz:d*11,life:2.2,damage:i.def.damage,shock:Math.random()<(i.def.shockChance||0),mesh:null});const _=this.projectiles[this.projectiles.length-1],g=new D(new Le(.2,10,10),new ut({color:10980346,transparent:!0,opacity:.95,blending:gn,depthWrite:!1}));g.position.set(_.x,1.15,_.z),this.scene.add(g),_.mesh=g,this.vfx.spawnBolt(i.x,i.z,i.x+u,i.z+d,12891645)}}else h>i.def.attackRange*.85?(i.x+=u*i.def.speed*t*e,i.z+=d*i.def.speed*t*e):i.attackCd<=0&&(o?this.rival?.alive:this.player.alive)&&(i.attackCd=i.def.attackCd,o?(this.rival.hurt(i.def.damage),this.vfx.spawnBurst(this.rival.x,1.1,this.rival.z,14753096,10,5)):(this._hurtPlayer(i.def.damage),this.vfx.spawnBurst(this.player.x,1.1,this.player.z,14753096,12,5),this.vfx.spawnImpact(this.player.x,this.player.z,16478597)));const f=At(i.x,i.z,ge.arenaRadius-i.def.radius);if(i.x=f.x,i.z=f.z,i.mesh){const m=i.hitFlash>0?.08:0;i.mesh.position.set(i.x,m,i.z),i.mesh.rotation.y=Math.atan2(l,c),i.actor||i.mesh.scale.setScalar(i.hitFlash>0?1.08:1),i.actor&&(h>i.def.attackRange*.9&&Math.hypot(i.knockVx||0,i.knockVz||0)<.8?i.actor.play("Walk",{fade:.12}):i.actor._oneShot||i.actor.play("Idle",{fade:.15}),i.actor.update(e)),i.mesh.userData.spin&&(i.mesh.userData.spin.rotation.z+=e*5),i.mesh.userData.bob&&(i.mesh.userData.bob.position.y=.9*i.def.scale+Math.sin(this.time*4+i.x)*.14),this._billboardHp(i.mesh),i.actor&&(i.hitFlash>0||i.burn>0||i._matDirty)&&i.mesh.traverse(_=>{if(!_.isMesh||!_.material)return;const g=Array.isArray(_.material)?_.material:[_.material];for(const p of g){if(!p?.userData?.owned)continue;const x=p.userData.baseEm??.25;i.hitFlash>0&&p.emissive?(p.emissiveIntensity=2.2,p.color&&p.color.setHex(16777215),i._matDirty=!0):("emissiveIntensity"in p&&(p.emissiveIntensity=i.burn>0?x+.6:x),p.userData.baseColorHex!=null&&p.color&&p.color.setHex(p.userData.baseColorHex),i.hitFlash<=0&&i.burn<=0&&(i._matDirty=!1))}})}}this.enemies=this.enemies.filter(i=>i.alive)}_updateProjectiles(e){for(let t=this.projectiles.length-1;t>=0;t--){const n=this.projectiles[t];n.life-=e;const i=n.vx*e,s=n.vz*e;if(n.x+=i,n.z+=s,n.travel!=null&&(n.travel+=Math.hypot(i,s)),n.owner==="player"){let o=n.y||1.2;if(n.kind==="fireball"){const h=1-Math.max(0,n.life)/(n.maxLife||1);o=1.2+Math.sin(h*Math.PI)*1.1,n.y=o,n.mesh&&(n.mesh.rotation.x+=e*6,n.mesh.rotation.y+=e*4,n.mesh.scale.setScalar(.9+Math.sin(this.time*14)*.08))}else n.kind==="arcane"&&n.mesh&&(n.mesh.rotation.y+=e*8,n.mesh.userData?.spinRing&&(n.mesh.userData.spinRing.rotation.z+=e*10));n.mesh&&n.mesh.position.set(n.x,o,n.z);let l=!1;for(const h of this.enemies){if(!h.alive||h.riseT>0||n.hitIds?.has(h.id)||Math.hypot(h.x-n.x,h.z-n.z)>(n.radius||.5)+h.def.radius)continue;if(n.hitIds?.add(h.id),n.kind==="fireball"||n.explodeRadius>0){this._explodeProjectile(n),l=!0;break}const u=Math.random()<(n.critChance||.12);if(this._damageEnemy(h,n.damage*(u?1.85:1),u,{knock:n.knock||2,fx:n.fx||0,fz:n.fz||0}),this.vfx.spawnImpact(h.x,h.z,n.color||16777215),n.kind==="arcane"?(this.vfx.spawnBurst(h.x,1.3,h.z,n.primary||n.color,14,7),this.vfx.spawnRing(h.x,h.z,n.color,1.4,.2)):n.kind==="arrow"&&this.vfx.spawnBurst(h.x,1.15,h.z,n.color,8,4),this.vfx.addHitStop(.035),this.vfx.addShake(.1),!n.pierce){n.life=0;break}}const c=n.maxTravel!=null&&n.travel>=n.maxTravel||n.life<=0||Math.hypot(n.x,n.z)>ge.arenaRadius+2;!l&&c?((n.kind==="fireball"||n.explodeRadius>0)&&this._explodeProjectile(n),this._disposeProjectile(n),this.projectiles.splice(t,1)):(l||n.life<=0)&&(this._disposeProjectile(n),this.projectiles.splice(t,1));continue}if(n.owner==="rival"){if(n.mesh&&n.mesh.position.set(n.x,n.y||1.2,n.z),this.pvp?.mode==="duel")this.player.alive&&Math.hypot(n.x-this.player.x,n.z-this.player.z)<.75&&(this._hurtPlayer(n.damage),this.vfx.spawnImpact(this.player.x,this.player.z,14753096),n.life=0);else for(const l of this.enemies)if(!(!l.alive||l.riseT>0||l.def?.isRival)&&!n.hitIds?.has(l.id)&&!(Math.hypot(l.x-n.x,l.z-n.z)>(n.radius||.5)+l.def.radius)){n.hitIds?.add(l.id),this._rivalDamageEnemy(this.rival,l,n.damage),this.vfx.spawnImpact(l.x,l.z,14753096),n.life=0;break}(n.life<=0||n.maxTravel!=null&&n.travel>=n.maxTravel||Math.hypot(n.x,n.z)>ge.arenaRadius+2)&&(this._disposeProjectile(n),this.projectiles.splice(t,1));continue}n.mesh&&n.mesh.position.set(n.x,1.1,n.z);const a=this.player.alive&&Math.hypot(n.x-this.player.x,n.z-this.player.z)<.7;a&&(this._hurtPlayer(n.damage),n.shock&&(this.player.statuses.shock=.9*(this.arena.mods.shockDurationMul||1),this.vfx.floatText(this.player.x,2.2,this.player.z,"SHOCK","shock")),n.chill&&this._applyPlayerStatus("chill",1.8),n.life=0),!a&&this.pvp&&this.pvp.mode!=="duel"&&this.rival?.alive&&Math.hypot(n.x-this.rival.x,n.z-this.rival.z)<.8&&(this.rival.hurt(n.damage),n.life=0),(n.life<=0||Math.hypot(n.x,n.z)>ge.arenaRadius+2)&&(this._disposeProjectile(n),this.projectiles.splice(t,1))}}_explodeProjectile(e){const t=e.explodeRadius||3.4;this.vfx.spawnFireballExplosion(e.x,e.z,e.primary||16347926,t),this.vfx.addShake(.45),this.vfx.addHitStop(.08),this.vfx.floatText(e.x,2,e.z,"BOOM","crit");for(const n of this.enemies){if(!n.alive||n.riseT>0)continue;const i=Math.hypot(n.x-e.x,n.z-e.z);if(i<=t+n.def.radius){const s=1-i/(t+n.def.radius)*.35;this._damageEnemy(n,e.damage*s,i<t*.35,{knock:6,fx:(n.x-e.x)/(i||1),fz:(n.z-e.z)/(i||1)}),e.burnDps>0&&e.burnDuration>0&&(n.burn=e.burnDuration,n.burnDps=e.burnDps)}}if(e.burnDps>0){this.vfx.spawnPatch(e.x,e.z,e.primary||16347926,t*.65,e.burnDuration||1.5);const n=this.vfx.patches[this.vfx.patches.length-1];n&&(n.dps=e.burnDps*.5,n.burn=!0)}e.life=0}_disposeProjectile(e){e?.mesh&&(this.scene.remove(e.mesh),e.mesh.traverse?.(t=>{t.geometry?.dispose?.(),Array.isArray(t.material)?t.material.forEach(n=>n?.dispose?.()):t.material?.dispose?.()}),e.mesh.geometry?.dispose?.(),e.mesh.material?.dispose?.(),e.mesh=null)}_updatePatches(e){for(const t of this.vfx.patches){if(t.hostile&&t.dps){this.player.alive&&Math.hypot(this.player.x-t.x,this.player.z-t.z)<=t.radius&&(t.tickT=(t.tickT??0)-e,t.tickT<=0&&(t.tickT=.5,this._hurtPlayer(t.dps*.5),t.chill&&this._applyPlayerStatus("chill",1.2)));continue}if(!(!t.burn||!t.dps))for(const n of this.enemies)n.alive&&Math.hypot(n.x-t.x,n.z-t.z)<=t.radius&&(n.hp-=t.dps*e*.5,n.hp<=0?this._killEnemy(n):this._updateEnemyHpBar(n))}}_updateWaves(e){if(this.pvp){this._updatePvpWaves(e);return}if(this.spawnQueue.length&&(this.spawnTimer-=e,this.spawnTimer<=0)){const t=this.spawnQueue.shift();this._spawnEnemy(t.typeId),this.spawnTimer=t.delay||.25}if(this.mode==="playing"&&this.spawnQueue.length===0&&this.enemies.length===0&&this.waveClearTimer<=0){const t=this._maxWaves(),n=this.arena.index,i=Da(this.wave,n),s=Ir(this.wave,n)===i;this.wave>=t?(this.waveClearTimer=1.8,this.pendingVictory=!0,this.pendingLevelClear=!1,this.ui.showWaveBanner(this.arena,this.wave,!0,{level:this.level,levels:ge.levelsPerRealm,boss:!0}),this.audio.waveClear(),this.score+=400*this.level*(this.arena.mods.scoreMul||1)):s?(this.waveClearTimer=1.45,this.pendingVictory=!1,this.pendingLevelClear=!0,this._recordLevelProgress(this.level,!1),this.ui.showWaveBanner(this.arena,this.wave,!1,{level:this.level,levels:ge.levelsPerRealm,levelClear:!0}),this.audio.waveClear(),this.score+=220*this.level*(this.arena.mods.scoreMul||1)):(this.waveClearTimer=ge.waveGap,this.pendingVictory=!1,this.pendingLevelClear=!1,this.ui.showWaveBanner(this.arena,this.wave,!1,{level:this.level,levels:ge.levelsPerRealm}),this.audio.waveClear(),this.score+=150*this.wave*(this.arena.mods.scoreMul||1))}this.mode==="playing"&&this.waveClearTimer>0&&(this.waveClearTimer-=e,this.waveClearTimer<=0&&(this.pendingVictory?this._endRun(!0):(this.pendingLevelClear&&this.ui.toast(`Level ${this.level+1}/${ge.levelsPerRealm} — ${this.arena.name}`),this.pendingLevelClear=!1,this._beginWave(this.wave+1))))}_updatePvpWaves(e){if(this.pvp.mode!=="duel"){if(this.spawnQueue.length&&(this.spawnTimer-=e,this.spawnTimer<=0)){const t=this.spawnQueue.shift();this._spawnEnemy(t.typeId),this.spawnTimer=t.delay||.25}this.mode==="playing"&&this.spawnQueue.length===0&&this.enemies.length===0&&this.waveClearTimer<=0&&(this.waveClearTimer=.9,this.score+=60*(this.arena.mods.scoreMul||1),this.audio.waveClear()),this.mode==="playing"&&this.waveClearTimer>0&&(this.waveClearTimer-=e,this.waveClearTimer<=0&&this._beginWave(this.wave+1))}}_updateCds(e){for(const t of Object.values(this.cds))t.t>0&&(t.t=Math.max(0,t.t-e))}_updateCombo(e){this.comboTimer>0&&(this.comboTimer-=e,this.comboTimer<=0&&(this.combo=Math.max(1,this.combo-.5)),this.combo>1&&this.comboTimer<=0&&(this.comboTimer=.8))}_updateDebug(e){if(this._fpsAcc+=e,this._fpsFrames++,this._fpsAcc>=.4&&(this._fps=this._fpsFrames/this._fpsAcc,this._fpsAcc=0,this._fpsFrames=0),this.input.debugPressed&&(this.input.debugPressed=!1,this.debug=!this.debug,this.ui.setDebugVisible?.(this.debug),this.debug&&this.audio.ui()),!this.debug)return;const t=this.enemies.filter(i=>i.alive).length,n=this._lastWavePlan;this.ui.updateDebug?.({fps:this._fps,mode:this.mode,classId:this.classId,weaponMode:this.weaponMode,arena:this.arenaId,campaign:this.campaign,level:this.level,levels:ge.levelsPerRealm,wave:this.wave,maxWaves:this._maxWaves(),waveInLevel:Ir(this.wave,this.arena?.index??0),wavesPerLevel:Da(this.wave,this.arena?.index??0),enemies:t,projectiles:this.projectiles.length,score:Math.floor(this.score),hp:this.player?.hp,maxHp:this.player?.maxHp,pos:this.player?`${this.player.x.toFixed(1)}, ${this.player.z.toFixed(1)}`:"—",pitch:this.camOrbit?.pitch?.toFixed?.(2),yaw:this.camOrbit?.yaw?.toFixed?.(2),zoom:this.camOrbit?.dist?.toFixed?.(2),plan:n?.label||"—",boss:!!(n?.isRealmBoss||n?.isBoss),version:ge.version})}_updateCamera(e){const t=this.camOrbit,n=this.input.consumeLook?.()||{dx:0,dy:0,zoom:0,looking:!1};if(n.looking||Math.abs(n.dx)+Math.abs(n.dy)>0){t.targetYaw-=n.dx*.0075;const x=this.settings?.invertY?-1:1;t.targetPitch=Math.max(-.95,Math.min(.95,t.targetPitch+x*n.dy*.0085)),t.manualT=3.2}n.zoom&&(t.targetDist=Math.max(.5,Math.min(1.85,t.targetDist+n.zoom)),t.manualT=Math.max(t.manualT,1.2));const i=1-Math.pow(25e-5,Math.max(e,.001));t.yaw+=(t.targetYaw-t.yaw)*i,t.pitch+=(t.targetPitch-t.pitch)*i,t.dist+=(t.targetDist-t.dist)*Math.min(1,e*10),t.manualT>0&&(t.manualT=Math.max(0,t.manualT-e));const s=this._camTarget.set(this.player.x,0,this.player.z),a=Math.max(.18,Math.min(1.42,.92+t.pitch)),o=Math.hypot(ge.cameraHeight,ge.cameraOffset)*t.dist,l=Math.sin(a)*o,c=Math.cos(a)*o,h=t.yaw,u=t.manualT>0?.12:1,d=(Math.sin(this.player.facing)*1.2+(this.player.vx||0)*.08)*u,f=(Math.cos(this.player.facing)*.8+(this.player.vz||0)*.08)*u,m=this._camPos.set(s.x+Math.sin(h)*c+d*.35,Math.max(2.8,l),s.z+Math.cos(h)*c+f*.2),_=1-Math.pow(8e-4,Math.max(e,.001));this.camera.position.lerp(m,_);const g=.75+(1.42-a)*1.35;this._look.set(s.x+d*.5,g,s.z+f*.4),this.camera.lookAt(this._look);const p=this.camera.position.clone();this.vfx.applyCameraShake(p,this.camera)}_frame(e){try{const t=Math.min(.05,(e-this._last)/1e3);this._last=e,this.time+=t;const n=this.input.poll();if(n.pause&&this.mode==="playing"?this.pause():n.pause&&this.mode==="paused"&&this.resume(),this.mode==="menu"||this.mode==="result"){if(this.builtArena){zc(this.builtArena,this.time);const s=this.mode==="menu"?15:17,a=this.mode==="menu"?12.5:16;if(this.camera.position.set(Math.sin(this.time*.22)*s,a+Math.sin(this.time*.4)*.4,Math.cos(this.time*.22)*s*.85+4),this.camera.lookAt(0,1,0),this.player?.mesh?.visible&&this.mode==="menu"){const o=this.player.mesh,l=this.time*3.2,c=.22;if(o.position.set(0,Math.sin(l*2)*.04,0),o.rotation.y=this.time*.35,o.userData.legL&&(o.userData.legL.rotation.x=Math.sin(l)*c),o.userData.legR&&(o.userData.legR.rotation.x=-Math.sin(l)*c),o.userData.armL&&(o.userData.armL.rotation.x=-Math.sin(l)*c*.7),o.userData.armR&&(o.userData.armR.rotation.x=Math.sin(l)*c*.35),o.userData.weapon){const h=o.userData.weaponRest;h&&(o.userData.weapon.rotation.x=h.rx+Math.sin(this.time*2)*.04,o.userData.weapon.rotation.y=h.ry+Math.sin(this.time*1.6)*.06,o.userData.weapon.rotation.z=h.rz)}if(o.userData.aura&&(o.userData.aura.material.opacity=.1+Math.sin(this.time*2.5)*.04,o.userData.aura.scale.setScalar(1+Math.sin(this.time*2)*.05)),o.userData.groundRing&&(o.userData.groundRing.rotation.z=this.time*.9,o.userData.groundRing.material.opacity=.32+Math.sin(this.time*3)*.12),o.userData.chestGem?.scale){const h=1+Math.sin(this.time*3.5)*.15;o.userData.chestGem.scale.setScalar(h)}o.userData.blade?.scale&&o.userData.weaponStyle==="staff"&&o.userData.blade.scale.setScalar(1+Math.sin(this.time*4)*.12)}}this.vfx.update(t),this._updateDebug(t),this.renderer.render(this.scene,this.camera);return}this.vfx.update(t);const i=t*this.vfx.timeScale;this.mode==="playing"?(this._updateCds(i),this._updateCombo(i),this._updatePlayer(i,n),this._updateEnemies(i),this._updateProjectiles(i),this._updatePatches(i),this._updateWaves(i),this._updateBossCasts(i),this.pvp&&this._updatePvp(i),zc(this.builtArena,this.time),this._updateCamera(i),this.ui.updateHud({hp:this.player.hp,maxHp:this.player.maxHp,score:this.score,combo:this.combo,wave:this.wave,maxWaves:this._maxWaves(),waveInLevel:Ir(this.wave,this.arena.index),wavesPerLevel:Da(this.wave,this.arena.index),level:this.level,levels:ge.levelsPerRealm,arenaName:this.arena.name,cds:this.cds,statuses:{...this.player.statuses,block:this.player.blockT>0?this.player.blockT:0},className:this._classDef().name,weaponMode:this.classId==="warrior"?this.weaponMode:null,modeSwapCd:this.modeSwapCd})):this.mode==="paused"&&this._updateCamera(.016),this._updateDebug(t),this.renderer.render(this.scene,this.camera)}catch(t){console.error("[frame]",t)}finally{requestAnimationFrame(t=>this._frame(t))}}}const iu=document.getElementById("game-canvas");if(!iu)throw new Error("Missing #game-canvas");const xi=document.createElement("div");xi.id="boot-load";xi.style.cssText=`
  position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 50% 35%,#2a1038,#0b0710 75%);z-index:100;color:#e8dcc8;
  font-family:Cinzel,Georgia,serif;`;xi.innerHTML=`
  <div style="font-size:40px;font-weight:900;letter-spacing:2px;
    background:linear-gradient(180deg,#ffe9a8,#e8b83a 50%,#ff6a2a);-webkit-background-clip:text;background-clip:text;color:transparent">
    EMBER SANCTUM</div>
  <div style="width:280px;height:10px;border:2px solid #e8b83a;border-radius:6px;margin-top:26px;overflow:hidden">
    <div id="es-loadbar" style="width:8%;height:100%;background:linear-gradient(90deg,#7a4dcf,#e8b83a);transition:width .2s"></div>
  </div>
  <div id="es-loadtxt" style="margin-top:12px;font-size:13px;color:#b89ae0;font-family:Rajdhani,sans-serif">Forging the sanctum…</div>`;document.body.appendChild(xi);const bs=(r,e)=>{const t=document.getElementById("es-loadbar");t&&(t.style.width=`${Math.max(8,Math.round(r*100))}%`);const n=document.getElementById("es-loadtxt");n&&e&&(n.textContent=e)};function Fo(){try{xi.remove()}catch{}}function Bo(r={}){const e=new $x(iu,r);window.__emberSanctum=e,window.__FFG3D__={game:e,stats:()=>({state:e.mode,hp:e.player?.hp,score:e.score,wave:e.wave,enemies:e.enemies?.filter(n=>n.alive).length||0,combo:e.combo,classId:e.classId,hasGlb:!!(r.enemies&&Object.keys(r.enemies).length)})};const t=()=>{e.audio.ensure(),e.audio.playMusic?.("battle")};return document.getElementById("screen-title")?.addEventListener("pointerdown",t,{once:!0}),document.body.addEventListener("keydown",t,{once:!0}),console.info("%c Ember Sanctum %c v3.0.0 — boss stories & signature attacks · PVP arena · fullscreen ","background:#e11d48;color:#fff;padding:2px 6px;border-radius:4px 0 0 4px","background:#1e1b4b;color:#fbbf24;padding:2px 6px;border-radius:0 4px 4px 0"),e}async function jx(){let r={enemies:null};try{bs(.1,"Rousing the legions…"),r=await Cx({onProgress:(t,n)=>bs(t,n),timeoutMs:8e3});const e=r.enemies?Object.keys(r.enemies).length:0;bs(1,e?"Ready.":"Procedural mode")}catch(e){console.error("[boot] asset load failed — procedural fallback",e),bs(1,"Assets missing — procedural mode"),r={enemies:null}}try{Bo(r),Fo()}catch(e){console.error("[boot] game construct failed, retry bare",e);try{Bo({}),Fo()}catch(t){console.error(t),bs(1,"Boot failed — check console (F12)"),xi.style.cursor="pointer",xi.onclick=()=>location.reload();const n=document.getElementById("es-loadtxt");n&&(n.textContent="Boot failed — click to reload (F12 for errors)")}}}const Kx=setTimeout(()=>{if(document.getElementById("boot-load")){if(console.warn("[boot] force-dismiss loader"),!window.__emberSanctum)try{Bo({})}catch(r){console.error(r)}Fo()}},12e3);jx().finally(()=>clearTimeout(Kx));
