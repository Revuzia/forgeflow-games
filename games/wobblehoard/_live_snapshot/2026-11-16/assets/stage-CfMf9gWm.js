import{a as e,i as t,r as n,t as r}from"./rng-DTRKR-_l.js";import{a as i}from"./catalog-B5lW9iPw.js";import{f as a,h as o,i as s,m as c,n as l,p as u,r as d,t as f}from"./index-EDiFfg-N.js";var p=1e3,m=1001,h=1002,g=1003,_=1004,v=1005,y=1006,b=1007,x=1008,S=1009,C=1010,w=1011,T=1012,E=1013,D=1014,O=1015,k=1016,A=1017,j=1018,M=1020,N=35902,P=35899,F=1021,I=1022,L=1023,ee=1026,te=1027,ne=1028,re=1029,R=1030,ie=1031,z=1033,B=33776,ae=33777,oe=33778,V=33779,se=35840,ce=35841,le=35842,ue=35843,de=36196,H=37492,fe=37496,pe=37488,me=37489,he=37490,ge=37491,_e=37808,ve=37809,ye=37810,be=37811,xe=37812,Se=37813,Ce=37814,we=37815,Te=37816,U=37817,Ee=37818,De=37819,Oe=37820,W=37821,ke=36492,G=36494,Ae=36495,je=36283,Me=36284,Ne=36285,Pe=36286,Fe=2300,Ie=2301,Le=2302,Re=2303,ze=2400,Be=2401,Ve=2402,He=3200,Ue=`srgb`,We=`srgb-linear`,Ge=`linear`,Ke=`srgb`,qe=7680,Je=35044,Ye=35048,Xe=2e3;function Ze(e){for(let t=e.length-1;t>=0;--t)if(e[t]>=65535)return!0;return!1}function Qe(e){return ArrayBuffer.isView(e)&&!(e instanceof DataView)}function $e(e){return document.createElementNS(`http://www.w3.org/1999/xhtml`,e)}function et(){let e=$e(`canvas`);return e.style.display=`block`,e}var tt={};function nt(...e){let t=`THREE.`+e.shift();console.log(t,...e)}function rt(e){let t=e[0];if(typeof t==`string`&&t.startsWith(`TSL:`)){let t=e[1];t&&t.isStackTrace?e[0]+=` `+t.getLocation():e[1]=`Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.`}return e}function K(...e){e=rt(e);let t=`THREE.`+e.shift();{let n=e[0];n&&n.isStackTrace?console.warn(n.getError(t)):console.warn(t,...e)}}function q(...e){e=rt(e);let t=`THREE.`+e.shift();{let n=e[0];n&&n.isStackTrace?console.error(n.getError(t)):console.error(t,...e)}}function it(...e){let t=e.join(` `);t in tt||(tt[t]=!0,K(...e))}function at(e,t,n){return new Promise(function(r,i){function a(){switch(e.clientWaitSync(t,e.SYNC_FLUSH_COMMANDS_BIT,0)){case e.WAIT_FAILED:i();break;case e.TIMEOUT_EXPIRED:setTimeout(a,n);break;default:r()}}setTimeout(a,n)})}var ot={0:1,2:6,4:7,3:5,1:0,6:2,7:4,5:3},st=class{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){let n=this._listeners;return n!==void 0&&n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){let n=this._listeners;if(n===void 0)return;let r=n[e];if(r!==void 0){let e=r.indexOf(t);e!==-1&&r.splice(e,1)}}dispatchEvent(e){let t=this._listeners;if(t===void 0)return;let n=t[e.type];if(n!==void 0){e.target=this;let t=n.slice(0);for(let n=0,r=t.length;n<r;n++)t[n].call(this,e);e.target=null}}},ct=`00.01.02.03.04.05.06.07.08.09.0a.0b.0c.0d.0e.0f.10.11.12.13.14.15.16.17.18.19.1a.1b.1c.1d.1e.1f.20.21.22.23.24.25.26.27.28.29.2a.2b.2c.2d.2e.2f.30.31.32.33.34.35.36.37.38.39.3a.3b.3c.3d.3e.3f.40.41.42.43.44.45.46.47.48.49.4a.4b.4c.4d.4e.4f.50.51.52.53.54.55.56.57.58.59.5a.5b.5c.5d.5e.5f.60.61.62.63.64.65.66.67.68.69.6a.6b.6c.6d.6e.6f.70.71.72.73.74.75.76.77.78.79.7a.7b.7c.7d.7e.7f.80.81.82.83.84.85.86.87.88.89.8a.8b.8c.8d.8e.8f.90.91.92.93.94.95.96.97.98.99.9a.9b.9c.9d.9e.9f.a0.a1.a2.a3.a4.a5.a6.a7.a8.a9.aa.ab.ac.ad.ae.af.b0.b1.b2.b3.b4.b5.b6.b7.b8.b9.ba.bb.bc.bd.be.bf.c0.c1.c2.c3.c4.c5.c6.c7.c8.c9.ca.cb.cc.cd.ce.cf.d0.d1.d2.d3.d4.d5.d6.d7.d8.d9.da.db.dc.dd.de.df.e0.e1.e2.e3.e4.e5.e6.e7.e8.e9.ea.eb.ec.ed.ee.ef.f0.f1.f2.f3.f4.f5.f6.f7.f8.f9.fa.fb.fc.fd.fe.ff`.split(`.`),lt=Math.PI/180,ut=180/Math.PI;function dt(){let e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0,r=Math.random()*4294967295|0;return(ct[e&255]+ct[e>>8&255]+ct[e>>16&255]+ct[e>>24&255]+`-`+ct[t&255]+ct[t>>8&255]+`-`+ct[t>>16&15|64]+ct[t>>24&255]+`-`+ct[n&63|128]+ct[n>>8&255]+`-`+ct[n>>16&255]+ct[n>>24&255]+ct[r&255]+ct[r>>8&255]+ct[r>>16&255]+ct[r>>24&255]).toLowerCase()}function J(e,t,n){return Math.max(t,Math.min(n,e))}function ft(e,t){return(e%t+t)%t}function pt(e,t,n){return(1-n)*e+n*t}function mt(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return e/4294967295;case Uint16Array:return e/65535;case Uint8Array:case Uint8ClampedArray:return e/255;case Int32Array:return Math.max(e/2147483647,-1);case Int16Array:return Math.max(e/32767,-1);case Int8Array:return Math.max(e/127,-1);default:throw Error(`THREE.MathUtils: Invalid component type.`)}}function ht(e,t){switch(t.constructor){case Float32Array:return e;case Uint32Array:return Math.round(e*4294967295);case Uint16Array:return Math.round(e*65535);case Uint8Array:case Uint8ClampedArray:return Math.round(e*255);case Int32Array:return Math.round(e*2147483647);case Int16Array:return Math.round(e*32767);case Int8Array:return Math.round(e*127);default:throw Error(`THREE.MathUtils: Invalid component type.`)}}var Y=class e{static{e.prototype.isVector2=!0}constructor(e=0,t=0){this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw Error(`THREE.Vector2: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw Error(`THREE.Vector2: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){let t=this.x,n=this.y,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6],this.y=r[1]*t+r[4]*n+r[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=J(this.x,e.x,t.x),this.y=J(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=J(this.x,e,t),this.y=J(this.y,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(J(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(J(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){let n=Math.cos(t),r=Math.sin(t),i=this.x-e.x,a=this.y-e.y;return this.x=i*n-a*r+e.x,this.y=i*r+a*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}},gt=class{constructor(e=0,t=0,n=0,r=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=r}static slerpFlat(e,t,n,r,i,a,o){let s=n[r+0],c=n[r+1],l=n[r+2],u=n[r+3],d=i[a+0],f=i[a+1],p=i[a+2],m=i[a+3];if(u!==m||s!==d||c!==f||l!==p){let e=s*d+c*f+l*p+u*m;e<0&&(d=-d,f=-f,p=-p,m=-m,e=-e);let t=1-o;if(e<.9995){let n=Math.acos(e),r=Math.sin(n);t=Math.sin(t*n)/r,o=Math.sin(o*n)/r,s=s*t+d*o,c=c*t+f*o,l=l*t+p*o,u=u*t+m*o}else{s=s*t+d*o,c=c*t+f*o,l=l*t+p*o,u=u*t+m*o;let e=1/Math.sqrt(s*s+c*c+l*l+u*u);s*=e,c*=e,l*=e,u*=e}}e[t]=s,e[t+1]=c,e[t+2]=l,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,r,i,a){let o=n[r],s=n[r+1],c=n[r+2],l=n[r+3],u=i[a],d=i[a+1],f=i[a+2],p=i[a+3];return e[t]=o*p+l*u+s*f-c*d,e[t+1]=s*p+l*d+c*u-o*f,e[t+2]=c*p+l*f+o*d-s*u,e[t+3]=l*p-o*u-s*d-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,r){return this._x=e,this._y=t,this._z=n,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,r=e._y,i=e._z,a=e._order,o=Math.cos,s=Math.sin,c=o(n/2),l=o(r/2),u=o(i/2),d=s(n/2),f=s(r/2),p=s(i/2);switch(a){case`XYZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`YXZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`ZXY`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`ZYX`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`YZX`:this._x=d*l*u+c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u-d*f*p;break;case`XZY`:this._x=d*l*u-c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u+d*f*p;break;default:K(`Quaternion: .setFromEuler() encountered an unknown order: `+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,r=Math.sin(n);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],r=t[4],i=t[8],a=t[1],o=t[5],s=t[9],c=t[2],l=t[6],u=t[10],d=n+o+u;if(d>0){let e=.5/Math.sqrt(d+1);this._w=.25/e,this._x=(l-s)*e,this._y=(i-c)*e,this._z=(a-r)*e}else if(n>o&&n>u){let e=2*Math.sqrt(1+n-o-u);this._w=(l-s)/e,this._x=.25*e,this._y=(r+a)/e,this._z=(i+c)/e}else if(o>u){let e=2*Math.sqrt(1+o-n-u);this._w=(i-c)/e,this._x=(r+a)/e,this._y=.25*e,this._z=(s+l)/e}else{let e=2*Math.sqrt(1+u-n-o);this._w=(a-r)/e,this._x=(i+c)/e,this._y=(s+l)/e,this._z=.25*e}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(J(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let r=Math.min(1,t/n);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x*=e,this._y*=e,this._z*=e,this._w*=e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,r=e._y,i=e._z,a=e._w,o=t._x,s=t._y,c=t._z,l=t._w;return this._x=n*l+a*o+r*c-i*s,this._y=r*l+a*s+i*o-n*c,this._z=i*l+a*c+n*s-r*o,this._w=a*l-n*o-r*s-i*c,this._onChangeCallback(),this}slerp(e,t){let n=e._x,r=e._y,i=e._z,a=e._w,o=this.dot(e);o<0&&(n=-n,r=-r,i=-i,a=-a,o=-o);let s=1-t;if(o<.9995){let e=Math.acos(o),c=Math.sin(e);s=Math.sin(s*e)/c,t=Math.sin(t*e)/c,this._x=this._x*s+n*t,this._y=this._y*s+r*t,this._z=this._z*s+i*t,this._w=this._w*s+a*t,this._onChangeCallback()}else this._x=this._x*s+n*t,this._y=this._y*s+r*t,this._z=this._z*s+i*t,this._w=this._w*s+a*t,this.normalize();return this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),r=Math.sqrt(1-n),i=Math.sqrt(n);return this.set(r*Math.sin(e),r*Math.cos(e),i*Math.sin(t),i*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},X=class e{static{e.prototype.isVector3=!0}constructor(e=0,t=0,n=0){this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw Error(`THREE.Vector3: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw Error(`THREE.Vector3: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(vt.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(vt.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[3]*n+i[6]*r,this.y=i[1]*t+i[4]*n+i[7]*r,this.z=i[2]*t+i[5]*n+i[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=e.elements,a=1/(i[3]*t+i[7]*n+i[11]*r+i[15]);return this.x=(i[0]*t+i[4]*n+i[8]*r+i[12])*a,this.y=(i[1]*t+i[5]*n+i[9]*r+i[13])*a,this.z=(i[2]*t+i[6]*n+i[10]*r+i[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,r=this.z,i=e.x,a=e.y,o=e.z,s=e.w,c=2*(a*r-o*n),l=2*(o*t-i*r),u=2*(i*n-a*t);return this.x=t+s*c+a*u-o*l,this.y=n+s*l+o*c-i*u,this.z=r+s*u+i*l-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[4]*n+i[8]*r,this.y=i[1]*t+i[5]*n+i[9]*r,this.z=i[2]*t+i[6]*n+i[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=J(this.x,e.x,t.x),this.y=J(this.y,e.y,t.y),this.z=J(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=J(this.x,e,t),this.y=J(this.y,e,t),this.z=J(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(J(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,r=e.y,i=e.z,a=t.x,o=t.y,s=t.z;return this.x=r*s-i*o,this.y=i*a-n*s,this.z=n*o-r*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return _t.copy(this).projectOnVector(e),this.sub(_t)}reflect(e){return this.sub(_t.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(J(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,r=this.z-e.z;return t*t+n*n+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let r=Math.sin(t)*e;return this.x=r*Math.sin(n),this.y=Math.cos(t)*e,this.z=r*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=r,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},_t=new X,vt=new gt,Z=class e{static{e.prototype.isMatrix3=!0}constructor(e,t,n,r,i,a,o,s,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,r,i,a,o,s,c)}set(e,t,n,r,i,a,o,s,c){let l=this.elements;return l[0]=e,l[1]=r,l[2]=o,l[3]=t,l[4]=i,l[5]=s,l[6]=n,l[7]=a,l[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[3],s=n[6],c=n[1],l=n[4],u=n[7],d=n[2],f=n[5],p=n[8],m=r[0],h=r[3],g=r[6],_=r[1],v=r[4],y=r[7],b=r[2],x=r[5],S=r[8];return i[0]=a*m+o*_+s*b,i[3]=a*h+o*v+s*x,i[6]=a*g+o*y+s*S,i[1]=c*m+l*_+u*b,i[4]=c*h+l*v+u*x,i[7]=c*g+l*y+u*S,i[2]=d*m+f*_+p*b,i[5]=d*h+f*v+p*x,i[8]=d*g+f*y+p*S,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8];return t*a*l-t*o*c-n*i*l+n*o*s+r*i*c-r*a*s}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=l*a-o*c,d=o*s-l*i,f=c*i-a*s,p=t*u+n*d+r*f;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);let m=1/p;return e[0]=u*m,e[1]=(r*c-l*n)*m,e[2]=(o*n-r*a)*m,e[3]=d*m,e[4]=(l*t-r*s)*m,e[5]=(r*i-o*t)*m,e[6]=f*m,e[7]=(n*s-c*t)*m,e[8]=(a*t-n*i)*m,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,r,i,a,o){let s=Math.cos(i),c=Math.sin(i);return this.set(n*s,n*c,-n*(s*a+c*o)+a+e,-r*c,r*s,-r*(-c*a+s*o)+o+t,0,0,1),this}scale(e,t){return it(`Matrix3: .scale() is deprecated. Use .makeScale() instead.`),this.premultiply(yt.makeScale(e,t)),this}rotate(e){return it(`Matrix3: .rotate() is deprecated. Use .makeRotation() instead.`),this.premultiply(yt.makeRotation(-e)),this}translate(e,t){return it(`Matrix3: .translate() is deprecated. Use .makeTranslation() instead.`),this.premultiply(yt.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<9;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},yt=new Z,bt=new Z().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),xt=new Z().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function St(){let e={enabled:!0,workingColorSpace:We,spaces:{},convert:function(e,t,n){return this.enabled===!1||t===n||!t||!n?e:(this.spaces[t].transfer===`srgb`&&(e.r=wt(e.r),e.g=wt(e.g),e.b=wt(e.b)),this.spaces[t].primaries!==this.spaces[n].primaries&&(e.applyMatrix3(this.spaces[t].toXYZ),e.applyMatrix3(this.spaces[n].fromXYZ)),this.spaces[n].transfer===`srgb`&&(e.r=Tt(e.r),e.g=Tt(e.g),e.b=Tt(e.b)),e)},workingToColorSpace:function(e,t){return this.convert(e,this.workingColorSpace,t)},colorSpaceToWorking:function(e,t){return this.convert(e,t,this.workingColorSpace)},getPrimaries:function(e){return this.spaces[e].primaries},getTransfer:function(e){return e===``?Ge:this.spaces[e].transfer},getToneMappingMode:function(e){return this.spaces[e].outputColorSpaceConfig.toneMappingMode||`standard`},getLuminanceCoefficients:function(e,t=this.workingColorSpace){return e.fromArray(this.spaces[t].luminanceCoefficients)},define:function(e){Object.assign(this.spaces,e)},_getMatrix:function(e,t,n){return e.copy(this.spaces[t].toXYZ).multiply(this.spaces[n].fromXYZ)},_getDrawingBufferColorSpace:function(e){return this.spaces[e].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(e=this.workingColorSpace){return this.spaces[e].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(t,n){return it(`ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace().`),e.workingToColorSpace(t,n)},toWorkingColorSpace:function(t,n){return it(`ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking().`),e.colorSpaceToWorking(t,n)}},t=[.64,.33,.3,.6,.15,.06],n=[.2126,.7152,.0722],r=[.3127,.329];return e.define({[We]:{primaries:t,whitePoint:r,transfer:Ge,toXYZ:bt,fromXYZ:xt,luminanceCoefficients:n,workingColorSpaceConfig:{unpackColorSpace:Ue},outputColorSpaceConfig:{drawingBufferColorSpace:Ue}},[Ue]:{primaries:t,whitePoint:r,transfer:Ke,toXYZ:bt,fromXYZ:xt,luminanceCoefficients:n,outputColorSpaceConfig:{drawingBufferColorSpace:Ue}}}),e}var Ct=St();function wt(e){return e<.04045?e*.0773993808:(e*.9478672986+.0521327014)**2.4}function Tt(e){return e<.0031308?e*12.92:1.055*e**.41666-.055}var Et,Dt=class{static getDataURL(e,t=`image/png`){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>`u`)return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{Et===void 0&&(Et=$e(`canvas`)),Et.width=e.width,Et.height=e.height;let t=Et.getContext(`2d`);e instanceof ImageData?t.putImageData(e,0,0):t.drawImage(e,0,0,e.width,e.height),n=Et}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap){let t=$e(`canvas`);t.width=e.width,t.height=e.height;let n=t.getContext(`2d`);n.drawImage(e,0,0,e.width,e.height);let r=n.getImageData(0,0,e.width,e.height),i=r.data;for(let e=0;e<i.length;e++)i[e]=wt(i[e]/255)*255;return n.putImageData(r,0,0),t}if(e.data){let t=e.data.slice(0);for(let e=0;e<t.length;e++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[e]=Math.floor(wt(t[e]/255)*255):t[e]=wt(t[e]);return{data:t,width:e.width,height:e.height}}return K(`ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied.`),e}},Ot=0,kt=class{constructor(e=null){this.isTextureSource=!0,Object.defineProperty(this,"id",{value:Ot++}),this.uuid=dt(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){let t=this.data;return typeof HTMLVideoElement<`u`&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):typeof VideoFrame<`u`&&t instanceof VideoFrame?e.set(t.displayWidth,t.displayHeight,0):t===null?e.set(0,0,0):e.set(t.width,t.height,t.depth||0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){let t=e===void 0||typeof e==`string`;if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];let n={uuid:this.uuid,url:``},r=this.data;if(r!==null){let e;if(Array.isArray(r)){e=[];for(let t=0,n=r.length;t<n;t++)r[t].isDataTexture?e.push(At(r[t].image)):e.push(At(r[t]))}else e=At(r);n.url=e}return t||(e.images[this.uuid]=n),n}};function At(e){return typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap?Dt.getDataURL(e):e.data?{data:Array.from(e.data),width:e.width,height:e.height,type:e.data.constructor.name}:(K(`Texture: Unable to serialize Texture.`),{})}var jt=0,Mt=new X,Nt=class e extends st{constructor(t=e.DEFAULT_IMAGE,n=e.DEFAULT_MAPPING,r=m,i=m,a=y,o=x,s=L,c=S,l=e.DEFAULT_ANISOTROPY,u=``){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:jt++}),this.uuid=dt(),this.name=``,this.source=new kt(t),this.mipmaps=[],this.mapping=n,this.channel=0,this.wrapS=r,this.wrapT=i,this.magFilter=a,this.minFilter=o,this.anisotropy=l,this.format=s,this.internalFormat=null,this.type=c,this.offset=new Y(0,0),this.repeat=new Y(1,1),this.center=new Y(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new Z,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(t&&t.depth&&t.depth>1),this.pmremVersion=0,this.normalized=!1}get width(){return this.source.getSize(Mt).x}get height(){return this.source.getSize(Mt).y}get depth(){return this.source.getSize(Mt).z}get image(){return this.source.data}set image(e){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.normalized=e.normalized,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(let t in e){let n=e[t];if(n===void 0){K(`Texture.setValues(): parameter '${t}' has value of undefined.`);continue}let r=this[t];if(r===void 0){K(`Texture.setValues(): property '${t}' does not exist.`);continue}r&&n&&r.isVector2&&n.isVector2||r&&n&&r.isVector3&&n.isVector3||r&&n&&r.isMatrix3&&n.isMatrix3?r.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e==`string`;if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];let n={metadata:{version:4.7,type:`Texture`,generator:`Texture.toJSON`},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:`dispose`})}transformUv(e){if(this.mapping!==300)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case p:e.x-=Math.floor(e.x);break;case m:e.x=e.x<0?0:1;break;case h:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x-=Math.floor(e.x)}if(e.y<0||e.y>1)switch(this.wrapT){case p:e.y-=Math.floor(e.y);break;case m:e.y=e.y<0?0:1;break;case h:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y-=Math.floor(e.y)}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}};Nt.DEFAULT_IMAGE=null,Nt.DEFAULT_MAPPING=300,Nt.DEFAULT_ANISOTROPY=1;var Pt=class e{static{e.prototype.isVector4=!0}constructor(e=0,t=0,n=0,r=1){this.x=e,this.y=t,this.z=n,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,r){return this.x=e,this.y=t,this.z=n,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw Error(`THREE.Vector4: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw Error(`THREE.Vector4: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w===void 0?1:e.w,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*r+a[12]*i,this.y=a[1]*t+a[5]*n+a[9]*r+a[13]*i,this.z=a[2]*t+a[6]*n+a[10]*r+a[14]*i,this.w=a[3]*t+a[7]*n+a[11]*r+a[15]*i,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,r,i,a=.01,o=.1,s=e.elements,c=s[0],l=s[4],u=s[8],d=s[1],f=s[5],p=s[9],m=s[2],h=s[6],g=s[10];if(Math.abs(l-d)<a&&Math.abs(u-m)<a&&Math.abs(p-h)<a){if(Math.abs(l+d)<o&&Math.abs(u+m)<o&&Math.abs(p+h)<o&&Math.abs(c+f+g-3)<o)return this.set(1,0,0,0),this;t=Math.PI;let e=(c+1)/2,s=(f+1)/2,_=(g+1)/2,v=(l+d)/4,y=(u+m)/4,b=(p+h)/4;return e>s&&e>_?e<a?(n=0,r=.707106781,i=.707106781):(n=Math.sqrt(e),r=v/n,i=y/n):s>_?s<a?(n=.707106781,r=0,i=.707106781):(r=Math.sqrt(s),n=v/r,i=b/r):_<a?(n=.707106781,r=.707106781,i=0):(i=Math.sqrt(_),n=y/i,r=b/i),this.set(n,r,i,t),this}let _=Math.sqrt((h-p)*(h-p)+(u-m)*(u-m)+(d-l)*(d-l));return Math.abs(_)<.001&&(_=1),this.x=(h-p)/_,this.y=(u-m)/_,this.z=(d-l)/_,this.w=Math.acos((c+f+g-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=J(this.x,e.x,t.x),this.y=J(this.y,e.y,t.y),this.z=J(this.z,e.z,t.z),this.w=J(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=J(this.x,e,t),this.y=J(this.y,e,t),this.z=J(this.z,e,t),this.w=J(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(J(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},Ft=class extends st{constructor(e=1,t=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:y,depthBuffer:!0,stencilBuffer:!1,resolveColorBuffer:!0,resolveDepthBuffer:!0,resolveStencilBuffer:!0,storeMultisampledColorBuffer:!0,storeMultisampledDepthBuffer:!0,storeMultisampledStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},n),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=n.depth,this.scissor=new Pt(0,0,e,t),this.scissorTest=!1,this.viewport=new Pt(0,0,e,t),this.textures=[];let r=new Nt({width:e,height:t,depth:n.depth}),i=n.count;for(let e=0;e<i;e++)this.textures[e]=r.clone(),this.textures[e].isRenderTargetTexture=!0,this.textures[e].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveColorBuffer=n.resolveColorBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this.storeMultisampledColorBuffer=n.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=n.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=n.storeMultisampledStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview,this.useArrayDepthTexture=n.useArrayDepthTexture}_setTextureOptions(e={}){let t={minFilter:y,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let e=0;e<this.textures.length;e++)this.textures[e].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&this._depthTexture.renderTarget===this&&(this._depthTexture.renderTarget=null),e!==null&&e.renderTarget===null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let r=0,i=this.textures.length;r<i;r++)this.textures[r].image.width=e,this.textures[r].image.height=t,this.textures[r].image.depth=n,this.textures[r].isData3DTexture!==!0&&(this.textures[r].isArrayTexture=this.textures[r].image.depth>1);this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,n=e.textures.length;t<n;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;let n=Object.assign({},e.textures[t].image);this.textures[t].source=new kt(n)}if(this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveColorBuffer=e.resolveColorBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,this.storeMultisampledColorBuffer=e.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=e.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=e.storeMultisampledStencilBuffer,e.depthTexture!==null){if(e.depthTexture.renderTarget===e){let t=e.depthTexture.clone();t.renderTarget=null,this.depthTexture=t}else this.depthTexture=e.depthTexture}return this.samples=e.samples,this.multiview=e.multiview,this.useArrayDepthTexture=e.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:`dispose`})}},It=class extends Ft{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}},Lt=class extends Nt{constructor(e=null,t=1,n=1,r=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:r},this.magFilter=g,this.minFilter=g,this.wrapR=m,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}copy(e){return super.copy(e),this.wrapR=e.wrapR,this}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}},Rt=class extends Nt{constructor(e=null,t=1,n=1,r=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:r},this.magFilter=g,this.minFilter=g,this.wrapR=m,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}copy(e){return super.copy(e),this.wrapR=e.wrapR,this}},zt=class e{static{e.prototype.isMatrix4=!0}constructor(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h)}set(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h){let g=this.elements;return g[0]=e,g[4]=t,g[8]=n,g[12]=r,g[1]=i,g[5]=a,g[9]=o,g[13]=s,g[2]=c,g[6]=l,g[10]=u,g[14]=d,g[3]=f,g[7]=p,g[11]=m,g[15]=h,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new e().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return this.determinantAffine()===0?(e.set(1,0,0),t.set(0,1,0),n.set(0,0,1),this):(e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){if(e.determinantAffine()===0)return this.identity();let t=this.elements,n=e.elements,r=1/Bt.setFromMatrixColumn(e,0).length(),i=1/Bt.setFromMatrixColumn(e,1).length(),a=1/Bt.setFromMatrixColumn(e,2).length();return t[0]=n[0]*r,t[1]=n[1]*r,t[2]=n[2]*r,t[3]=0,t[4]=n[4]*i,t[5]=n[5]*i,t[6]=n[6]*i,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,r=e.y,i=e.z,a=Math.cos(n),o=Math.sin(n),s=Math.cos(r),c=Math.sin(r),l=Math.cos(i),u=Math.sin(i);if(e.order===`XYZ`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=-s*u,t[8]=c,t[1]=n+r*c,t[5]=e-i*c,t[9]=-o*s,t[2]=i-e*c,t[6]=r+n*c,t[10]=a*s}else if(e.order===`YXZ`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e+i*o,t[4]=r*o-n,t[8]=a*c,t[1]=a*u,t[5]=a*l,t[9]=-o,t[2]=n*o-r,t[6]=i+e*o,t[10]=a*s}else if(e.order===`ZXY`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e-i*o,t[4]=-a*u,t[8]=r+n*o,t[1]=n+r*o,t[5]=a*l,t[9]=i-e*o,t[2]=-a*c,t[6]=o,t[10]=a*s}else if(e.order===`ZYX`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=r*c-n,t[8]=e*c+i,t[1]=s*u,t[5]=i*c+e,t[9]=n*c-r,t[2]=-c,t[6]=o*s,t[10]=a*s}else if(e.order===`YZX`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=i-e*u,t[8]=r*u+n,t[1]=u,t[5]=a*l,t[9]=-o*l,t[2]=-c*l,t[6]=n*u+r,t[10]=e-i*u}else if(e.order===`XZY`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=-u,t[8]=c*l,t[1]=e*u+i,t[5]=a*l,t[9]=n*u-r,t[2]=r*u-n,t[6]=o*l,t[10]=i*u+e}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(Ht,e,Ut)}lookAt(e,t,n){let r=this.elements;return Kt.subVectors(e,t),Kt.lengthSq()===0&&(Kt.z=1),Kt.normalize(),Wt.crossVectors(n,Kt),Wt.lengthSq()===0&&(Math.abs(n.z)===1?Kt.x+=1e-4:Kt.z+=1e-4,Kt.normalize(),Wt.crossVectors(n,Kt)),Wt.normalize(),Gt.crossVectors(Kt,Wt),r[0]=Wt.x,r[4]=Gt.x,r[8]=Kt.x,r[1]=Wt.y,r[5]=Gt.y,r[9]=Kt.y,r[2]=Wt.z,r[6]=Gt.z,r[10]=Kt.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[4],s=n[8],c=n[12],l=n[1],u=n[5],d=n[9],f=n[13],p=n[2],m=n[6],h=n[10],g=n[14],_=n[3],v=n[7],y=n[11],b=n[15],x=r[0],S=r[4],C=r[8],w=r[12],T=r[1],E=r[5],D=r[9],O=r[13],k=r[2],A=r[6],j=r[10],M=r[14],N=r[3],P=r[7],F=r[11],I=r[15];return i[0]=a*x+o*T+s*k+c*N,i[4]=a*S+o*E+s*A+c*P,i[8]=a*C+o*D+s*j+c*F,i[12]=a*w+o*O+s*M+c*I,i[1]=l*x+u*T+d*k+f*N,i[5]=l*S+u*E+d*A+f*P,i[9]=l*C+u*D+d*j+f*F,i[13]=l*w+u*O+d*M+f*I,i[2]=p*x+m*T+h*k+g*N,i[6]=p*S+m*E+h*A+g*P,i[10]=p*C+m*D+h*j+g*F,i[14]=p*w+m*O+h*M+g*I,i[3]=_*x+v*T+y*k+b*N,i[7]=_*S+v*E+y*A+b*P,i[11]=_*C+v*D+y*j+b*F,i[15]=_*w+v*O+y*M+b*I,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],r=e[8],i=e[12],a=e[1],o=e[5],s=e[9],c=e[13],l=e[2],u=e[6],d=e[10],f=e[14],p=e[3],m=e[7],h=e[11],g=e[15],_=s*f-c*d,v=o*f-c*u,y=o*d-s*u,b=a*f-c*l,x=a*d-s*l,S=a*u-o*l;return t*(m*_-h*v+g*y)-n*(p*_-h*b+g*x)+r*(p*v-m*b+g*S)-i*(p*y-m*x+h*S)}determinantAffine(){let e=this.elements,t=e[0],n=e[4],r=e[8],i=e[1],a=e[5],o=e[9],s=e[2],c=e[6],l=e[10];return t*(a*l-o*c)-n*(i*l-o*s)+r*(i*c-a*s)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=t,r[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=e[9],d=e[10],f=e[11],p=e[12],m=e[13],h=e[14],g=e[15],_=t*o-n*a,v=t*s-r*a,y=t*c-i*a,b=n*s-r*o,x=n*c-i*o,S=r*c-i*s,C=l*m-u*p,w=l*h-d*p,T=l*g-f*p,E=u*h-d*m,D=u*g-f*m,O=d*g-f*h,k=_*O-v*D+y*E+b*T-x*w+S*C;if(k===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let A=1/k;return e[0]=(o*O-s*D+c*E)*A,e[1]=(r*D-n*O-i*E)*A,e[2]=(m*S-h*x+g*b)*A,e[3]=(d*x-u*S-f*b)*A,e[4]=(s*T-a*O-c*w)*A,e[5]=(t*O-r*T+i*w)*A,e[6]=(h*y-p*S-g*v)*A,e[7]=(l*S-d*y+f*v)*A,e[8]=(a*D-o*T+c*C)*A,e[9]=(n*T-t*D-i*C)*A,e[10]=(p*x-m*y+g*_)*A,e[11]=(u*y-l*x-f*_)*A,e[12]=(o*w-a*E-s*C)*A,e[13]=(t*E-n*w+r*C)*A,e[14]=(m*v-p*b-h*_)*A,e[15]=(l*b-u*v+d*_)*A,this}scale(e){let t=this.elements,n=e.x,r=e.y,i=e.z;return t[0]*=n,t[4]*=r,t[8]*=i,t[1]*=n,t[5]*=r,t[9]*=i,t[2]*=n,t[6]*=r,t[10]*=i,t[3]*=n,t[7]*=r,t[11]*=i,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,r))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),r=Math.sin(t),i=1-n,a=e.x,o=e.y,s=e.z,c=i*a,l=i*o;return this.set(c*a+n,c*o-r*s,c*s+r*o,0,c*o+r*s,l*o+n,l*s-r*a,0,c*s-r*o,l*s+r*a,i*s*s+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,r,i,a){return this.set(1,n,i,0,e,1,a,0,t,r,1,0,0,0,0,1),this}compose(e,t,n){let r=this.elements,i=t._x,a=t._y,o=t._z,s=t._w,c=i+i,l=a+a,u=o+o,d=i*c,f=i*l,p=i*u,m=a*l,h=a*u,g=o*u,_=s*c,v=s*l,y=s*u,b=n.x,x=n.y,S=n.z;return r[0]=(1-(m+g))*b,r[1]=(f+y)*b,r[2]=(p-v)*b,r[3]=0,r[4]=(f-y)*x,r[5]=(1-(d+g))*x,r[6]=(h+_)*x,r[7]=0,r[8]=(p+v)*S,r[9]=(h-_)*S,r[10]=(1-(d+m))*S,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,t,n){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let i=this.determinantAffine();if(i===0)return n.set(1,1,1),t.identity(),this;let a=Bt.set(r[0],r[1],r[2]).length(),o=Bt.set(r[4],r[5],r[6]).length(),s=Bt.set(r[8],r[9],r[10]).length();i<0&&(a=-a),Vt.copy(this);let c=1/a,l=1/o,u=1/s;return Vt.elements[0]*=c,Vt.elements[1]*=c,Vt.elements[2]*=c,Vt.elements[4]*=l,Vt.elements[5]*=l,Vt.elements[6]*=l,Vt.elements[8]*=u,Vt.elements[9]*=u,Vt.elements[10]*=u,t.setFromRotationMatrix(Vt),n.x=a,n.y=o,n.z=s,this}makePerspective(e,t,n,r,i,a,o=Xe,s=!1){let c=this.elements,l=2*i/(t-e),u=2*i/(n-r),d=(t+e)/(t-e),f=(n+r)/(n-r),p,m;if(s)p=i/(a-i),m=a*i/(a-i);else if(o===2e3)p=-(a+i)/(a-i),m=-2*a*i/(a-i);else if(o===2001)p=-a/(a-i),m=-a*i/(a-i);else throw Error(`THREE.Matrix4.makePerspective(): Invalid coordinate system: `+o);return c[0]=l,c[4]=0,c[8]=d,c[12]=0,c[1]=0,c[5]=u,c[9]=f,c[13]=0,c[2]=0,c[6]=0,c[10]=p,c[14]=m,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,r,i,a,o=Xe,s=!1){let c=this.elements,l=2/(t-e),u=2/(n-r),d=-(t+e)/(t-e),f=-(n+r)/(n-r),p,m;if(s)p=1/(a-i),m=a/(a-i);else if(o===2e3)p=-2/(a-i),m=-(a+i)/(a-i);else if(o===2001)p=-1/(a-i),m=-i/(a-i);else throw Error(`THREE.Matrix4.makeOrthographic(): Invalid coordinate system: `+o);return c[0]=l,c[4]=0,c[8]=0,c[12]=d,c[1]=0,c[5]=u,c[9]=0,c[13]=f,c[2]=0,c[6]=0,c[10]=p,c[14]=m,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<16;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},Bt=new X,Vt=new zt,Ht=new X(0,0,0),Ut=new X(1,1,1),Wt=new X,Gt=new X,Kt=new X,qt=new zt,Jt=new gt,Yt=class e{constructor(t=0,n=0,r=0,i=e.DEFAULT_ORDER){this.isEuler=!0,this._x=t,this._y=n,this._z=r,this._order=i}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,r=this._order){return this._x=e,this._y=t,this._z=n,this._order=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){let r=e.elements,i=r[0],a=r[4],o=r[8],s=r[1],c=r[5],l=r[9],u=r[2],d=r[6],f=r[10];switch(t){case`XYZ`:this._y=Math.asin(J(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(-l,f),this._z=Math.atan2(-a,i)):(this._x=Math.atan2(d,c),this._z=0);break;case`YXZ`:this._x=Math.asin(-J(l,-1,1)),Math.abs(l)<.9999999?(this._y=Math.atan2(o,f),this._z=Math.atan2(s,c)):(this._y=Math.atan2(-u,i),this._z=0);break;case`ZXY`:this._x=Math.asin(J(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-u,f),this._z=Math.atan2(-a,c)):(this._y=0,this._z=Math.atan2(s,i));break;case`ZYX`:this._y=Math.asin(-J(u,-1,1)),Math.abs(u)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(s,i)):(this._x=0,this._z=Math.atan2(-a,c));break;case`YZX`:this._z=Math.asin(J(s,-1,1)),Math.abs(s)<.9999999?(this._x=Math.atan2(-l,c),this._y=Math.atan2(-u,i)):(this._x=0,this._y=Math.atan2(o,f));break;case`XZY`:this._z=Math.asin(-J(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(d,c),this._y=Math.atan2(o,i)):(this._x=Math.atan2(-l,f),this._y=0);break;default:K(`Euler: .setFromRotationMatrix() encountered an unknown order: `+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return qt.makeRotationFromQuaternion(e),this.setFromRotationMatrix(qt,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return Jt.setFromEuler(this),this.setFromQuaternion(Jt,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}};Yt.DEFAULT_ORDER=`XYZ`;var Xt=class{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return!!(this.mask&(1<<e|0))}},Zt=0,Qt=new X,$t=new gt,en=new zt,tn=new X,nn=new X,rn=new X,an=new gt,on=new X(1,0,0),sn=new X(0,1,0),cn=new X(0,0,1),ln={type:`added`},un={type:`removed`},dn={type:`childadded`,child:null},fn={type:`childremoved`,child:null},pn=class e extends st{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Zt++}),this.uuid=dt(),this.name=``,this.type=`Object3D`,this.parent=null,this.children=[],this.up=e.DEFAULT_UP.clone();let t=new X,n=new Yt,r=new gt,i=new X(1,1,1);function a(){r.setFromEuler(n,!1)}function o(){n.setFromQuaternion(r,void 0,!1)}n._onChange(a),r._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:t},rotation:{configurable:!0,enumerable:!0,value:n},quaternion:{configurable:!0,enumerable:!0,value:r},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new zt},normalMatrix:{value:new Z}}),this.matrix=new zt,this.matrixWorld=new zt,this.matrixAutoUpdate=e.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=e.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new Xt,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return $t.setFromAxisAngle(e,t),this.quaternion.multiply($t),this}rotateOnWorldAxis(e,t){return $t.setFromAxisAngle(e,t),this.quaternion.premultiply($t),this}rotateX(e){return this.rotateOnAxis(on,e)}rotateY(e){return this.rotateOnAxis(sn,e)}rotateZ(e){return this.rotateOnAxis(cn,e)}translateOnAxis(e,t){return Qt.copy(e).applyQuaternion(this.quaternion),this.position.add(Qt.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(on,e)}translateY(e){return this.translateOnAxis(sn,e)}translateZ(e){return this.translateOnAxis(cn,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(en.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?tn.copy(e):tn.set(e,t,n);let r=this.parent;this.updateWorldMatrix(!0,!1),nn.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?en.lookAt(nn,tn,this.up):en.lookAt(tn,nn,this.up),this.quaternion.setFromRotationMatrix(en),r&&(en.extractRotation(r.matrixWorld),$t.setFromRotationMatrix(en),this.quaternion.premultiply($t.invert()))}add(e){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.add(arguments[e]);return this}return e===this?(q(`Object3D.add: object can't be added as a child of itself.`,e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(ln),dn.child=e,this.dispatchEvent(dn),dn.child=null):q(`Object3D.add: object not an instance of THREE.Object3D.`,e),this)}remove(e){if(arguments.length>1){for(let e=0;e<arguments.length;e++)this.remove(arguments[e]);return this}let t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(un),fn.child=e,this.dispatchEvent(fn),fn.child=null),this}removeFromParent(){let e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),en.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),en.multiply(e.parent.matrixWorld)),e.applyMatrix4(en),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(ln),dn.child=e,this.dispatchEvent(dn),dn.child=null,this}getObjectById(e){return this.getObjectByProperty(`id`,e)}getObjectByName(e){return this.getObjectByProperty(`name`,e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,r=this.children.length;n<r;n++){let r=this.children[n].getObjectByProperty(e,t);if(r!==void 0)return r}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);let r=this.children;for(let i=0,a=r.length;i<a;i++)r[i].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(nn,e,rn),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(nn,an,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);let t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}intersectsFrustum(){}traverse(e){e(this);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].traverseVisible(e)}traverseAncestors(e){let t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let e=this.pivot;if(e!==null){let t=e.x,n=e.y,r=e.z,i=this.matrix.elements;i[12]+=t-i[0]*t-i[4]*n-i[8]*r,i[13]+=n-i[1]*t-i[5]*n-i[9]*r,i[14]+=r-i[2]*t-i[6]*n-i[10]*r}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);let t=this.children;for(let n=0,r=t.length;n<r;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t,n=!1){let r=this.parent;if(e===!0&&r!==null&&r.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||n)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,n=!0),t===!0){let e=this.children;for(let t=0,r=e.length;t<r;t++)e[t].updateWorldMatrix(!1,!0,n)}}toJSON(e){let t=e===void 0||typeof e==`string`,n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:`Object`,generator:`Object3D.toJSON`});let r={};r.uuid=this.uuid,r.type=this.type,r.name=this.name,r.castShadow=this.castShadow,r.receiveShadow=this.receiveShadow,r.visible=this.visible,r.frustumCulled=this.frustumCulled,r.renderOrder=this.renderOrder,r.static=this.static,r.matrixAutoUpdate=this.matrixAutoUpdate,Object.keys(this.userData).length>0&&(r.userData=this.userData),r.layers=this.layers.mask,r.matrix=this.matrix.toArray(),r.up=this.up.toArray(),this.pivot!==null&&(r.pivot=this.pivot.toArray()),this.morphTargetDictionary!==void 0&&(r.morphTargetDictionary=Object.assign({},this.morphTargetDictionary)),this.morphTargetInfluences!==void 0&&(r.morphTargetInfluences=this.morphTargetInfluences.slice()),this.isInstancedMesh&&(r.type=`InstancedMesh`,r.count=this.count,r.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(r.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(r.type=`BatchedMesh`,r.perObjectFrustumCulled=this.perObjectFrustumCulled,r.sortObjects=this.sortObjects,r.drawRanges=this._drawRanges,r.reservedRanges=this._reservedRanges,r.geometryInfo=this._geometryInfo.map(e=>({...e,boundingBox:e.boundingBox?e.boundingBox.toJSON():void 0,boundingSphere:e.boundingSphere?e.boundingSphere.toJSON():void 0})),r.instanceInfo=this._instanceInfo.map(e=>({...e})),r.availableInstanceIds=this._availableInstanceIds.slice(),r.availableGeometryIds=this._availableGeometryIds.slice(),r.nextIndexStart=this._nextIndexStart,r.nextVertexStart=this._nextVertexStart,r.geometryCount=this._geometryCount,r.maxInstanceCount=this._maxInstanceCount,r.maxVertexCount=this._maxVertexCount,r.maxIndexCount=this._maxIndexCount,r.geometryInitialized=this._geometryInitialized,r.matricesTexture=this._matricesTexture.toJSON(e),r.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(r.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(r.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(r.boundingBox=this.boundingBox.toJSON()));function i(t,n){return t[n.uuid]===void 0&&(t[n.uuid]=n.toJSON(e)),n.uuid}if(this.isScene)this.background&&(this.background.isColor?r.background=this.background.toJSON():this.background.isTexture&&(r.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(r.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){r.geometry=i(e.geometries,this.geometry);let t=this.geometry.parameters;if(t!==void 0&&t.shapes!==void 0){let n=t.shapes;if(Array.isArray(n))for(let t=0,r=n.length;t<r;t++){let r=n[t];i(e.shapes,r)}else i(e.shapes,n)}}if(this.isSkinnedMesh&&(r.bindMode=this.bindMode,r.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(i(e.skeletons,this.skeleton),r.skeleton=this.skeleton.uuid)),this.material!==void 0){if(Array.isArray(this.material)){let t=[];for(let n=0,r=this.material.length;n<r;n++)t.push(i(e.materials,this.material[n]));r.material=t}else r.material=i(e.materials,this.material)}if(this.children.length>0){r.children=[];for(let t=0;t<this.children.length;t++)r.children.push(this.children[t].toJSON(e).object)}if(this.animations.length>0){r.animations=[];for(let t=0;t<this.animations.length;t++){let n=this.animations[t];r.animations.push(i(e.animations,n))}}if(t){let t=a(e.geometries),r=a(e.materials),i=a(e.textures),o=a(e.images),s=a(e.shapes),c=a(e.skeletons),l=a(e.animations),u=a(e.nodes);t.length>0&&(n.geometries=t),r.length>0&&(n.materials=r),i.length>0&&(n.textures=i),o.length>0&&(n.images=o),s.length>0&&(n.shapes=s),c.length>0&&(n.skeletons=c),l.length>0&&(n.animations=l),u.length>0&&(n.nodes=u)}return n.object=r,n;function a(e){let t=[];for(let n in e){let r=e[n];delete r.metadata,t.push(r)}return t}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.pivot=e.pivot===null?null:e.pivot.clone(),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.static=e.static,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let t=0;t<e.children.length;t++){let n=e.children[t];this.add(n.clone())}return this}dispose(){this.dispatchEvent({type:`dispose`})}};pn.DEFAULT_UP=new X(0,1,0),pn.DEFAULT_MATRIX_AUTO_UPDATE=!0,pn.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;var mn=class extends pn{constructor(){super(),this.isGroup=!0,this.type=`Group`}},hn={type:`move`},gn=class{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new mn,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new mn,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new X,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new X),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new mn,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new X,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new X,this._grip.eventsEnabled=!1),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){let t=this._hand;if(t)for(let n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:`connected`,data:e}),this}disconnect(e){return this.dispatchEvent({type:`disconnected`,data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let r=null,i=null,a=null,o=this._targetRay,s=this._grip,c=this._hand;if(e&&t.session.visibilityState!==`visible-blurred`){if(c&&e.hand){a=!0;for(let r of e.hand.values()){let e=t.getJointPose(r,n),i=this._getHandJoint(c,r);e!==null&&(i.matrix.fromArray(e.transform.matrix),i.matrix.decompose(i.position,i.rotation,i.scale),i.matrixWorldNeedsUpdate=!0,i.jointRadius=e.radius),i.visible=e!==null}let r=c.joints[`index-finger-tip`],i=c.joints[`thumb-tip`],o=r.position.distanceTo(i.position);c.inputState.pinching&&o>.025?(c.inputState.pinching=!1,this.dispatchEvent({type:`pinchend`,handedness:e.handedness,target:this})):!c.inputState.pinching&&o<=.015&&(c.inputState.pinching=!0,this.dispatchEvent({type:`pinchstart`,handedness:e.handedness,target:this}))}else s!==null&&e.gripSpace&&(i=t.getPose(e.gripSpace,n),i!==null&&(s.matrix.fromArray(i.transform.matrix),s.matrix.decompose(s.position,s.rotation,s.scale),s.matrixWorldNeedsUpdate=!0,i.linearVelocity?(s.hasLinearVelocity=!0,s.linearVelocity.copy(i.linearVelocity)):s.hasLinearVelocity=!1,i.angularVelocity?(s.hasAngularVelocity=!0,s.angularVelocity.copy(i.angularVelocity)):s.hasAngularVelocity=!1,s.eventsEnabled&&s.dispatchEvent({type:`gripUpdated`,data:e,target:this})));o!==null&&(r=t.getPose(e.targetRaySpace,n),r===null&&i!==null&&(r=i),r!==null&&(o.matrix.fromArray(r.transform.matrix),o.matrix.decompose(o.position,o.rotation,o.scale),o.matrixWorldNeedsUpdate=!0,r.linearVelocity?(o.hasLinearVelocity=!0,o.linearVelocity.copy(r.linearVelocity)):o.hasLinearVelocity=!1,r.angularVelocity?(o.hasAngularVelocity=!0,o.angularVelocity.copy(r.angularVelocity)):o.hasAngularVelocity=!1,this.dispatchEvent(hn)))}return o!==null&&(o.visible=r!==null),s!==null&&(s.visible=i!==null),c!==null&&(c.visible=a!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){let n=new mn;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}},_n={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},vn={h:0,s:0,l:0},yn={h:0,s:0,l:0};function bn(e,t,n){return n<0&&(n+=1),n>1&&--n,n<1/6?e+(t-e)*6*n:n<1/2?t:n<2/3?e+(t-e)*6*(2/3-n):e}var Q=class{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){let t=e;t&&t.isColor?this.copy(t):typeof t==`number`?this.setHex(t):typeof t==`string`&&this.setStyle(t)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=Ue){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,Ct.colorSpaceToWorking(this,t),this}setRGB(e,t,n,r=Ct.workingColorSpace){return this.r=e,this.g=t,this.b=n,Ct.colorSpaceToWorking(this,r),this}setHSL(e,t,n,r=Ct.workingColorSpace){if(e=ft(e,1),t=J(t,0,1),n=J(n,0,1),t===0)this.r=this.g=this.b=n;else{let r=n<=.5?n*(1+t):n+t-n*t,i=2*n-r;this.r=bn(i,r,e+1/3),this.g=bn(i,r,e),this.b=bn(i,r,e-1/3)}return Ct.colorSpaceToWorking(this,r),this}setStyle(e,t=Ue){function n(t){t!==void 0&&parseFloat(t)<1&&K(`Color: Alpha component of `+e+` will be ignored.`)}let r;if(r=/^(\w+)\(([^\)]*)\)/.exec(e)){let i,a=r[1],o=r[2];switch(a){case`rgb`:case`rgba`:if(i=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setRGB(Math.min(255,parseInt(i[1],10))/255,Math.min(255,parseInt(i[2],10))/255,Math.min(255,parseInt(i[3],10))/255,t);if(i=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setRGB(Math.min(100,parseInt(i[1],10))/100,Math.min(100,parseInt(i[2],10))/100,Math.min(100,parseInt(i[3],10))/100,t);break;case`hsl`:case`hsla`:if(i=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(o))return n(i[4]),this.setHSL(parseFloat(i[1])/360,parseFloat(i[2])/100,parseFloat(i[3])/100,t);break;default:K(`Color: Unknown color model `+e)}}else if(r=/^\#([A-Fa-f\d]+)$/.exec(e)){let n=r[1],i=n.length;if(i===3)return this.setRGB(parseInt(n.charAt(0),16)/15,parseInt(n.charAt(1),16)/15,parseInt(n.charAt(2),16)/15,t);if(i===6)return this.setHex(parseInt(n,16),t);K(`Color: Invalid hex color `+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=Ue){let n=_n[e.toLowerCase()];return n===void 0?K(`Color: Unknown color `+e):this.setHex(n,t),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=wt(e.r),this.g=wt(e.g),this.b=wt(e.b),this}copyLinearToSRGB(e){return this.r=Tt(e.r),this.g=Tt(e.g),this.b=Tt(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=Ue){return Ct.workingToColorSpace(xn.copy(this),e),Math.round(J(xn.r*255,0,255))*65536+Math.round(J(xn.g*255,0,255))*256+Math.round(J(xn.b*255,0,255))}getHexString(e=Ue){return(`000000`+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=Ct.workingColorSpace){Ct.workingToColorSpace(xn.copy(this),t);let n=xn.r,r=xn.g,i=xn.b,a=Math.max(n,r,i),o=Math.min(n,r,i),s,c,l=(o+a)/2;if(o===a)s=0,c=0;else{let e=a-o;switch(c=l<=.5?e/(a+o):e/(2-a-o),a){case n:s=(r-i)/e+(r<i?6:0);break;case r:s=(i-n)/e+2;break;case i:s=(n-r)/e+4}s/=6}return e.h=s,e.s=c,e.l=l,e}getRGB(e,t=Ct.workingColorSpace){return Ct.workingToColorSpace(xn.copy(this),t),e.r=xn.r,e.g=xn.g,e.b=xn.b,e}getStyle(e=Ue){Ct.workingToColorSpace(xn.copy(this),e);let t=xn.r,n=xn.g,r=xn.b;return e===`srgb`?`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(r*255)})`:`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${r.toFixed(3)})`}offsetHSL(e,t,n){return this.getHSL(vn),this.setHSL(vn.h+e,vn.s+t,vn.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(vn),e.getHSL(yn);let n=pt(vn.h,yn.h,t),r=pt(vn.s,yn.s,t),i=pt(vn.l,yn.l,t);return this.setHSL(n,r,i),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){let t=this.r,n=this.g,r=this.b,i=e.elements;return this.r=i[0]*t+i[3]*n+i[6]*r,this.g=i[1]*t+i[4]*n+i[7]*r,this.b=i[2]*t+i[5]*n+i[8]*r,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}},xn=new Q;Q.NAMES=_n;var Sn=class extends pn{constructor(){super(),this.isScene=!0,this.type=`Scene`,this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Yt,this.environmentIntensity=1,this.environmentRotation=new Yt,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`observe`,{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){let t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),t.object.backgroundBlurriness=this.backgroundBlurriness,t.object.backgroundIntensity=this.backgroundIntensity,t.object.backgroundRotation=this.backgroundRotation.toArray(),t.object.environmentIntensity=this.environmentIntensity,t.object.environmentRotation=this.environmentRotation.toArray(),t}},Cn=new X,wn=new X,Tn=new X,En=new X,Dn=new X,On=new X,kn=new X,An=new X,jn=new X,Mn=new X,Nn=new Pt,Pn=new Pt,Fn=new Pt,In=class e{constructor(e=new X,t=new X,n=new X){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,r){r.subVectors(n,t),Cn.subVectors(e,t),r.cross(Cn);let i=r.lengthSq();return i>0?r.multiplyScalar(1/Math.sqrt(i)):r.set(0,0,0)}static getBarycoord(e,t,n,r,i){Cn.subVectors(r,t),wn.subVectors(n,t),Tn.subVectors(e,t);let a=Cn.dot(Cn),o=Cn.dot(wn),s=Cn.dot(Tn),c=wn.dot(wn),l=wn.dot(Tn),u=a*c-o*o;if(u===0)return i.set(0,0,0),null;let d=1/u,f=(c*s-o*l)*d,p=(a*l-o*s)*d;return i.set(1-f-p,p,f)}static containsPoint(e,t,n,r){return this.getBarycoord(e,t,n,r,En)!==null&&En.x>=0&&En.y>=0&&En.x+En.y<=1}static getInterpolation(e,t,n,r,i,a,o,s){return this.getBarycoord(e,t,n,r,En)===null?(s.x=0,s.y=0,`z`in s&&(s.z=0),`w`in s&&(s.w=0),null):(s.setScalar(0),s.addScaledVector(i,En.x),s.addScaledVector(a,En.y),s.addScaledVector(o,En.z),s)}static getInterpolatedAttribute(e,t,n,r,i,a){return Nn.setScalar(0),Pn.setScalar(0),Fn.setScalar(0),Nn.fromBufferAttribute(e,t),Pn.fromBufferAttribute(e,n),Fn.fromBufferAttribute(e,r),a.setScalar(0),a.addScaledVector(Nn,i.x),a.addScaledVector(Pn,i.y),a.addScaledVector(Fn,i.z),a}static isFrontFacing(e,t,n,r){return Cn.subVectors(n,t),wn.subVectors(e,t),Cn.cross(wn).dot(r)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,r){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[r]),this}setFromAttributeAndIndices(e,t,n,r){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,r),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Cn.subVectors(this.c,this.b),wn.subVectors(this.a,this.b),Cn.cross(wn).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(t){return e.getNormal(this.a,this.b,this.c,t)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(t,n){return e.getBarycoord(t,this.a,this.b,this.c,n)}getInterpolation(t,n,r,i,a){return e.getInterpolation(t,this.a,this.b,this.c,n,r,i,a)}containsPoint(t){return e.containsPoint(t,this.a,this.b,this.c)}isFrontFacing(t){return e.isFrontFacing(this.a,this.b,this.c,t)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){let n=this.a,r=this.b,i=this.c,a,o;Dn.subVectors(r,n),On.subVectors(i,n),An.subVectors(e,n);let s=Dn.dot(An),c=On.dot(An);if(s<=0&&c<=0)return t.copy(n);jn.subVectors(e,r);let l=Dn.dot(jn),u=On.dot(jn);if(l>=0&&u<=l)return t.copy(r);let d=s*u-l*c;if(d<=0&&s>=0&&l<=0)return a=s/(s-l),t.copy(n).addScaledVector(Dn,a);Mn.subVectors(e,i);let f=Dn.dot(Mn),p=On.dot(Mn);if(p>=0&&f<=p)return t.copy(i);let m=f*c-s*p;if(m<=0&&c>=0&&p<=0)return o=c/(c-p),t.copy(n).addScaledVector(On,o);let h=l*p-f*u;if(h<=0&&u-l>=0&&f-p>=0)return kn.subVectors(i,r),o=(u-l)/(u-l+(f-p)),t.copy(r).addScaledVector(kn,o);let g=1/(h+m+d);return a=m*g,o=d*g,t.copy(n).addScaledVector(Dn,a).addScaledVector(On,o)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}},Ln=class{constructor(e=new X(1/0,1/0,1/0),t=new X(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(zn.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(zn.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){let n=zn.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);let n=e.geometry;if(n!==void 0){let r=n.getAttribute(`position`);if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let t=0,n=r.count;t<n;t++)e.isMesh===!0?e.getVertexPosition(t,zn):zn.fromBufferAttribute(r,t),zn.applyMatrix4(e.matrixWorld),this.expandByPoint(zn);else e.boundingBox===void 0?(n.boundingBox===null&&n.computeBoundingBox(),Bn.copy(n.boundingBox)):(e.boundingBox===null&&e.computeBoundingBox(),Bn.copy(e.boundingBox)),Bn.applyMatrix4(e.matrixWorld),this.union(Bn)}let r=e.children;for(let e=0,n=r.length;e<n;e++)this.expandByObject(r[e],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,zn),zn.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(qn),Jn.subVectors(this.max,qn),Vn.subVectors(e.a,qn),Hn.subVectors(e.b,qn),Un.subVectors(e.c,qn),Wn.subVectors(Hn,Vn),Gn.subVectors(Un,Hn),Kn.subVectors(Vn,Un);let t=[0,-Wn.z,Wn.y,0,-Gn.z,Gn.y,0,-Kn.z,Kn.y,Wn.z,0,-Wn.x,Gn.z,0,-Gn.x,Kn.z,0,-Kn.x,-Wn.y,Wn.x,0,-Gn.y,Gn.x,0,-Kn.y,Kn.x,0];return!Zn(t,Vn,Hn,Un,Jn)||(t=[1,0,0,0,1,0,0,0,1],!Zn(t,Vn,Hn,Un,Jn))?!1:(Yn.crossVectors(Wn,Gn),t=[Yn.x,Yn.y,Yn.z],Zn(t,Vn,Hn,Un,Jn))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,zn).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(zn).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(Rn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),Rn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),Rn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),Rn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),Rn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),Rn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),Rn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),Rn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(Rn),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}},Rn=[new X,new X,new X,new X,new X,new X,new X,new X],zn=new X,Bn=new Ln,Vn=new X,Hn=new X,Un=new X,Wn=new X,Gn=new X,Kn=new X,qn=new X,Jn=new X,Yn=new X,Xn=new X;function Zn(e,t,n,r,i){for(let a=0,o=e.length-3;a<=o;a+=3){Xn.fromArray(e,a);let o=i.x*Math.abs(Xn.x)+i.y*Math.abs(Xn.y)+i.z*Math.abs(Xn.z),s=t.dot(Xn),c=n.dot(Xn),l=r.dot(Xn);if(Math.max(-Math.max(s,c,l),Math.min(s,c,l))>o)return!1}return!0}var Qn=new X,$n=new Y,er=0,tr=class extends st{constructor(e,t,n=!1){if(super(),Array.isArray(e))throw TypeError(`THREE.BufferAttribute: array should be a Typed Array.`);this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:er++}),this.name=``,this.array=e,this.itemSize=t,this.count=e===void 0?0:e.length/t,this.normalized=n,this.usage=Je,this.updateRanges=[],this.gpuType=O,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let r=0,i=this.itemSize;r<i;r++)this.array[e+r]=t.array[n+r];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)$n.fromBufferAttribute(this,t),$n.applyMatrix3(e),this.setXY(t,$n.x,$n.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)Qn.fromBufferAttribute(this,t),Qn.applyMatrix3(e),this.setXYZ(t,Qn.x,Qn.y,Qn.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)Qn.fromBufferAttribute(this,t),Qn.applyMatrix4(e),this.setXYZ(t,Qn.x,Qn.y,Qn.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Qn.fromBufferAttribute(this,t),Qn.applyNormalMatrix(e),this.setXYZ(t,Qn.x,Qn.y,Qn.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Qn.fromBufferAttribute(this,t),Qn.transformDirection(e),this.setXYZ(t,Qn.x,Qn.y,Qn.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=mt(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=ht(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=mt(t,this.array)),t}setX(e,t){return this.normalized&&(t=ht(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=mt(t,this.array)),t}setY(e,t){return this.normalized&&(t=ht(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=mt(t,this.array)),t}setZ(e,t){return this.normalized&&(t=ht(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=mt(t,this.array)),t}setW(e,t){return this.normalized&&(t=ht(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=ht(t,this.array),n=ht(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,r){return e*=this.itemSize,this.normalized&&(t=ht(t,this.array),n=ht(n,this.array),r=ht(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=r,this}setXYZW(e,t,n,r,i){return e*=this.itemSize,this.normalized&&(t=ht(t,this.array),n=ht(n,this.array),r=ht(r,this.array),i=ht(i,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=r,this.array[e+3]=i,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return e.name=this.name,e.usage=this.usage,e.gpuType=this.gpuType,e}dispose(){this.dispatchEvent({type:`dispose`})}},nr=class extends tr{constructor(e,t,n){super(new Uint16Array(e),t,n)}},rr=class extends tr{constructor(e,t,n){super(new Uint32Array(e),t,n)}},ir=class extends tr{constructor(e,t,n){super(new Float32Array(e),t,n)}},ar=new Ln,or=new X,sr=new X,cr=class{constructor(e=new X,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){let n=this.center;t===void 0?ar.setFromPoints(e).getCenter(n):n.copy(t);let r=0;for(let t=0,i=e.length;t<i;t++)r=Math.max(r,n.distanceToSquared(e[t]));return this.radius=Math.sqrt(r),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){let t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){let n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius*=e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;or.subVectors(e,this.center);let t=or.lengthSq();if(t>this.radius*this.radius){let e=Math.sqrt(t),n=(e-this.radius)*.5;this.center.addScaledVector(or,n/e),this.radius+=n}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(sr.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(or.copy(e.center).add(sr)),this.expandByPoint(or.copy(e.center).sub(sr))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}},lr=0,ur=new zt,dr=new pn,fr=new X,pr=new Ln,mr=new Ln,hr=new X,gr=class e extends st{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:lr++}),this.uuid=dt(),this.name=``,this.type=`BufferGeometry`,this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(e){return this.index=Array.isArray(e)?new(Ze(e)?rr:nr)(e,1):e,this}setIndirect(e,t=0){return this.indirect=e,this.indirectOffset=t,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){let t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);let n=this.attributes.normal;if(n!==void 0){let t=new Z().getNormalMatrix(e);n.applyNormalMatrix(t),n.needsUpdate=!0}let r=this.attributes.tangent;return r!==void 0&&(r.transformDirection(e),r.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this._transformed=!0,this}applyQuaternion(e){return ur.makeRotationFromQuaternion(e),this.applyMatrix4(ur),this}rotateX(e){return ur.makeRotationX(e),this.applyMatrix4(ur),this}rotateY(e){return ur.makeRotationY(e),this.applyMatrix4(ur),this}rotateZ(e){return ur.makeRotationZ(e),this.applyMatrix4(ur),this}translate(e,t,n){return ur.makeTranslation(e,t,n),this.applyMatrix4(ur),this}scale(e,t,n){return ur.makeScale(e,t,n),this.applyMatrix4(ur),this}lookAt(e){return dr.lookAt(e),dr.updateMatrix(),this.applyMatrix4(dr.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(fr).negate(),this.translate(fr.x,fr.y,fr.z),this}setFromPoints(e){let t=this.getAttribute(`position`);if(t===void 0){let t=[];for(let n=0,r=e.length;n<r;n++){let r=e[n];t.push(r.x,r.y,r.z||0)}this.setAttribute(`position`,new ir(t,3))}else{let n=Math.min(e.length,t.count);for(let r=0;r<n;r++){let n=e[r];t.setXYZ(r,n.x,n.y,n.z||0)}e.length>t.count&&K(`BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry.`),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Ln);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){q(`BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.`,this),this.boundingBox.set(new X(-1/0,-1/0,-1/0),new X(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let e=0,n=t.length;e<n;e++){let n=t[e];pr.setFromBufferAttribute(n),this.morphTargetsRelative?(hr.addVectors(this.boundingBox.min,pr.min),this.boundingBox.expandByPoint(hr),hr.addVectors(this.boundingBox.max,pr.max),this.boundingBox.expandByPoint(hr)):(this.boundingBox.expandByPoint(pr.min),this.boundingBox.expandByPoint(pr.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&q(`BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.`,this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new cr);let e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){q(`BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.`,this),this.boundingSphere.set(new X,1/0);return}if(e){let n=this.boundingSphere.center;if(pr.setFromBufferAttribute(e),t)for(let e=0,n=t.length;e<n;e++){let n=t[e];mr.setFromBufferAttribute(n),this.morphTargetsRelative?(hr.addVectors(pr.min,mr.min),pr.expandByPoint(hr),hr.addVectors(pr.max,mr.max),pr.expandByPoint(hr)):(pr.expandByPoint(mr.min),pr.expandByPoint(mr.max))}pr.getCenter(n);let r=0;for(let t=0,i=e.count;t<i;t++)hr.fromBufferAttribute(e,t),r=Math.max(r,n.distanceToSquared(hr));if(t)for(let i=0,a=t.length;i<a;i++){let a=t[i],o=this.morphTargetsRelative;for(let t=0,i=a.count;t<i;t++)hr.fromBufferAttribute(a,t),o&&(fr.fromBufferAttribute(e,t),hr.add(fr)),r=Math.max(r,n.distanceToSquared(hr))}this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&q(`BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.`,this)}}computeTangents(){let e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){q(`BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)`);return}let n=t.position,r=t.normal,i=t.uv,a=this.getAttribute(`tangent`);(a===void 0||a.count!==n.count)&&(a=new tr(new Float32Array(4*n.count),4),this.setAttribute(`tangent`,a));let o=[],s=[];for(let e=0;e<n.count;e++)o[e]=new X,s[e]=new X;let c=new X,l=new X,u=new X,d=new Y,f=new Y,p=new Y,m=new X,h=new X;function g(e,t,r){c.fromBufferAttribute(n,e),l.fromBufferAttribute(n,t),u.fromBufferAttribute(n,r),d.fromBufferAttribute(i,e),f.fromBufferAttribute(i,t),p.fromBufferAttribute(i,r),l.sub(c),u.sub(c),f.sub(d),p.sub(d);let a=1/(f.x*p.y-p.x*f.y);isFinite(a)&&(m.copy(l).multiplyScalar(p.y).addScaledVector(u,-f.y).multiplyScalar(a),h.copy(u).multiplyScalar(f.x).addScaledVector(l,-p.x).multiplyScalar(a),o[e].add(m),o[t].add(m),o[r].add(m),s[e].add(h),s[t].add(h),s[r].add(h))}let _=this.groups;_.length===0&&(_=[{start:0,count:e.count}]);for(let t=0,n=_.length;t<n;++t){let n=_[t],r=n.start,i=n.count;for(let t=r,n=r+i;t<n;t+=3)g(e.getX(t+0),e.getX(t+1),e.getX(t+2))}let v=new X,y=new X,b=new X,x=new X;function S(e){b.fromBufferAttribute(r,e),x.copy(b);let t=o[e];v.copy(t),v.sub(b.multiplyScalar(b.dot(t))).normalize(),y.crossVectors(x,t);let n=y.dot(s[e])<0?-1:1;a.setXYZW(e,v.x,v.y,v.z,n)}for(let t=0,n=_.length;t<n;++t){let n=_[t],r=n.start,i=n.count;for(let t=r,n=r+i;t<n;t+=3)S(e.getX(t+0)),S(e.getX(t+1)),S(e.getX(t+2))}this._transformed=!0}computeVertexNormals(){let e=this.index,t=this.getAttribute(`position`);if(t!==void 0){let n=this.getAttribute(`normal`);if(n===void 0||n.count!==t.count)n=new tr(new Float32Array(t.count*3),3),this.setAttribute(`normal`,n);else for(let e=0,t=n.count;e<t;e++)n.setXYZ(e,0,0,0);let r=new X,i=new X,a=new X,o=new X,s=new X,c=new X,l=new X,u=new X;if(e)for(let d=0,f=e.count;d<f;d+=3){let f=e.getX(d+0),p=e.getX(d+1),m=e.getX(d+2);r.fromBufferAttribute(t,f),i.fromBufferAttribute(t,p),a.fromBufferAttribute(t,m),l.subVectors(a,i),u.subVectors(r,i),l.cross(u),o.fromBufferAttribute(n,f),s.fromBufferAttribute(n,p),c.fromBufferAttribute(n,m),o.add(l),s.add(l),c.add(l),n.setXYZ(f,o.x,o.y,o.z),n.setXYZ(p,s.x,s.y,s.z),n.setXYZ(m,c.x,c.y,c.z)}else for(let e=0,o=t.count;e<o;e+=3)r.fromBufferAttribute(t,e+0),i.fromBufferAttribute(t,e+1),a.fromBufferAttribute(t,e+2),l.subVectors(a,i),u.subVectors(r,i),l.cross(u),n.setXYZ(e+0,l.x,l.y,l.z),n.setXYZ(e+1,l.x,l.y,l.z),n.setXYZ(e+2,l.x,l.y,l.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){let e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)hr.fromBufferAttribute(e,t),hr.normalize(),e.setXYZ(t,hr.x,hr.y,hr.z)}toNonIndexed(){function t(e,t){let n=e.array,r=e.itemSize,i=e.normalized,a=new n.constructor(t.length*r),o=0,s=0;for(let i=0,c=t.length;i<c;i++){o=e.isInterleavedBufferAttribute?t[i]*e.data.stride+e.offset:t[i]*r;for(let e=0;e<r;e++)a[s++]=n[o++]}return new tr(a,r,i)}if(this.index===null)return K(`BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed.`),this;let n=new e,r=this.index.array,i=this.attributes;for(let e in i){let a=i[e],o=t(a,r);n.setAttribute(e,o)}let a=this.morphAttributes;for(let e in a){let i=[],o=a[e];for(let e=0,n=o.length;e<n;e++){let n=o[e],a=t(n,r);i.push(a)}n.morphAttributes[e]=i}n.morphTargetsRelative=this.morphTargetsRelative;let o=this.groups;for(let e=0,t=o.length;e<t;e++){let t=o[e];n.addGroup(t.start,t.count,t.materialIndex)}return n}toJSON(){let e={metadata:{version:4.7,type:`BufferGeometry`,generator:`BufferGeometry.toJSON`}};if(e.uuid=this.uuid,e.type=this.parameters!==void 0&&this._transformed===!0?`BufferGeometry`:this.type,e.name=this.name,Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0&&this._transformed!==!0){let t=this.parameters;for(let n in t)t[n]!==void 0&&(e[n]=t[n]);return e}e.data={attributes:{}};let t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});let n=this.attributes;for(let t in n){let r=n[t];e.data.attributes[t]=r.toJSON(e.data)}let r={},i=!1;for(let t in this.morphAttributes){let n=this.morphAttributes[t],a=[];for(let t=0,r=n.length;t<r;t++){let r=n[t];a.push(r.toJSON(e.data))}a.length>0&&(r[t]=a,i=!0)}i&&(e.data.morphAttributes=r,e.data.morphTargetsRelative=this.morphTargetsRelative);let a=this.groups;a.length>0&&(e.data.groups=JSON.parse(JSON.stringify(a)));let o=this.boundingSphere;return o!==null&&(e.data.boundingSphere=o.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let t={};this.name=e.name;let n=e.index;n!==null&&this.setIndex(n.clone());let r=e.attributes;for(let e in r){let n=r[e];this.setAttribute(e,n.clone(t))}let i=e.morphAttributes;for(let e in i){let n=[],r=i[e];for(let e=0,i=r.length;e<i;e++)n.push(r[e].clone(t));this.morphAttributes[e]=n}this.morphTargetsRelative=e.morphTargetsRelative;let a=e.groups;for(let e=0,t=a.length;e<t;e++){let t=a[e];this.addGroup(t.start,t.count,t.materialIndex)}let o=e.boundingBox;o!==null&&(this.boundingBox=o.clone());let s=e.boundingSphere;return s!==null&&(this.boundingSphere=s.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this._transformed=e._transformed,this}dispose(){this.dispatchEvent({type:`dispose`})}},_r=class{constructor(e,t){this.isInterleavedBuffer=!0,this.array=e,this.stride=t,this.count=e===void 0?0:e.length/t,this.usage=Je,this.updateRanges=[],this.version=0,this.uuid=dt()}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.array=new e.array.constructor(e.array),this.count=e.count,this.stride=e.stride,this.usage=e.usage,this}copyAt(e,t,n){e*=this.stride,n*=t.stride;for(let r=0,i=this.stride;r<i;r++)this.array[e+r]=t.array[n+r];return this}set(e,t=0){return this.array.set(e,t),this}clone(e){e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=dt()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);let t=new this.array.constructor(e.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(t,this.stride);return n.setUsage(this.usage),n}onUpload(e){return this.onUploadCallback=e,this}toJSON(e){e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=dt()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer)));let t={uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride};return t.usage=this.usage,t}},vr=new X,yr=class e{constructor(e,t,n,r=!1){this.isInterleavedBufferAttribute=!0,this.name=``,this.data=e,this.itemSize=t,this.offset=n,this.normalized=r}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(e){this.data.needsUpdate=e}applyMatrix4(e){for(let t=0,n=this.data.count;t<n;t++)vr.fromBufferAttribute(this,t),vr.applyMatrix4(e),this.setXYZ(t,vr.x,vr.y,vr.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)vr.fromBufferAttribute(this,t),vr.applyNormalMatrix(e),this.setXYZ(t,vr.x,vr.y,vr.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)vr.fromBufferAttribute(this,t),vr.transformDirection(e),this.setXYZ(t,vr.x,vr.y,vr.z);return this}getComponent(e,t){let n=this.array[e*this.data.stride+this.offset+t];return this.normalized&&(n=mt(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=ht(n,this.array)),this.data.array[e*this.data.stride+this.offset+t]=n,this}setX(e,t){return this.normalized&&(t=ht(t,this.array)),this.data.array[e*this.data.stride+this.offset]=t,this}setY(e,t){return this.normalized&&(t=ht(t,this.array)),this.data.array[e*this.data.stride+this.offset+1]=t,this}setZ(e,t){return this.normalized&&(t=ht(t,this.array)),this.data.array[e*this.data.stride+this.offset+2]=t,this}setW(e,t){return this.normalized&&(t=ht(t,this.array)),this.data.array[e*this.data.stride+this.offset+3]=t,this}getX(e){let t=this.data.array[e*this.data.stride+this.offset];return this.normalized&&(t=mt(t,this.array)),t}getY(e){let t=this.data.array[e*this.data.stride+this.offset+1];return this.normalized&&(t=mt(t,this.array)),t}getZ(e){let t=this.data.array[e*this.data.stride+this.offset+2];return this.normalized&&(t=mt(t,this.array)),t}getW(e){let t=this.data.array[e*this.data.stride+this.offset+3];return this.normalized&&(t=mt(t,this.array)),t}setXY(e,t,n){return e=e*this.data.stride+this.offset,this.normalized&&(t=ht(t,this.array),n=ht(n,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this}setXYZ(e,t,n,r){return e=e*this.data.stride+this.offset,this.normalized&&(t=ht(t,this.array),n=ht(n,this.array),r=ht(r,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=r,this}setXYZW(e,t,n,r,i){return e=e*this.data.stride+this.offset,this.normalized&&(t=ht(t,this.array),n=ht(n,this.array),r=ht(r,this.array),i=ht(i,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=r,this.data.array[e+3]=i,this}clone(t){if(t===void 0){nt(`InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.`);let e=[];for(let t=0;t<this.count;t++){let n=t*this.data.stride+this.offset;for(let t=0;t<this.itemSize;t++)e.push(this.data.array[n+t])}return new tr(new this.array.constructor(e),this.itemSize,this.normalized)}return t.interleavedBuffers===void 0&&(t.interleavedBuffers={}),t.interleavedBuffers[this.data.uuid]===void 0&&(t.interleavedBuffers[this.data.uuid]=this.data.clone(t)),new e(t.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(e){if(e===void 0){nt(`InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.`);let e=[];for(let t=0;t<this.count;t++){let n=t*this.data.stride+this.offset;for(let t=0;t<this.itemSize;t++)e.push(this.data.array[n+t])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:e,normalized:this.normalized}}return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.toJSON(e)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}},br=new X,xr=new X,Sr=new Z,Cr=class{constructor(e=new X(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,r){return this.normal.set(e,t,n),this.constant=r,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let r=br.subVectors(n,t).cross(xr.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t,n=!0){let r=e.delta(br),i=this.normal.dot(r);if(i===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let a=-(e.start.dot(this.normal)+this.constant)/i;return n===!0&&(a<0||a>1)?null:t.copy(e.start).addScaledVector(r,a)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||Sr.getNormalMatrix(e),r=this.coplanarPoint(br).applyMatrix4(e),i=this.normal.applyMatrix3(n).normalize();return this.constant=-r.dot(i),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}toJSON(){return{normal:this.normal.toArray(),constant:this.constant}}fromJSON(e){return this.normal.fromArray(e.normal),this.constant=e.constant,this}},wr=0,Tr=class extends st{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:wr++}),this.uuid=dt(),this.name=``,this.type=`Material`,this.blending=1,this.side=0,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=204,this.blendDst=205,this.blendEquation=100,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new Q(0,0,0),this.blendAlpha=0,this.depthFunc=3,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=519,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=qe,this.stencilZFail=qe,this.stencilZPass=qe,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(let t in e){let n=e[t];if(n===void 0){K(`Material: parameter '${t}' has value of undefined.`);continue}let r=this[t];if(r===void 0){K(`Material: '${t}' is not a property of THREE.${this.type}.`);continue}r&&r.isColor?r.set(n):r&&r.isVector2&&n&&n.isVector2||r&&r.isEuler&&n&&n.isEuler||r&&r.isVector3&&n&&n.isVector3?r.copy(n):this[t]=n}}toJSON(e){let t=e===void 0||typeof e==`string`;t&&(e={textures:{},images:{}});let n={metadata:{version:4.7,type:`Material`,generator:`Material.toJSON`}};n.uuid=this.uuid,n.type=this.type,n.blending=this.blending,n.side=this.side,n.shadowSide=this.shadowSide,n.vertexColors=this.vertexColors,n.opacity=this.opacity,n.transparent=this.transparent,n.blendSrc=this.blendSrc,n.blendDst=this.blendDst,n.blendEquation=this.blendEquation,n.blendSrcAlpha=this.blendSrcAlpha,n.blendDstAlpha=this.blendDstAlpha,n.blendEquationAlpha=this.blendEquationAlpha,n.blendColor=this.blendColor.getHex(),n.blendAlpha=this.blendAlpha,n.depthFunc=this.depthFunc,n.depthTest=this.depthTest,n.depthWrite=this.depthWrite,n.colorWrite=this.colorWrite,n.clipIntersection=this.clipIntersection,n.clipShadows=this.clipShadows,n.stencilWriteMask=this.stencilWriteMask,n.stencilFunc=this.stencilFunc,n.stencilRef=this.stencilRef,n.stencilFuncMask=this.stencilFuncMask,n.stencilFail=this.stencilFail,n.stencilZFail=this.stencilZFail,n.stencilZPass=this.stencilZPass,n.stencilWrite=this.stencilWrite,n.polygonOffset=this.polygonOffset,n.polygonOffsetFactor=this.polygonOffsetFactor,n.polygonOffsetUnits=this.polygonOffsetUnits,n.dithering=this.dithering,n.alphaTest=this.alphaTest,n.alphaHash=this.alphaHash,n.alphaToCoverage=this.alphaToCoverage,n.premultipliedAlpha=this.premultipliedAlpha,n.forceSinglePass=this.forceSinglePass,n.allowOverride=this.allowOverride,n.visible=this.visible,n.toneMapped=this.toneMapped,n.name=this.name,this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.retroreflectivity!==void 0&&(n.retroreflectivity=this.retroreflectivity),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),Array.isArray(this.clippingPlanes)&&this.clippingPlanes.length>0&&(n.clippingPlanes=this.clippingPlanes.map(e=>e.toJSON())),this.rotation!==void 0&&(n.rotation=this.rotation),this.depthPacking!==void 0&&(n.depthPacking=this.depthPacking),this.linewidth!==void 0&&(n.linewidth=this.linewidth),this.linecap!==void 0&&(n.linecap=this.linecap),this.linejoin!==void 0&&(n.linejoin=this.linejoin),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.wireframe!==void 0&&(n.wireframe=this.wireframe),this.wireframeLinewidth!==void 0&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!==void 0&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!==void 0&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading!==void 0&&(n.flatShading=this.flatShading),this.fog!==void 0&&(n.fog=this.fog),Object.keys(this.userData).length>0&&(n.userData=this.userData);function r(e){let t=[];for(let n in e){let r=e[n];delete r.metadata,t.push(r)}return t}if(t){let t=r(e.textures),i=r(e.images);t.length>0&&(n.textures=t),i.length>0&&(n.images=i)}return n}fromJSON(e,t){if(e.uuid!==void 0&&(this.uuid=e.uuid),e.name!==void 0&&(this.name=e.name),e.color!==void 0&&this.color!==void 0&&this.color.setHex(e.color),e.roughness!==void 0&&(this.roughness=e.roughness),e.metalness!==void 0&&(this.metalness=e.metalness),e.sheen!==void 0&&(this.sheen=e.sheen),e.sheenColor!==void 0&&(this.sheenColor=new Q().setHex(e.sheenColor)),e.sheenRoughness!==void 0&&(this.sheenRoughness=e.sheenRoughness),e.emissive!==void 0&&this.emissive!==void 0&&this.emissive.setHex(e.emissive),e.specular!==void 0&&this.specular!==void 0&&this.specular.setHex(e.specular),e.specularIntensity!==void 0&&(this.specularIntensity=e.specularIntensity),e.specularColor!==void 0&&this.specularColor!==void 0&&this.specularColor.setHex(e.specularColor),e.shininess!==void 0&&(this.shininess=e.shininess),e.clearcoat!==void 0&&(this.clearcoat=e.clearcoat),e.clearcoatRoughness!==void 0&&(this.clearcoatRoughness=e.clearcoatRoughness),e.dispersion!==void 0&&(this.dispersion=e.dispersion),e.retroreflectivity!==void 0&&(this.retroreflectivity=e.retroreflectivity),e.iridescence!==void 0&&(this.iridescence=e.iridescence),e.iridescenceIOR!==void 0&&(this.iridescenceIOR=e.iridescenceIOR),e.iridescenceThicknessRange!==void 0&&(this.iridescenceThicknessRange=e.iridescenceThicknessRange),e.transmission!==void 0&&(this.transmission=e.transmission),e.thickness!==void 0&&(this.thickness=e.thickness),e.attenuationDistance!==void 0&&(this.attenuationDistance=e.attenuationDistance),e.attenuationColor!==void 0&&this.attenuationColor!==void 0&&this.attenuationColor.setHex(e.attenuationColor),e.anisotropy!==void 0&&(this.anisotropy=e.anisotropy),e.anisotropyRotation!==void 0&&(this.anisotropyRotation=e.anisotropyRotation),e.fog!==void 0&&(this.fog=e.fog),e.flatShading!==void 0&&(this.flatShading=e.flatShading),e.blending!==void 0&&(this.blending=e.blending),e.combine!==void 0&&(this.combine=e.combine),e.side!==void 0&&(this.side=e.side),e.shadowSide!==void 0&&(this.shadowSide=e.shadowSide),e.opacity!==void 0&&(this.opacity=e.opacity),e.transparent!==void 0&&(this.transparent=e.transparent),e.alphaTest!==void 0&&(this.alphaTest=e.alphaTest),e.alphaHash!==void 0&&(this.alphaHash=e.alphaHash),e.depthFunc!==void 0&&(this.depthFunc=e.depthFunc),e.depthTest!==void 0&&(this.depthTest=e.depthTest),e.depthWrite!==void 0&&(this.depthWrite=e.depthWrite),e.colorWrite!==void 0&&(this.colorWrite=e.colorWrite),e.clippingPlanes!==void 0&&(this.clippingPlanes=e.clippingPlanes.map(e=>new Cr().fromJSON(e))),e.clipIntersection!==void 0&&(this.clipIntersection=e.clipIntersection),e.clipShadows!==void 0&&(this.clipShadows=e.clipShadows),e.depthPacking!==void 0&&(this.depthPacking=e.depthPacking),e.blendSrc!==void 0&&(this.blendSrc=e.blendSrc),e.blendDst!==void 0&&(this.blendDst=e.blendDst),e.blendEquation!==void 0&&(this.blendEquation=e.blendEquation),e.blendSrcAlpha!==void 0&&(this.blendSrcAlpha=e.blendSrcAlpha),e.blendDstAlpha!==void 0&&(this.blendDstAlpha=e.blendDstAlpha),e.blendEquationAlpha!==void 0&&(this.blendEquationAlpha=e.blendEquationAlpha),e.blendColor!==void 0&&this.blendColor!==void 0&&this.blendColor.setHex(e.blendColor),e.blendAlpha!==void 0&&(this.blendAlpha=e.blendAlpha),e.stencilWriteMask!==void 0&&(this.stencilWriteMask=e.stencilWriteMask),e.stencilFunc!==void 0&&(this.stencilFunc=e.stencilFunc),e.stencilRef!==void 0&&(this.stencilRef=e.stencilRef),e.stencilFuncMask!==void 0&&(this.stencilFuncMask=e.stencilFuncMask),e.stencilFail!==void 0&&(this.stencilFail=e.stencilFail),e.stencilZFail!==void 0&&(this.stencilZFail=e.stencilZFail),e.stencilZPass!==void 0&&(this.stencilZPass=e.stencilZPass),e.stencilWrite!==void 0&&(this.stencilWrite=e.stencilWrite),e.wireframe!==void 0&&(this.wireframe=e.wireframe),e.wireframeLinewidth!==void 0&&(this.wireframeLinewidth=e.wireframeLinewidth),e.wireframeLinecap!==void 0&&(this.wireframeLinecap=e.wireframeLinecap),e.wireframeLinejoin!==void 0&&(this.wireframeLinejoin=e.wireframeLinejoin),e.rotation!==void 0&&(this.rotation=e.rotation),e.linewidth!==void 0&&(this.linewidth=e.linewidth),e.linecap!==void 0&&(this.linecap=e.linecap),e.linejoin!==void 0&&(this.linejoin=e.linejoin),e.dashSize!==void 0&&(this.dashSize=e.dashSize),e.gapSize!==void 0&&(this.gapSize=e.gapSize),e.scale!==void 0&&(this.scale=e.scale),e.polygonOffset!==void 0&&(this.polygonOffset=e.polygonOffset),e.polygonOffsetFactor!==void 0&&(this.polygonOffsetFactor=e.polygonOffsetFactor),e.polygonOffsetUnits!==void 0&&(this.polygonOffsetUnits=e.polygonOffsetUnits),e.dithering!==void 0&&(this.dithering=e.dithering),e.alphaToCoverage!==void 0&&(this.alphaToCoverage=e.alphaToCoverage),e.premultipliedAlpha!==void 0&&(this.premultipliedAlpha=e.premultipliedAlpha),e.forceSinglePass!==void 0&&(this.forceSinglePass=e.forceSinglePass),e.allowOverride!==void 0&&(this.allowOverride=e.allowOverride),e.visible!==void 0&&(this.visible=e.visible),e.toneMapped!==void 0&&(this.toneMapped=e.toneMapped),e.userData!==void 0&&(this.userData=e.userData),e.vertexColors!==void 0&&(this.vertexColors=typeof e.vertexColors==`number`?e.vertexColors>0:e.vertexColors),e.size!==void 0&&(this.size=e.size),e.sizeAttenuation!==void 0&&(this.sizeAttenuation=e.sizeAttenuation),e.map!==void 0&&(this.map=t[e.map]||null),e.matcap!==void 0&&(this.matcap=t[e.matcap]||null),e.alphaMap!==void 0&&(this.alphaMap=t[e.alphaMap]||null),e.bumpMap!==void 0&&(this.bumpMap=t[e.bumpMap]||null),e.bumpScale!==void 0&&(this.bumpScale=e.bumpScale),e.normalMap!==void 0&&(this.normalMap=t[e.normalMap]||null),e.normalMapType!==void 0&&(this.normalMapType=e.normalMapType),e.normalScale!==void 0){let t=e.normalScale;Array.isArray(t)===!1&&(t=[t,t]),this.normalScale=new Y().fromArray(t)}return e.displacementMap!==void 0&&(this.displacementMap=t[e.displacementMap]||null),e.displacementScale!==void 0&&(this.displacementScale=e.displacementScale),e.displacementBias!==void 0&&(this.displacementBias=e.displacementBias),e.roughnessMap!==void 0&&(this.roughnessMap=t[e.roughnessMap]||null),e.metalnessMap!==void 0&&(this.metalnessMap=t[e.metalnessMap]||null),e.emissiveMap!==void 0&&(this.emissiveMap=t[e.emissiveMap]||null),e.emissiveIntensity!==void 0&&(this.emissiveIntensity=e.emissiveIntensity),e.specularMap!==void 0&&(this.specularMap=t[e.specularMap]||null),e.specularIntensityMap!==void 0&&(this.specularIntensityMap=t[e.specularIntensityMap]||null),e.specularColorMap!==void 0&&(this.specularColorMap=t[e.specularColorMap]||null),e.envMap!==void 0&&(this.envMap=t[e.envMap]||null),e.envMapRotation!==void 0&&this.envMapRotation.fromArray(e.envMapRotation),e.envMapIntensity!==void 0&&(this.envMapIntensity=e.envMapIntensity),e.reflectivity!==void 0&&(this.reflectivity=e.reflectivity),e.refractionRatio!==void 0&&(this.refractionRatio=e.refractionRatio),e.lightMap!==void 0&&(this.lightMap=t[e.lightMap]||null),e.lightMapIntensity!==void 0&&(this.lightMapIntensity=e.lightMapIntensity),e.aoMap!==void 0&&(this.aoMap=t[e.aoMap]||null),e.aoMapIntensity!==void 0&&(this.aoMapIntensity=e.aoMapIntensity),e.gradientMap!==void 0&&(this.gradientMap=t[e.gradientMap]||null),e.clearcoatMap!==void 0&&(this.clearcoatMap=t[e.clearcoatMap]||null),e.clearcoatRoughnessMap!==void 0&&(this.clearcoatRoughnessMap=t[e.clearcoatRoughnessMap]||null),e.clearcoatNormalMap!==void 0&&(this.clearcoatNormalMap=t[e.clearcoatNormalMap]||null),e.clearcoatNormalScale!==void 0&&(this.clearcoatNormalScale=new Y().fromArray(e.clearcoatNormalScale)),e.iridescenceMap!==void 0&&(this.iridescenceMap=t[e.iridescenceMap]||null),e.iridescenceThicknessMap!==void 0&&(this.iridescenceThicknessMap=t[e.iridescenceThicknessMap]||null),e.transmissionMap!==void 0&&(this.transmissionMap=t[e.transmissionMap]||null),e.thicknessMap!==void 0&&(this.thicknessMap=t[e.thicknessMap]||null),e.anisotropyMap!==void 0&&(this.anisotropyMap=t[e.anisotropyMap]||null),e.sheenColorMap!==void 0&&(this.sheenColorMap=t[e.sheenColorMap]||null),e.sheenRoughnessMap!==void 0&&(this.sheenRoughnessMap=t[e.sheenRoughnessMap]||null),this}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;let t=e.clippingPlanes,n=null;if(t!==null){let e=t.length;n=Array(e);for(let r=0;r!==e;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.allowOverride=e.allowOverride,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:`dispose`})}set needsUpdate(e){e===!0&&this.version++}},Er=class extends Tr{constructor(e){super(),this.isSpriteMaterial=!0,this.type=`SpriteMaterial`,this.color=new Q(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.rotation=e.rotation,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}},Dr,Or=new X,kr=new X,Ar=new X,jr=new Y,Mr=new Y,Nr=new zt,Pr=new X,Fr=new X,Ir=new X,Lr=new Y,Rr=new Y,zr=new Y,Br=class extends pn{constructor(e=new Er){if(super(),this.isSprite=!0,this.type=`Sprite`,Dr===void 0){Dr=new gr;let e=new _r(new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),5);Dr.setIndex([0,1,2,0,2,3]),Dr.setAttribute(`position`,new yr(e,3,0,!1)),Dr.setAttribute(`uv`,new yr(e,2,3,!1))}this.geometry=Dr,this.material=e,this.center=new Y(.5,.5),this.count=1}intersectsFrustum(e){return e.intersectsSprite(this)}raycast(e,t){e.camera===null&&q(`Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.`),kr.setFromMatrixScale(this.matrixWorld),Nr.copy(e.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(e.camera.matrixWorldInverse,this.matrixWorld),Ar.setFromMatrixPosition(this.modelViewMatrix),e.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&kr.multiplyScalar(-Ar.z);let n=this.material.rotation,r,i;n!==0&&(i=Math.cos(n),r=Math.sin(n));let a=this.center;Vr(Pr.set(-.5,-.5,0),Ar,a,kr,r,i),Vr(Fr.set(.5,-.5,0),Ar,a,kr,r,i),Vr(Ir.set(.5,.5,0),Ar,a,kr,r,i),Lr.set(0,0),Rr.set(1,0),zr.set(1,1);let o=e.ray.intersectTriangle(Pr,Fr,Ir,!1,Or);if(o===null&&(Vr(Fr.set(-.5,.5,0),Ar,a,kr,r,i),Rr.set(0,1),o=e.ray.intersectTriangle(Pr,Ir,Fr,!1,Or),o===null))return;let s=e.ray.origin.distanceTo(Or);s<e.near||s>e.far||t.push({distance:s,point:Or.clone(),uv:In.getInterpolation(Or,Pr,Fr,Ir,Lr,Rr,zr,new Y),face:null,object:this})}copy(e,t){return super.copy(e,t),e.center!==void 0&&this.center.copy(e.center),this.material=e.material,this}};function Vr(e,t,n,r,i,a){jr.subVectors(e,n).addScalar(.5).multiply(r),i===void 0?Mr.copy(jr):(Mr.x=a*jr.x-i*jr.y,Mr.y=i*jr.x+a*jr.y),e.copy(t),e.x+=Mr.x,e.y+=Mr.y,e.applyMatrix4(Nr)}var Hr=new X,Ur=new X,Wr=new X,Gr=new X,Kr=class{constructor(e=new X,t=new X(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,Hr)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);let n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){let t=Hr.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(Hr.copy(this.origin).addScaledVector(this.direction,t),Hr.distanceToSquared(e))}distanceSqToSegment(e,t,n,r){Ur.copy(e).add(t).multiplyScalar(.5),Wr.copy(t).sub(e).normalize(),Gr.copy(this.origin).sub(Ur);let i=e.distanceTo(t)*.5,a=-this.direction.dot(Wr),o=Gr.dot(this.direction),s=-Gr.dot(Wr),c=Gr.lengthSq(),l=Math.abs(1-a*a),u,d,f,p;if(l>0){if(u=a*s-o,d=a*o-s,p=i*l,u>=0){if(d>=-p){if(d<=p){let e=1/l;u*=e,d*=e,f=u*(u+a*d+2*o)+d*(a*u+d+2*s)+c}else d=i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c}else d=-i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c}else d<=-p?(u=Math.max(0,-(-a*i+o)),d=u>0?-i:Math.min(Math.max(-i,-s),i),f=-u*u+d*(d+2*s)+c):d<=p?(u=0,d=Math.min(Math.max(-i,-s),i),f=d*(d+2*s)+c):(u=Math.max(0,-(a*i+o)),d=u>0?i:Math.min(Math.max(-i,-s),i),f=-u*u+d*(d+2*s)+c)}else d=a>0?-i:i,u=Math.max(0,-(a*d+o)),f=-u*u+d*(d+2*s)+c;return n&&n.copy(this.origin).addScaledVector(this.direction,u),r&&r.copy(Ur).addScaledVector(Wr,d),f}intersectSphere(e,t){if(e.radius<0)return null;Hr.subVectors(e.center,this.origin);let n=Hr.dot(this.direction),r=Hr.dot(Hr)-n*n,i=e.radius*e.radius;if(r>i)return null;let a=Math.sqrt(i-r),o=n-a,s=n+a;return s<0?null:o<0?this.at(s,t):this.at(o,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){let t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;let n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){let n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){let t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,r,i,a,o,s,c=1/this.direction.x,l=1/this.direction.y,u=1/this.direction.z,d=this.origin;return c>=0?(n=(e.min.x-d.x)*c,r=(e.max.x-d.x)*c):(n=(e.max.x-d.x)*c,r=(e.min.x-d.x)*c),l>=0?(i=(e.min.y-d.y)*l,a=(e.max.y-d.y)*l):(i=(e.max.y-d.y)*l,a=(e.min.y-d.y)*l),n>a||i>r||((i>n||isNaN(n))&&(n=i),(a<r||isNaN(r))&&(r=a),u>=0?(o=(e.min.z-d.z)*u,s=(e.max.z-d.z)*u):(o=(e.max.z-d.z)*u,s=(e.min.z-d.z)*u),n>s||o>r)||((o>n||n!==n)&&(n=o),(s<r||r!==r)&&(r=s),r<0)?null:this.at(n>=0?n:r,t)}intersectsBox(e){return this.intersectBox(e,Hr)!==null}intersectTriangle(e,t,n,r,i){let a=this.origin,o=this.direction,s=o.x,c=o.y,l=o.z,u=e.x-a.x,d=e.y-a.y,f=e.z-a.z,p=t.x-a.x,m=t.y-a.y,h=t.z-a.z,g=n.x-a.x,_=n.y-a.y,v=n.z-a.z,y=Math.abs(s),b=Math.abs(c),x=Math.abs(l),S,C,w,T,E,D,O,k,A,j,M,N;if(y>=b&&y>=x?(w=s,D=u,A=p,N=g,s>=0?(S=c,C=l,T=d,E=f,O=m,k=h,j=_,M=v):(S=l,C=c,T=f,E=d,O=h,k=m,j=v,M=_)):b>=x?(w=c,D=d,A=m,N=_,c>=0?(S=l,C=s,T=f,E=u,O=h,k=p,j=v,M=g):(S=s,C=l,T=u,E=f,O=p,k=h,j=g,M=v)):(w=l,D=f,A=h,N=v,l>=0?(S=s,C=c,T=u,E=d,O=p,k=m,j=g,M=_):(S=c,C=s,T=d,E=u,O=m,k=p,j=_,M=g)),w===0)return null;let P=S/w,F=C/w,I=1/w,L=T-P*D,ee=E-F*D,te=O-P*A,ne=k-F*A,re=j-P*N,R=M-F*N,ie=re*ne-R*te,z=L*R-ee*re,B=te*ee-ne*L;if(r){if(ie<0||z<0||B<0)return null}else if((ie<0||z<0||B<0)&&(ie>0||z>0||B>0))return null;let ae=ie+z+B;if(ae===0)return null;let oe=I*(ie*D+z*A+B*N);return(ae>0?oe<0:oe>0)?null:this.at(oe/ae,i)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}},qr=class extends Tr{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type=`MeshBasicMaterial`,this.color=new Q(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Yt,this.combine=0,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap=`round`,this.wireframeLinejoin=`round`,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}},Jr=new zt,Yr=new Kr,Xr=new cr,Zr=new X,Qr=new X,$r=new X,ei=new X,ti=new X,ni=new X,ri=new X,ii=new X,ai=class extends pn{constructor(e=new gr,t=new qr){super(),this.isMesh=!0,this.type=`Mesh`,this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){let e=this.geometry.morphAttributes,t=Object.keys(e);if(t.length>0){let n=e[t[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let e=0,t=n.length;e<t;e++){let t=n[e].name||String(e);this.morphTargetInfluences.push(0),this.morphTargetDictionary[t]=e}}}}getVertexPosition(e,t){let n=this.geometry,r=n.attributes.position,i=n.morphAttributes.position,a=n.morphTargetsRelative;t.fromBufferAttribute(r,e);let o=this.morphTargetInfluences;if(i&&o){ni.set(0,0,0);for(let n=0,r=i.length;n<r;n++){let r=o[n],s=i[n];r!==0&&(ti.fromBufferAttribute(s,e),a?ni.addScaledVector(ti,r):ni.addScaledVector(ti.sub(t),r))}t.add(ni)}return t}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,r=this.material,i=this.matrixWorld;r!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),Xr.copy(n.boundingSphere),Xr.applyMatrix4(i),Yr.copy(e.ray).recast(e.near),!(Xr.containsPoint(Yr.origin)===!1&&(Yr.intersectSphere(Xr,Zr)===null||Yr.origin.distanceToSquared(Zr)>(e.far-e.near)**2))&&(Jr.copy(i).invert(),Yr.copy(e.ray).applyMatrix4(Jr),(n.boundingBox===null||Yr.intersectsBox(n.boundingBox)!==!1)&&this._computeIntersections(e,t,Yr)))}_computeIntersections(e,t,n){let r,i=this.geometry,a=this.material,o=i.index,s=i.attributes.position,c=i.attributes.uv,l=i.attributes.uv1,u=i.attributes.normal,d=i.groups,f=i.drawRange;if(o!==null){if(Array.isArray(a))for(let i=0,s=d.length;i<s;i++){let s=d[i],p=a[s.materialIndex],m=Math.max(s.start,f.start),h=Math.min(o.count,Math.min(s.start+s.count,f.start+f.count));for(let i=m,a=h;i<a;i+=3){let a=o.getX(i),d=o.getX(i+1),f=o.getX(i+2);r=si(this,p,e,n,c,l,u,a,d,f),r&&(r.faceIndex=Math.floor(i/3),r.face.materialIndex=s.materialIndex,t.push(r))}}else{let i=Math.max(0,f.start),s=Math.min(o.count,f.start+f.count);for(let d=i,f=s;d<f;d+=3){let i=o.getX(d),s=o.getX(d+1),f=o.getX(d+2);r=si(this,a,e,n,c,l,u,i,s,f),r&&(r.faceIndex=Math.floor(d/3),t.push(r))}}}else if(s!==void 0){if(Array.isArray(a))for(let i=0,o=d.length;i<o;i++){let o=d[i],p=a[o.materialIndex],m=Math.max(o.start,f.start),h=Math.min(s.count,Math.min(o.start+o.count,f.start+f.count));for(let i=m,a=h;i<a;i+=3){let a=i,s=i+1,d=i+2;r=si(this,p,e,n,c,l,u,a,s,d),r&&(r.faceIndex=Math.floor(i/3),r.face.materialIndex=o.materialIndex,t.push(r))}}else{let i=Math.max(0,f.start),o=Math.min(s.count,f.start+f.count);for(let s=i,d=o;s<d;s+=3){let i=s,o=s+1,d=s+2;r=si(this,a,e,n,c,l,u,i,o,d),r&&(r.faceIndex=Math.floor(s/3),t.push(r))}}}}};function oi(e,t,n,r,i,a,o,s){let c;if(c=t.side===1?r.intersectTriangle(o,a,i,!0,s):r.intersectTriangle(i,a,o,t.side===0,s),c===null)return null;ii.copy(s),ii.applyMatrix4(e.matrixWorld);let l=n.ray.origin.distanceTo(ii);return l<n.near||l>n.far?null:{distance:l,point:ii.clone(),object:e}}function si(e,t,n,r,i,a,o,s,c,l){e.getVertexPosition(s,Qr),e.getVertexPosition(c,$r),e.getVertexPosition(l,ei);let u=oi(e,t,n,r,Qr,$r,ei,ri);if(u){let e=new X;In.getBarycoord(ri,Qr,$r,ei,e),i&&(u.uv=In.getInterpolatedAttribute(i,s,c,l,e,new Y)),a&&(u.uv1=In.getInterpolatedAttribute(a,s,c,l,e,new Y)),o&&(u.normal=In.getInterpolatedAttribute(o,s,c,l,e,new X),u.normal.dot(r.direction)>0&&u.normal.multiplyScalar(-1));let t={a:s,b:c,c:l,normal:new X,materialIndex:0};In.getNormal(Qr,$r,ei,t.normal),u.face=t,u.barycoord=e}return u}var ci=class extends Nt{constructor(e=null,t=1,n=1,r,i,a,o,s,c=g,l=g,u,d){super(null,a,o,s,c,l,r,i,u,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}},li=class extends tr{constructor(e,t,n,r=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=r}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){let e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}},ui=new cr,di=new Y(.5,.5),fi=new X,pi=class{constructor(e=new Cr,t=new Cr,n=new Cr,r=new Cr,i=new Cr,a=new Cr){this.planes=[e,t,n,r,i,a]}set(e,t,n,r,i,a){let o=this.planes;return o[0].copy(e),o[1].copy(t),o[2].copy(n),o[3].copy(r),o[4].copy(i),o[5].copy(a),this}copy(e){let t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=Xe,n=!1){let r=this.planes,i=e.elements,a=i[0],o=i[1],s=i[2],c=i[3],l=i[4],u=i[5],d=i[6],f=i[7],p=i[8],m=i[9],h=i[10],g=i[11],_=i[12],v=i[13],y=i[14],b=i[15];if(r[0].setComponents(c-a,f-l,g-p,b-_).normalize(),r[1].setComponents(c+a,f+l,g+p,b+_).normalize(),r[2].setComponents(c+o,f+u,g+m,b+v).normalize(),r[3].setComponents(c-o,f-u,g-m,b-v).normalize(),n)r[4].setComponents(s,d,h,y).normalize(),r[5].setComponents(c-s,f-d,g-h,b-y).normalize();else if(r[4].setComponents(c-s,f-d,g-h,b-y).normalize(),t===2e3)r[5].setComponents(c+s,f+d,g+h,b+y).normalize();else if(t===2001)r[5].setComponents(s,d,h,y).normalize();else throw Error(`THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: `+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),ui.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{let t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),ui.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(ui)}intersectsSprite(e){return ui.center.set(0,0,0),ui.radius=.7071067811865476+di.distanceTo(e.center),ui.applyMatrix4(e.matrixWorld),this.intersectsSphere(ui)}intersectsSphere(e){let t=this.planes,n=e.center,r=-e.radius;for(let e=0;e<6;e++)if(t[e].distanceToPoint(n)<r)return!1;return!0}intersectsBox(e){let t=this.planes;for(let n=0;n<6;n++){let r=t[n];if(fi.x=r.normal.x>0?e.max.x:e.min.x,fi.y=r.normal.y>0?e.max.y:e.min.y,fi.z=r.normal.z>0?e.max.z:e.min.z,r.distanceToPoint(fi)<0)return!1}return!0}containsPoint(e){let t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}},mi=class extends Tr{constructor(e){super(),this.isLineBasicMaterial=!0,this.type=`LineBasicMaterial`,this.color=new Q(16777215),this.map=null,this.linewidth=1,this.linecap=`round`,this.linejoin=`round`,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}},hi=new X,gi=new X,_i=new zt,vi=new Kr,yi=new cr,bi=new X,xi=new X,Si=class extends pn{constructor(e=new gr,t=new mi){super(),this.isLine=!0,this.type=`Line`,this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[0];for(let e=1,r=t.count;e<r;e++)hi.fromBufferAttribute(t,e-1),gi.fromBufferAttribute(t,e),n[e]=n[e-1],n[e]+=hi.distanceTo(gi);e.setAttribute(`lineDistance`,new ir(n,1))}else K(`Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.`);return this}intersectsFrustum(e){return e.intersectsObject(this)}raycast(e,t){let n=this.geometry,r=this.matrixWorld,i=e.params.Line.threshold,a=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),yi.copy(n.boundingSphere),yi.applyMatrix4(r),yi.radius+=i,e.ray.intersectsSphere(yi)===!1)return;_i.copy(r).invert(),vi.copy(e.ray).applyMatrix4(_i);let o=i/((this.scale.x+this.scale.y+this.scale.z)/3),s=o*o,c=this.isLineSegments?2:1,l=n.index,u=n.attributes.position;if(l!==null){let n=Math.max(0,a.start),r=Math.min(l.count,a.start+a.count);for(let i=n,a=r-1;i<a;i+=c){let n=l.getX(i),r=l.getX(i+1),a=Ci(this,e,vi,s,n,r,i);a&&t.push(a)}if(this.isLineLoop){let i=l.getX(r-1),a=l.getX(n),o=Ci(this,e,vi,s,i,a,r-1);o&&t.push(o)}}else{let n=Math.max(0,a.start),r=Math.min(u.count,a.start+a.count);for(let i=n,a=r-1;i<a;i+=c){let n=Ci(this,e,vi,s,i,i+1,i);n&&t.push(n)}if(this.isLineLoop){let i=Ci(this,e,vi,s,r-1,n,r-1);i&&t.push(i)}}}updateMorphTargets(){let e=this.geometry.morphAttributes,t=Object.keys(e);if(t.length>0){let n=e[t[0]];if(n!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let e=0,t=n.length;e<t;e++){let t=n[e].name||String(e);this.morphTargetInfluences.push(0),this.morphTargetDictionary[t]=e}}}}};function Ci(e,t,n,r,i,a,o){let s=e.geometry.attributes.position;if(hi.fromBufferAttribute(s,i),gi.fromBufferAttribute(s,a),n.distanceSqToSegment(hi,gi,bi,xi)>r)return;bi.applyMatrix4(e.matrixWorld);let c=t.ray.origin.distanceTo(bi);if(!(c<t.near||c>t.far))return{distance:c,point:xi.clone().applyMatrix4(e.matrixWorld),index:o,face:null,faceIndex:null,barycoord:null,object:e}}var wi=new X,Ti=new X,Ei=class extends Si{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type=`LineSegments`}computeLineDistances(){let e=this.geometry;if(e.index===null){let t=e.attributes.position,n=[];for(let e=0,r=t.count;e<r;e+=2)wi.fromBufferAttribute(t,e),Ti.fromBufferAttribute(t,e+1),n[e]=e===0?0:n[e-1],n[e+1]=n[e]+wi.distanceTo(Ti);e.setAttribute(`lineDistance`,new ir(n,1))}else K(`LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.`);return this}},Di=class extends Nt{constructor(e,t){super({width:e,height:t}),this.isFramebufferTexture=!0,this.magFilter=g,this.minFilter=g,this.generateMipmaps=!1,this.needsUpdate=!0}},Oi=class extends Nt{constructor(e=[],t=301,n,r,i,a,o,s,c,l){super(e,t,n,r,i,a,o,s,c,l),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}},ki=class extends Nt{constructor(e,t,n,r,i,a,o,s,c){super(e,t,n,r,i,a,o,s,c),this.isCanvasTexture=!0,this.needsUpdate=!0}},Ai=class extends Nt{constructor(e,t,n=D,r,i,a,o=g,s=g,c,l=ee,u=1){if(l!==1026&&l!==1027)throw Error(`THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat`);super({width:e,height:t,depth:u},r,i,a,o,s,l,n,c),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new kt(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){let t=super.toJSON(e);return t.compareFunction=this.compareFunction,t}},ji=class extends Ai{constructor(e,t=D,n=301,r,i,a=g,o=g,s,c=ee){let l={width:e,height:e,depth:1},u=[l,l,l,l,l,l];super(e,e,t,n,r,i,a,o,s,c),this.image=u,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(e){this.image=e}},Mi=class extends Nt{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}},Ni=class e extends gr{constructor(e=1,t=1,n=1,r=1,i=1,a=1){super(),this.type=`BoxGeometry`,this.parameters={width:e,height:t,depth:n,widthSegments:r,heightSegments:i,depthSegments:a};let o=this;r=Math.floor(r),i=Math.floor(i),a=Math.floor(a);let s=[],c=[],l=[],u=[],d=0,f=0;p(`z`,`y`,`x`,-1,-1,n,t,e,a,i,0),p(`z`,`y`,`x`,1,-1,n,t,-e,a,i,1),p(`x`,`z`,`y`,1,1,e,n,t,r,a,2),p(`x`,`z`,`y`,1,-1,e,n,-t,r,a,3),p(`x`,`y`,`z`,1,-1,e,t,n,r,i,4),p(`x`,`y`,`z`,-1,-1,e,t,-n,r,i,5),this.setIndex(s),this.setAttribute(`position`,new ir(c,3)),this.setAttribute(`normal`,new ir(l,3)),this.setAttribute(`uv`,new ir(u,2));function p(e,t,n,r,i,a,p,m,h,g,_){let v=a/h,y=p/g,b=a/2,x=p/2,S=m/2,C=h+1,w=g+1,T=0,E=0,D=new X;for(let a=0;a<w;a++){let o=a*y-x;for(let s=0;s<C;s++)D[e]=(s*v-b)*r,D[t]=o*i,D[n]=S,c.push(D.x,D.y,D.z),D[e]=0,D[t]=0,D[n]=m>0?1:-1,l.push(D.x,D.y,D.z),u.push(s/h),u.push(1-a/g),T+=1}for(let e=0;e<g;e++)for(let t=0;t<h;t++){let n=d+t+C*e,r=d+t+C*(e+1),i=d+(t+1)+C*(e+1),a=d+(t+1)+C*e;s.push(n,r,a),s.push(r,i,a),E+=6}o.addGroup(f,E,_),f+=E,d+=T}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.width,t.height,t.depth,t.widthSegments,t.heightSegments,t.depthSegments)}},Pi=class e extends gr{constructor(e=1,t=1,n=1,r=32,i=1,a=!1,o=0,s=Math.PI*2){super(),this.type=`CylinderGeometry`,this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:r,heightSegments:i,openEnded:a,thetaStart:o,thetaLength:s};let c=this;r=Math.floor(r),i=Math.floor(i);let l=[],u=[],d=[],f=[],p=0,m=[],h=n/2,g=0;_(),a===!1&&(e>0&&v(!0),t>0&&v(!1)),this.setIndex(l),this.setAttribute(`position`,new ir(u,3)),this.setAttribute(`normal`,new ir(d,3)),this.setAttribute(`uv`,new ir(f,2));function _(){let a=new X,_=new X,v=0,y=(t-e)/n;for(let c=0;c<=i;c++){let l=[],g=c/i,v=g*(t-e)+e;for(let e=0;e<=r;e++){let t=e/r,i=t*s+o,c=Math.sin(i),m=Math.cos(i);_.x=v*c,_.y=-g*n+h,_.z=v*m,u.push(_.x,_.y,_.z),a.set(c,y,m).normalize(),d.push(a.x,a.y,a.z),f.push(t,1-g),l.push(p++)}m.push(l)}for(let n=0;n<r;n++)for(let r=0;r<i;r++){let a=m[r][n],o=m[r+1][n],s=m[r+1][n+1],c=m[r][n+1];(e>0||r!==0)&&(l.push(a,o,c),v+=3),(t>0||r!==i-1)&&(l.push(o,s,c),v+=3)}c.addGroup(g,v,0),g+=v}function v(n){let i=p,a=new Y,m=new X,_=0,v=n===!0?e:t,y=n===!0?1:-1;for(let e=1;e<=r;e++)u.push(0,h*y,0),d.push(0,y,0),f.push(.5,.5),p++;let b=p;for(let e=0;e<=r;e++){let t=e/r*s+o,n=Math.cos(t),i=Math.sin(t);m.x=v*i,m.y=h*y,m.z=v*n,u.push(m.x,m.y,m.z),d.push(0,y,0),a.x=n*.5+.5,a.y=i*.5*y+.5,f.push(a.x,a.y),p++}for(let e=0;e<r;e++){let t=i+e,r=b+e;n===!0?l.push(r,r+1,t):l.push(r+1,r,t),_+=3}c.addGroup(g,_,n===!0?1:2),g+=_}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.radiusTop,t.radiusBottom,t.height,t.radialSegments,t.heightSegments,t.openEnded,t.thetaStart,t.thetaLength)}},Fi=class e extends gr{constructor(e=[new Y(0,-.5),new Y(.5,0),new Y(0,.5)],t=12,n=0,r=Math.PI*2){super(),this.type=`LatheGeometry`,this.parameters={points:e,segments:t,phiStart:n,phiLength:r},t=Math.floor(t),r=J(r,0,Math.PI*2);let i=[],a=[],o=[],s=[],c=[],l=1/t,u=new X,d=new Y,f=new X,p=new X,m=new X,h=0,g=0;for(let t=0;t<=e.length-1;t++)switch(t){case 0:h=e[t+1].x-e[t].x,g=e[t+1].y-e[t].y,f.x=g*1,f.y=-h,f.z=g*0,m.copy(f),f.normalize(),s.push(f.x,f.y,f.z);break;case e.length-1:s.push(m.x,m.y,m.z);break;default:h=e[t+1].x-e[t].x,g=e[t+1].y-e[t].y,f.x=g*1,f.y=-h,f.z=g*0,p.copy(f),f.x+=m.x,f.y+=m.y,f.z+=m.z,f.normalize(),s.push(f.x,f.y,f.z),m.copy(p)}for(let i=0;i<=t;i++){let f=n+i*l*r,p=Math.sin(f),m=Math.cos(f);for(let n=0;n<=e.length-1;n++){u.x=e[n].x*p,u.y=e[n].y,u.z=e[n].x*m,a.push(u.x,u.y,u.z),d.x=i/t,d.y=n/(e.length-1),o.push(d.x,d.y);let r=s[3*n+0]*p,l=s[3*n+1],f=s[3*n+0]*m;c.push(r,l,f)}}for(let n=0;n<t;n++)for(let t=0;t<e.length-1;t++){let r=t+n*e.length,a=r,o=r+e.length,s=r+e.length+1,c=r+1;i.push(a,o,c),i.push(s,c,o)}this.setIndex(i),this.setAttribute(`position`,new ir(a,3)),this.setAttribute(`uv`,new ir(o,2)),this.setAttribute(`normal`,new ir(c,3))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.points,t.segments,t.phiStart,t.phiLength)}},Ii=class e extends gr{constructor(e=1,t=1,n=1,r=1){super(),this.type=`PlaneGeometry`,this.parameters={width:e,height:t,widthSegments:n,heightSegments:r};let i=e/2,a=t/2,o=Math.floor(n),s=Math.floor(r),c=o+1,l=s+1,u=e/o,d=t/s,f=[],p=[],m=[],h=[];for(let e=0;e<l;e++){let t=e*d-a;for(let n=0;n<c;n++){let r=n*u-i;p.push(r,-t,0),m.push(0,0,1),h.push(n/o),h.push(1-e/s)}}for(let e=0;e<s;e++)for(let t=0;t<o;t++){let n=t+c*e,r=t+c*(e+1),i=t+1+c*(e+1),a=t+1+c*e;f.push(n,r,a),f.push(r,i,a)}this.setIndex(f),this.setAttribute(`position`,new ir(p,3)),this.setAttribute(`normal`,new ir(m,3)),this.setAttribute(`uv`,new ir(h,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.width,t.height,t.widthSegments,t.heightSegments)}},Li=class e extends gr{constructor(e=1,t=32,n=16,r=0,i=Math.PI*2,a=0,o=Math.PI){super(),this.type=`SphereGeometry`,this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:r,phiLength:i,thetaStart:a,thetaLength:o},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));let s=Math.min(a+o,Math.PI),c=0,l=[],u=new X,d=new X,f=[],p=[],m=[],h=[];for(let f=0;f<=n;f++){let g=[],_=f/n,v=a+_*o,y=e*Math.cos(v),b=Math.sqrt(e*e-y*y),x=0;f===0&&a===0?x=.5/t:f===n&&s===Math.PI&&(x=-.5/t);for(let e=0;e<=t;e++){let n=e/t,a=r+n*i;u.x=-b*Math.cos(a),u.y=y,u.z=b*Math.sin(a),p.push(u.x,u.y,u.z),d.copy(u).normalize(),m.push(d.x,d.y,d.z),h.push(n+x,1-_),g.push(c++)}l.push(g)}for(let e=0;e<n;e++)for(let r=0;r<t;r++){let t=l[e][r+1],i=l[e][r],o=l[e+1][r],c=l[e+1][r+1];(e!==0||a>0)&&f.push(t,i,c),(e!==n-1||s<Math.PI)&&f.push(i,o,c)}this.setIndex(f),this.setAttribute(`position`,new ir(p,3)),this.setAttribute(`normal`,new ir(m,3)),this.setAttribute(`uv`,new ir(h,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.radius,t.widthSegments,t.heightSegments,t.phiStart,t.phiLength,t.thetaStart,t.thetaLength)}},Ri=class e extends gr{constructor(e=1,t=.4,n=12,r=48,i=Math.PI*2,a=0,o=Math.PI*2){super(),this.type=`TorusGeometry`,this.parameters={radius:e,tube:t,radialSegments:n,tubularSegments:r,arc:i,thetaStart:a,thetaLength:o},n=Math.floor(n),r=Math.floor(r);let s=[],c=[],l=[],u=[],d=new X,f=new X,p=new X;for(let s=0;s<=n;s++){let m=a+s/n*o;for(let a=0;a<=r;a++){let o=a/r*i;f.x=(e+t*Math.cos(m))*Math.cos(o),f.y=(e+t*Math.cos(m))*Math.sin(o),f.z=t*Math.sin(m),c.push(f.x,f.y,f.z),d.x=e*Math.cos(o),d.y=e*Math.sin(o),p.subVectors(f,d).normalize(),l.push(p.x,p.y,p.z),u.push(a/r),u.push(s/n)}}for(let e=1;e<=n;e++)for(let t=1;t<=r;t++){let n=(r+1)*e+t-1,i=(r+1)*(e-1)+t-1,a=(r+1)*(e-1)+t,o=(r+1)*e+t;s.push(n,i,o),s.push(i,a,o)}this.setIndex(s),this.setAttribute(`position`,new ir(c,3)),this.setAttribute(`normal`,new ir(l,3)),this.setAttribute(`uv`,new ir(u,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(t){return new e(t.radius,t.tube,t.radialSegments,t.tubularSegments,t.arc,t.thetaStart,t.thetaLength)}};function zi(e){let t={};for(let n in e){t[n]={};for(let r in e[n]){let i=e[n][r];if(Vi(i))i.isRenderTargetTexture?(K(`UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms().`),t[n][r]=null):t[n][r]=i.clone();else if(Array.isArray(i)){if(Vi(i[0])){let e=[];for(let t=0,n=i.length;t<n;t++)e[t]=i[t].clone();t[n][r]=e}else t[n][r]=i.slice()}else t[n][r]=i}}return t}function Bi(e){let t={};for(let n=0;n<e.length;n++){let r=zi(e[n]);for(let e in r)t[e]=r[e]}return t}function Vi(e){return e&&(e.isColor||e.isMatrix3||e.isMatrix4||e.isVector2||e.isVector3||e.isVector4||e.isTexture||e.isQuaternion)}function Hi(e){let t=[];for(let n=0;n<e.length;n++)t.push(e[n].clone());return t}function Ui(e){let t=e.getRenderTarget();return t===null?e.outputColorSpace:t.isXRRenderTarget===!0?t.texture.colorSpace:Ct.workingColorSpace}var Wi={clone:zi,merge:Bi},Gi=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Ki=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`,qi=class extends Tr{constructor(e){super(),this.isShaderMaterial=!0,this.type=`ShaderMaterial`,this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Gi,this.fragmentShader=Ki,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=zi(e.uniforms),this.uniformsGroups=Hi(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this.defaultAttributeValues=Object.assign({},e.defaultAttributeValues),this.index0AttributeName=e.index0AttributeName,this.uniformsNeedUpdate=e.uniformsNeedUpdate,this}toJSON(e){let t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(let n in this.uniforms){let r=this.uniforms[n].value;r&&r.isTexture?t.uniforms[n]={type:`t`,value:r.toJSON(e).uuid}:r&&r.isColor?t.uniforms[n]={type:`c`,value:r.getHex()}:r&&r.isVector2?t.uniforms[n]={type:`v2`,value:r.toArray()}:r&&r.isVector3?t.uniforms[n]={type:`v3`,value:r.toArray()}:r&&r.isVector4?t.uniforms[n]={type:`v4`,value:r.toArray()}:r&&r.isMatrix3?t.uniforms[n]={type:`m3`,value:r.toArray()}:r&&r.isMatrix4?t.uniforms[n]={type:`m4`,value:r.toArray()}:t.uniforms[n]={value:r}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;let n={};for(let e in this.extensions)this.extensions[e]===!0&&(n[e]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}fromJSON(e,t){if(super.fromJSON(e,t),e.uniforms!==void 0)for(let n in e.uniforms){let r=e.uniforms[n];switch(this.uniforms[n]={},r.type){case`t`:this.uniforms[n].value=t[r.value]||null;break;case`c`:this.uniforms[n].value=new Q().setHex(r.value);break;case`v2`:this.uniforms[n].value=new Y().fromArray(r.value);break;case`v3`:this.uniforms[n].value=new X().fromArray(r.value);break;case`v4`:this.uniforms[n].value=new Pt().fromArray(r.value);break;case`m3`:this.uniforms[n].value=new Z().fromArray(r.value);break;case`m4`:this.uniforms[n].value=new zt().fromArray(r.value);break;default:this.uniforms[n].value=r.value}}if(e.defines!==void 0&&(this.defines=e.defines),e.vertexShader!==void 0&&(this.vertexShader=e.vertexShader),e.fragmentShader!==void 0&&(this.fragmentShader=e.fragmentShader),e.glslVersion!==void 0&&(this.glslVersion=e.glslVersion),e.extensions!==void 0)for(let t in e.extensions)this.extensions[t]=e.extensions[t];return e.lights!==void 0&&(this.lights=e.lights),e.clipping!==void 0&&(this.clipping=e.clipping),this}},Ji=class extends qi{constructor(e){super(e),this.isRawShaderMaterial=!0,this.type=`RawShaderMaterial`}},Yi=class extends Tr{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type=`MeshStandardMaterial`,this.defines={STANDARD:``},this.color=new Q(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new Q(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new Y(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Yt,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap=`round`,this.wireframeLinejoin=`round`,this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:``},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}},Xi=class extends Yi{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:``,PHYSICAL:``},this.type=`MeshPhysicalMaterial`,this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new Y(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return J(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(e){this.ior=(1+.4*e)/(1-.4*e)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new Q(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new Q(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new Q(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._retroreflectivity=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get retroreflectivity(){return this._retroreflectivity}set retroreflectivity(e){this._retroreflectivity>0!=e>0&&this.version++,this._retroreflectivity=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:``,PHYSICAL:``},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.retroreflectivity=e.retroreflectivity,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}},Zi=class extends Tr{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type=`MeshDepthMaterial`,this.depthPacking=He,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}},Qi=class extends Tr{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type=`MeshDistanceMaterial`,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}};function $i(e,t){return!e||e.constructor===t?e:typeof t.BYTES_PER_ELEMENT==`number`?new t(e):Array.prototype.slice.call(e)}function ea(e){return e!==void 0&&e.inTangents!==void 0&&e.outTangents!==void 0}var ta=class{constructor(e,t,n,r){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=r===void 0?new t.constructor(n):r,this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){let t=this.parameterPositions,n=this._cachedIndex,r=t[n],i=t[n-1];validate_interval:{seek:{let a;linear_scan:{forward_scan:if(!(e<r)){for(let a=n+2;;){if(r===void 0){if(e<i)break forward_scan;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(i=r,r=t[++n],e<r)break seek}a=t.length;break linear_scan}if(!(e>=i)){let o=t[1];e<o&&(n=2,i=o);for(let a=n-2;;){if(i===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===a)break;if(r=i,i=t[--n-1],e>=i)break seek}a=n,n=0;break linear_scan}break validate_interval}for(;n<a;){let r=n+a>>>1;e<t[r]?a=r:n=r+1}if(r=t[n],i=t[n-1],i===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(r===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,i,r)}return this.interpolate_(n,i,e,r)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){let t=this.resultBuffer,n=this.sampleValues,r=this.valueSize,i=e*r;for(let e=0;e!==r;++e)t[e]=n[i+e];return t}interpolate_(){throw Error(`THREE.Interpolant: Call to abstract method.`)}intervalChanged_(){}},na=class extends ta{constructor(e,t,n,r){super(e,t,n,r),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:ze,endingEnd:ze}}intervalChanged_(e,t,n){let r=this.parameterPositions,i=e-2,a=e+1,o=r[i],s=r[a];if(o===void 0)switch(this.getSettings_().endingStart){case Be:i=e,o=2*t-n;break;case Ve:i=r.length-2,o=t+r[i]-r[i+1];break;default:i=e,o=n}if(s===void 0)switch(this.getSettings_().endingEnd){case Be:a=e,s=2*n-t;break;case Ve:a=1,s=n+r[1]-r[0];break;default:a=e-1,s=t}let c=(n-t)*.5,l=this.valueSize;this._weightPrev=c/(t-o),this._weightNext=c/(s-n),this._offsetPrev=i*l,this._offsetNext=a*l}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=this._offsetPrev,u=this._offsetNext,d=this._weightPrev,f=this._weightNext,p=(n-t)/(r-t),m=p*p,h=m*p,g=-d*h+2*d*m-d*p,_=(1+d)*h+(-1.5-2*d)*m+(-.5+d)*p+1,v=(-1-f)*h+(1.5+f)*m+.5*p,y=f*h-f*m;for(let e=0;e!==o;++e)i[e]=g*a[l+e]+_*a[c+e]+v*a[s+e]+y*a[u+e];return i}},ra=class extends ta{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=(n-t)/(r-t),u=1-l;for(let e=0;e!==o;++e)i[e]=a[c+e]*u+a[s+e]*l;return i}},ia=class extends ta{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e){return this.copySampleValue_(e-1)}},aa=class extends ta{interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=e*o,c=s-o,l=this.inTangents,u=this.outTangents;if(!l||!u){let e=(n-t)/(r-t),l=1-e;for(let t=0;t!==o;++t)i[t]=a[c+t]*l+a[s+t]*e;return i}let d=o*2,f=e-1;for(let p=0;p!==o;++p){let o=a[c+p],m=a[s+p],h=f*d+p*2,g=u[h],_=u[h+1],v=e*d+p*2,y=l[v],b=l[v+1],x=ca(n,t,g,y,r);i[p]=oa(x,o,_,b,m)}return i}};function oa(e,t,n,r,i){let a=1-e;return a*a*a*t+3*a*a*e*n+3*a*e*e*r+e*e*e*i}function sa(e,t,n,r,i){let a=1-e;return 3*a*a*(n-t)+6*a*e*(r-n)+3*e*e*(i-r)}function ca(e,t,n,r,i){let a=(e-t)/(i-t);for(let o=0;o<8;o++){let o=oa(a,t,n,r,i)-e;if(Math.abs(o)<1e-10)break;let s=sa(a,t,n,r,i);if(Math.abs(s)<1e-10)break;a=Math.max(0,Math.min(1,a-o/s))}return a}var la=class{constructor(e,t,n,r){if(e===void 0)throw Error(`THREE.KeyframeTrack: track name is undefined`);if(t===void 0||t.length===0)throw Error(`THREE.KeyframeTrack: no keyframes in track named `+e);this.name=e,this.times=$i(t,this.TimeBufferType),this.values=$i(n,this.ValueBufferType),this.setInterpolation(r||this.DefaultInterpolation)}static toJSON(e){let t=e.constructor,n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:$i(e.times,Array),values:$i(e.values,Array)};let t=e.getInterpolation();t!==e.DefaultInterpolation&&(n.interpolation=t),ea(e.settings)&&(n.settings={inTangents:$i(e.settings.inTangents,Array),outTangents:$i(e.settings.outTangents,Array)})}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new ia(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new ra(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new na(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodBezier(e){let t=new aa(this.times,this.values,this.getValueSize(),e);return this.settings&&(t.inTangents=this.settings.inTangents,t.outTangents=this.settings.outTangents),t}setInterpolation(e){let t;switch(e){case Fe:t=this.InterpolantFactoryMethodDiscrete;break;case Ie:t=this.InterpolantFactoryMethodLinear;break;case Le:t=this.InterpolantFactoryMethodSmooth;break;case Re:t=this.InterpolantFactoryMethodBezier}if(t===void 0){let t=`unsupported interpolation for `+this.ValueTypeName+` keyframe track named `+this.name;if(this.createInterpolant===void 0){if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw Error(t)}return K(`KeyframeTrack:`,t),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Fe;case this.InterpolantFactoryMethodLinear:return Ie;case this.InterpolantFactoryMethodSmooth:return Le;case this.InterpolantFactoryMethodBezier:return Re}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){let t=this.times;for(let n=0,r=t.length;n!==r;++n)t[n]+=e}return this}scale(e){if(e!==1){let t=this.times;for(let n=0,r=t.length;n!==r;++n)t[n]*=e;ea(this.settings)&&(ua(this.settings.inTangents,e),ua(this.settings.outTangents,e))}return this}trim(e,t){let n=this.times,r=n.length,i=0,a=r-1;for(;i!==r&&n[i]<e;)++i;for(;a!==-1&&n[a]>t;)--a;if(++a,i!==0||a!==r){i>=a&&(a=Math.max(a,1),i=a-1);let e=this.getValueSize();this.times=n.slice(i,a),this.values=this.values.slice(i*e,a*e)}return this}validate(){let e=!0,t=this.getValueSize();t-Math.floor(t)!==0&&(q(`KeyframeTrack: Invalid value size in track.`,this),e=!1);let n=this.times,r=this.values,i=n.length;i===0&&(q(`KeyframeTrack: Track is empty.`,this),e=!1);let a=null;for(let t=0;t!==i;t++){let r=n[t];if(typeof r==`number`&&isNaN(r)){q(`KeyframeTrack: Time is not a valid number.`,this,t,r),e=!1;break}if(a!==null&&a>r){q(`KeyframeTrack: Out of order keys.`,this,t,r,a),e=!1;break}a=r}if(r!==void 0&&Qe(r))for(let t=0,n=r.length;t!==n;++t){let n=r[t];if(isNaN(n)){q(`KeyframeTrack: Value is not a valid number.`,this,t,n),e=!1;break}}return e}optimize(){let e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),r=this.getInterpolation()===Le,i=e.length-1,a=1;for(let o=1;o<i;++o){let i=!1,s=e[o];if(s!==e[o+1]&&(o!==1||s!==e[0])){if(r)i=!0;else{let e=o*n,r=e-n,a=e+n;for(let o=0;o!==n;++o){let n=t[e+o];if(n!==t[r+o]||n!==t[a+o]){i=!0;break}}}}if(i){if(o!==a){e[a]=e[o];let r=o*n,i=a*n;for(let e=0;e!==n;++e)t[i+e]=t[r+e]}++a}}if(i>0){e[a]=e[i];for(let e=i*n,r=a*n,o=0;o!==n;++o)t[r+o]=t[e+o];++a}return a===e.length?(this.times=e,this.values=t):(this.times=e.slice(0,a),this.values=t.slice(0,a*n)),this}clone(){let e=this.times.slice(),t=this.values.slice(),n=this.constructor,r=new n(this.name,e,t);return r.createInterpolant=this.createInterpolant,ea(this.settings)&&(r.settings={inTangents:this.settings.inTangents.slice(),outTangents:this.settings.outTangents.slice()}),r}};function ua(e,t){for(let n=0,r=e.length;n!==r;n+=2)e[n]*=t}la.prototype.ValueTypeName=``,la.prototype.TimeBufferType=Float32Array,la.prototype.ValueBufferType=Float32Array,la.prototype.DefaultInterpolation=Ie;var da=class extends la{constructor(e,t,n){super(e,t,n)}};da.prototype.ValueTypeName=`bool`,da.prototype.ValueBufferType=Array,da.prototype.DefaultInterpolation=Fe,da.prototype.InterpolantFactoryMethodLinear=void 0,da.prototype.InterpolantFactoryMethodSmooth=void 0;var fa=class extends la{constructor(e,t,n,r){super(e,t,n,r)}};fa.prototype.ValueTypeName=`color`;var pa=class extends la{constructor(e,t,n,r){super(e,t,n,r)}};pa.prototype.ValueTypeName=`number`;var ma=class extends ta{constructor(e,t,n,r){super(e,t,n,r)}interpolate_(e,t,n,r){let i=this.resultBuffer,a=this.sampleValues,o=this.valueSize,s=(n-t)/(r-t),c=e*o;for(let e=c+o;c!==e;c+=4)gt.slerpFlat(i,0,a,c-o,a,c,s);return i}},ha=class extends la{constructor(e,t,n,r){super(e,t,n,r)}InterpolantFactoryMethodLinear(e){return new ma(this.times,this.values,this.getValueSize(),e)}};ha.prototype.ValueTypeName=`quaternion`,ha.prototype.InterpolantFactoryMethodSmooth=void 0;var ga=class extends la{constructor(e,t,n){super(e,t,n)}};ga.prototype.ValueTypeName=`string`,ga.prototype.ValueBufferType=Array,ga.prototype.DefaultInterpolation=Fe,ga.prototype.InterpolantFactoryMethodLinear=void 0,ga.prototype.InterpolantFactoryMethodSmooth=void 0;var _a=class extends la{constructor(e,t,n,r){super(e,t,n,r)}};_a.prototype.ValueTypeName=`vector`;var va=class extends pn{constructor(e,t=1){super(),this.isLight=!0,this.type=`Light`,this.color=new Q(e),this.intensity=t}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){let t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,t}},ya=class extends va{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type=`HemisphereLight`,this.position.copy(pn.DEFAULT_UP),this.updateMatrix(),this.groundColor=new Q(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}toJSON(e){let t=super.toJSON(e);return t.object.groundColor=this.groundColor.getHex(),t}},ba=new zt,xa=new X,Sa=new X,Ca=class{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new Y(512,512),this.mapType=S,this.map=null,this.mapPass=null,this.matrix=new zt,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new pi,this._frameExtents=new Y(1,1),this._viewportCount=1,this._viewports=[new Pt(0,0,1,1)]}getViewportCount(){return this._viewportCount}getCamera(){return this.camera}getFrustum(){return this._frustum}updateMatrices(e){let t=this.camera;xa.setFromMatrixPosition(e.matrixWorld),t.position.copy(xa),Sa.setFromMatrixPosition(e.target.matrixWorld),t.lookAt(Sa),t.updateMatrixWorld(),this._updateMatrix(t,this.matrix,this._frustum)}_updateMatrix(e,t,n,r){ba.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),n.setFromProjectionMatrix(ba,e.coordinateSystem,e.reversedDepth);let i=this._frameExtents,a=r?r.z/i.x:1,o=r?r.w/i.y:1,s=r?r.x/i.x:0,c=r?r.y/i.y:0;e.coordinateSystem===2001||e.reversedDepth?t.set(.5*a,0,0,.5*a+s,0,.5*o,0,.5*o+c,0,0,1,0,0,0,0,1):t.set(.5*a,0,0,.5*a+s,0,.5*o,0,.5*o+c,0,0,.5,.5,0,0,0,1),t.multiply(ba)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this.biasNode=e.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let e={};return e.intensity=this.intensity,e.bias=this.bias,e.normalBias=this.normalBias,e.radius=this.radius,e.blurSamples=this.blurSamples,e.mapSize=this.mapSize.toArray(),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}},wa=new X,Ta=new gt,Ea=new X,Da=class extends pn{constructor(){super(),this.isCamera=!0,this.type=`Camera`,this.matrixWorldInverse=new zt,this.projectionMatrix=new zt,this.projectionMatrixInverse=new zt,this.coordinateSystem=Xe,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorld.decompose(wa,Ta,Ea),Ea.x===1&&Ea.y===1&&Ea.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(wa,Ta,Ea.set(1,1,1)).invert()}updateWorldMatrix(e,t,n=!1){super.updateWorldMatrix(e,t,n),this.matrixWorld.decompose(wa,Ta,Ea),Ea.x===1&&Ea.y===1&&Ea.z===1?this.matrixWorldInverse.copy(this.matrixWorld).invert():this.matrixWorldInverse.compose(wa,Ta,Ea.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}},Oa=new X,ka=new Y,Aa=new Y,ja=class extends Da{constructor(e=50,t=1,n=.1,r=2e3){super(),this.isPerspectiveCamera=!0,this.type=`PerspectiveCamera`,this.fov=e,this.zoom=1,this.near=n,this.far=r,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){let t=.5*this.getFilmHeight()/e;this.fov=ut*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){let e=Math.tan(lt*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return ut*2*Math.atan(Math.tan(lt*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){Oa.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Oa.x,Oa.y).multiplyScalar(-e/Oa.z),Oa.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Oa.x,Oa.y).multiplyScalar(-e/Oa.z)}getViewSize(e,t){return this.getViewBounds(e,ka,Aa),t.subVectors(Aa,ka)}setViewOffset(e,t,n,r,i,a){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=r,this.view.width=i,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=this.near,t=e*Math.tan(lt*.5*this.fov)/this.zoom,n=2*t,r=this.aspect*n,i=-.5*r,a=this.view;if(this.view!==null&&this.view.enabled){let e=a.fullWidth,o=a.fullHeight;i+=a.offsetX*r/e,t-=a.offsetY*n/o,r*=a.width/e,n*=a.height/o}let o=this.filmOffset;o!==0&&(i+=e*o/this.getFilmWidth()),this.projectionMatrix.makePerspective(i,i+r,t,t-n,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}},Ma=class extends Ca{constructor(){super(new ja(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(e){let t=this.camera,n=ut*2*e.angle*this.focus,r=this.mapSize.width/this.mapSize.height*this.aspect,i=e.distance||t.far;(n!==t.fov||r!==t.aspect||i!==t.far)&&(t.fov=n,t.aspect=r,t.far=i,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this.aspect=e.aspect,this}toJSON(){let e=super.toJSON();return e.focus=this.focus,e.aspect=this.aspect,e}},Na=class extends va{constructor(e,t,n=0,r=Math.PI/3,i=0,a=2){super(e,t),this.isSpotLight=!0,this.type=`SpotLight`,this.position.copy(pn.DEFAULT_UP),this.updateMatrix(),this.target=new pn,this.distance=n,this.angle=r,this.penumbra=i,this.decay=a,this.map=null,this.shadow=new Ma}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){super.dispose(),this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.map=e.map,this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.distance=this.distance,t.object.angle=this.angle,t.object.decay=this.decay,t.object.penumbra=this.penumbra,t.object.target=this.target.uuid,this.map&&this.map.isTexture&&(t.object.map=this.map.toJSON(e).uuid),t.object.shadow=this.shadow.toJSON(),t}},Pa=class extends Da{constructor(e=-1,t=1,n=1,r=-1,i=.1,a=2e3){super(),this.isOrthographicCamera=!0,this.type=`OrthographicCamera`,this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=r,this.near=i,this.far=a,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,r,i,a){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=r,this.view.width=i,this.view.height=a,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){let e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,r=(this.top+this.bottom)/2,i=n-e,a=n+e,o=r+t,s=r-t;if(this.view!==null&&this.view.enabled){let e=(this.right-this.left)/this.view.fullWidth/this.zoom,t=(this.top-this.bottom)/this.view.fullHeight/this.zoom;i+=e*this.view.offsetX,a=i+e*this.view.width,o-=t*this.view.offsetY,s=o-t*this.view.height}this.projectionMatrix.makeOrthographic(i,a,o,s,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){let t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}},Fa=class extends Ca{constructor(){super(new Pa(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}},Ia=class extends va{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type=`DirectionalLight`,this.position.copy(pn.DEFAULT_UP),this.updateMatrix(),this.target=new pn,this.shadow=new Fa}dispose(){super.dispose(),this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}toJSON(e){let t=super.toJSON(e);return t.object.shadow=this.shadow.toJSON(),t.object.target=this.target.uuid,t}},La=class extends gr{constructor(){super(),this.isInstancedBufferGeometry=!0,this.type=`InstancedBufferGeometry`,this.instanceCount=1/0}copy(e){return super.copy(e),this.instanceCount=e.instanceCount,this}toJSON(){let e=super.toJSON();return e.instanceCount=this.instanceCount,e.isInstancedBufferGeometry=!0,e}},Ra=-90,za=1,Ba=class extends pn{constructor(e,t,n){super(),this.type=`CubeCamera`,this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;let r=new ja(Ra,za,e,t);r.layers=this.layers,this.add(r);let i=new ja(Ra,za,e,t);i.layers=this.layers,this.add(i);let a=new ja(Ra,za,e,t);a.layers=this.layers,this.add(a);let o=new ja(Ra,za,e,t);o.layers=this.layers,this.add(o);let s=new ja(Ra,za,e,t);s.layers=this.layers,this.add(s);let c=new ja(Ra,za,e,t);c.layers=this.layers,this.add(c)}updateCoordinateSystem(){let e=this.coordinateSystem,t=this.children.concat(),[n,r,i,a,o,s]=t;for(let e of t)this.remove(e);if(e===2e3)n.up.set(0,1,0),n.lookAt(1,0,0),r.up.set(0,1,0),r.lookAt(-1,0,0),i.up.set(0,0,-1),i.lookAt(0,1,0),a.up.set(0,0,1),a.lookAt(0,-1,0),o.up.set(0,1,0),o.lookAt(0,0,1),s.up.set(0,1,0),s.lookAt(0,0,-1);else if(e===2001)n.up.set(0,-1,0),n.lookAt(-1,0,0),r.up.set(0,-1,0),r.lookAt(1,0,0),i.up.set(0,0,1),i.lookAt(0,1,0),a.up.set(0,0,-1),a.lookAt(0,-1,0),o.up.set(0,-1,0),o.lookAt(0,0,1),s.up.set(0,-1,0),s.lookAt(0,0,-1);else throw Error(`THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: `+e);for(let e of t)this.add(e),e.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();let{renderTarget:n,activeMipmapLevel:r}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());let[i,a,o,s,c,l]=this.children,u=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),p=e.xr.enabled;e.xr.enabled=!1;let m=n.texture.generateMipmaps;n.texture.generateMipmaps=!1;let h=!1;h=e.isWebGLRenderer===!0?e.state.buffers.depth.getReversed():e.reversedDepthBuffer,e.setRenderTarget(n,0,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,i),e.setRenderTarget(n,1,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,a),e.setRenderTarget(n,2,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,o),e.setRenderTarget(n,3,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,s),e.setRenderTarget(n,4,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,c),n.texture.generateMipmaps=m,e.setRenderTarget(n,5,r),h&&e.autoClear===!1&&e.clearDepth(),e.render(t,l),e.setRenderTarget(u,d,f),e.xr.enabled=p,n.texture.needsPMREMUpdate=!0}},Va=class extends ja{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}},Ha=`\\[\\]\\.:\\/`,Ua=RegExp(`[\\[\\]\\.:\\/]`,`g`),Wa=`[^\\[\\]\\.:\\/]`,Ga=`[^`+Ha.replace(`\\.`,``)+`]`,Ka=`((?:WC+[\\/:])*)`.replace(`WC`,Wa),qa=`(WCOD+)?`.replace(`WCOD`,Ga),Ja=`(?:\\.(WC+)(?:\\[(.+)\\])?)?`.replace(`WC`,Wa),Ya=`\\.(WC+)(?:\\[(.+)\\])?`.replace(`WC`,Wa),Xa=RegExp(`^`+Ka+qa+Ja+Ya+`$`),Za=[`material`,`materials`,`bones`,`map`],Qa=class{constructor(e,t,n){let r=n||$a.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,r)}getValue(e,t){this.bind();let n=this._targetGroup.nCachedObjects_,r=this._bindings[n];r!==void 0&&r.getValue(e,t)}setValue(e,t){let n=this._bindings;for(let r=this._targetGroup.nCachedObjects_,i=n.length;r!==i;++r)n[r].setValue(e,t)}bind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){let e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}},$a=class e{constructor(t,n,r){this.path=n,this.parsedPath=r||e.parseTrackName(n),this.node=e.findNode(t,this.parsedPath.nodeName),this.rootNode=t,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(t,n,r){return t&&t.isAnimationObjectGroup?new e.Composite(t,n,r):new e(t,n,r)}static sanitizeNodeName(e){return e.replace(/\s/g,`_`).replace(Ua,``)}static parseTrackName(e){let t=Xa.exec(e);if(t===null)throw Error(`THREE.PropertyBinding: Cannot parse trackName: `+e);let n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},r=n.nodeName&&n.nodeName.lastIndexOf(`.`);if(r!==void 0&&r!==-1){let e=n.nodeName.substring(r+1);Za.indexOf(e)!==-1&&(n.nodeName=n.nodeName.substring(0,r),n.objectName=e)}if(n.propertyName===null||n.propertyName.length===0)throw Error(`THREE.PropertyBinding: can not parse propertyName from trackName: `+e);return n}static findNode(e,t){if(t===void 0||t===``||t===`.`||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){let n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){let n=function(e){for(let r=0;r<e.length;r++){let i=e[r];if(i.name===t||i.uuid===t)return i;let a=n(i.children);if(a)return a}return null},r=n(e.children);if(r)return r}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)e[t++]=n[r]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++]}_setValue_array_setNeedsUpdate(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){let n=this.resolvedProperty;for(let r=0,i=n.length;r!==i;++r)n[r]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let t=this.node,n=this.parsedPath,r=n.objectName,i=n.propertyName,a=n.propertyIndex;if(t||(t=e.findNode(this.rootNode,n.nodeName),this.node=t),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!t){K(`PropertyBinding: No target node found for track: `+this.path+`.`);return}if(r){let e=n.objectIndex;switch(r){case`materials`:if(!t.material){q(`PropertyBinding: Can not bind to material as node does not have a material.`,this);return}if(!t.material.materials){q(`PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.`,this);return}t=t.material.materials;break;case`bones`:if(!t.skeleton){q(`PropertyBinding: Can not bind to bones as node does not have a skeleton.`,this);return}t=t.skeleton.bones;for(let n=0;n<t.length;n++)if(t[n].name===e){e=n;break}break;case`map`:if(`map`in t){t=t.map;break}if(!t.material){q(`PropertyBinding: Can not bind to material as node does not have a material.`,this);return}if(!t.material.map){q(`PropertyBinding: Can not bind to material.map as node.material does not have a map.`,this);return}t=t.material.map;break;default:if(t[r]===void 0){q(`PropertyBinding: Can not bind to objectName of node undefined.`,this);return}t=t[r]}if(e!==void 0){if(t[e]===void 0){q(`PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.`,this,t);return}t=t[e]}}let o=t[i];if(o===void 0){let e=n.nodeName;q(`PropertyBinding: Trying to update property for track: `+e+`.`+i+` but it wasn't found.`,t);return}let s=this.Versioning.None;this.targetObject=t,t.isMaterial===!0?s=this.Versioning.NeedsUpdate:t.isObject3D===!0&&(s=this.Versioning.MatrixWorldNeedsUpdate);let c=this.BindingType.Direct;if(a!==void 0){if(i===`morphTargetInfluences`){if(!t.geometry){q(`PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.`,this);return}if(!t.geometry.morphAttributes){q(`PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.`,this);return}t.morphTargetDictionary[a]!==void 0&&(a=t.morphTargetDictionary[a])}c=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=a}else o.fromArray!==void 0&&o.toArray!==void 0?(c=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(c=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=i;this.getValue=this.GetterByBindingType[c],this.setValue=this.SetterByBindingTypeAndVersioning[c][s]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}};$a.Composite=Qa,$a.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3},$a.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2},$a.prototype.GetterByBindingType=[$a.prototype._getValue_direct,$a.prototype._getValue_array,$a.prototype._getValue_arrayElement,$a.prototype._getValue_toArray],$a.prototype.SetterByBindingTypeAndVersioning=[[$a.prototype._setValue_direct,$a.prototype._setValue_direct_setNeedsUpdate,$a.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[$a.prototype._setValue_array,$a.prototype._setValue_array_setNeedsUpdate,$a.prototype._setValue_array_setMatrixWorldNeedsUpdate],[$a.prototype._setValue_arrayElement,$a.prototype._setValue_arrayElement_setNeedsUpdate,$a.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[$a.prototype._setValue_fromArray,$a.prototype._setValue_fromArray_setNeedsUpdate,$a.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]],class e{static{e.prototype.isMatrix2=!0}constructor(e,t,n,r){this.elements=[1,0,0,1],e!==void 0&&this.set(e,t,n,r)}identity(){return this.set(1,0,0,1),this}fromArray(e,t=0){for(let n=0;n<4;n++)this.elements[n]=e[n+t];return this}set(e,t,n,r){let i=this.elements;return i[0]=e,i[2]=t,i[1]=n,i[3]=r,this}};function eo(e,t,n,r){let i=to(r);switch(n){case F:return e*t;case ne:return e*t/i.components*i.byteLength;case re:return e*t/i.components*i.byteLength;case R:return e*t*2/i.components*i.byteLength;case ie:return e*t*2/i.components*i.byteLength;case I:return e*t*3/i.components*i.byteLength;case L:return e*t*4/i.components*i.byteLength;case z:return e*t*4/i.components*i.byteLength;case B:case ae:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*8;case oe:case V:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case ce:case ue:return Math.max(e,16)*Math.max(t,8)/4;case se:case le:return Math.max(e,8)*Math.max(t,8)/2;case de:case H:case pe:case me:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*8;case fe:case he:case ge:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case _e:return Math.floor((e+3)/4)*Math.floor((t+3)/4)*16;case ve:return Math.floor((e+4)/5)*Math.floor((t+3)/4)*16;case ye:return Math.floor((e+4)/5)*Math.floor((t+4)/5)*16;case be:return Math.floor((e+5)/6)*Math.floor((t+4)/5)*16;case xe:return Math.floor((e+5)/6)*Math.floor((t+5)/6)*16;case Se:return Math.floor((e+7)/8)*Math.floor((t+4)/5)*16;case Ce:return Math.floor((e+7)/8)*Math.floor((t+5)/6)*16;case we:return Math.floor((e+7)/8)*Math.floor((t+7)/8)*16;case Te:return Math.floor((e+9)/10)*Math.floor((t+4)/5)*16;case U:return Math.floor((e+9)/10)*Math.floor((t+5)/6)*16;case Ee:return Math.floor((e+9)/10)*Math.floor((t+7)/8)*16;case De:return Math.floor((e+9)/10)*Math.floor((t+9)/10)*16;case Oe:return Math.floor((e+11)/12)*Math.floor((t+9)/10)*16;case W:return Math.floor((e+11)/12)*Math.floor((t+11)/12)*16;case ke:case G:case Ae:return Math.ceil(e/4)*Math.ceil(t/4)*16;case je:case Me:return Math.ceil(e/4)*Math.ceil(t/4)*8;case Ne:case Pe:return Math.ceil(e/4)*Math.ceil(t/4)*16}throw Error(`Unable to determine texture byte length for ${n} format.`)}function to(e){switch(e){case S:case C:return{byteLength:1,components:1};case T:case w:case k:return{byteLength:2,components:1};case A:case j:return{byteLength:2,components:4};case D:case E:case O:return{byteLength:4,components:1};case N:case P:return{byteLength:4,components:3}}throw Error(`THREE.TextureUtils: Unknown texture type ${e}.`)}typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`register`,{detail:{revision:`186`}})),typeof window<`u`&&(window.__THREE__?K(`WARNING: Multiple instances of Three.js being imported.`):window.__THREE__=`186`);function no(){let e=null,t=!1,n=null,r=null;function i(t,a){r=e.requestAnimationFrame(i),n(t,a)}return{start:function(){t!==!0&&n!==null&&e!==null&&(r=e.requestAnimationFrame(i),t=!0)},stop:function(){e!==null&&e.cancelAnimationFrame(r),t=!1},setAnimationLoop:function(e){n=e},setContext:function(t){e=t}}}function ro(e){let t=new WeakMap;function n(t,n){let r=t.array,i=t.usage,a=r.byteLength,o=e.createBuffer();e.bindBuffer(n,o),e.bufferData(n,r,i),t.onUploadCallback();let s;if(r instanceof Float32Array)s=e.FLOAT;else if(typeof Float16Array<`u`&&r instanceof Float16Array)s=e.HALF_FLOAT;else if(r instanceof Uint16Array)s=t.isFloat16BufferAttribute?e.HALF_FLOAT:e.UNSIGNED_SHORT;else if(r instanceof Int16Array)s=e.SHORT;else if(r instanceof Uint32Array)s=e.UNSIGNED_INT;else if(r instanceof Int32Array)s=e.INT;else if(r instanceof Int8Array)s=e.BYTE;else if(r instanceof Uint8Array)s=e.UNSIGNED_BYTE;else if(r instanceof Uint8ClampedArray)s=e.UNSIGNED_BYTE;else throw Error(`THREE.WebGLAttributes: Unsupported buffer data format: `+r);return{buffer:o,type:s,bytesPerElement:r.BYTES_PER_ELEMENT,version:t.version,size:a}}function r(t,n,r){let i=n.array,a=n.updateRanges;if(e.bindBuffer(r,t),a.length===0)e.bufferSubData(r,0,i);else{a.sort((e,t)=>e.start-t.start);let t=0;for(let e=1;e<a.length;e++){let n=a[t],r=a[e];r.start<=n.start+n.count+1?n.count=Math.max(n.count,r.start+r.count-n.start):(++t,a[t]=r)}a.length=t+1;for(let t=0,n=a.length;t<n;t++){let n=a[t];e.bufferSubData(r,n.start*i.BYTES_PER_ELEMENT,i,n.start,n.count)}n.clearUpdateRanges()}n.onUploadCallback()}function i(e){return e.isInterleavedBufferAttribute&&(e=e.data),t.get(e)}function a(n){n.isInterleavedBufferAttribute&&(n=n.data);let r=t.get(n);r&&(e.deleteBuffer(r.buffer),t.delete(n))}function o(e,i){if(e.isInterleavedBufferAttribute&&(e=e.data),e.isGLBufferAttribute){let n=t.get(e);(!n||n.version<e.version)&&t.set(e,{buffer:e.buffer,type:e.type,bytesPerElement:e.elementSize,version:e.version});return}let a=t.get(e);if(a===void 0)t.set(e,n(e,i));else if(a.version<e.version){if(a.size!==e.array.byteLength)throw Error(`THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.`);r(a.buffer,e,i),a.version=e.version}}return{get:i,remove:a,update:o}}var io={alphahash_fragment:`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,alphahash_pars_fragment:`#ifdef USE_ALPHAHASH
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
#endif`,alphamap_fragment:`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,alphamap_pars_fragment:`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,alphatest_fragment:`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,alphatest_pars_fragment:`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,aomap_fragment:`#ifdef USE_AOMAP
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
#endif`,aomap_pars_fragment:`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,batching_pars_vertex:`#ifdef USE_BATCHING
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
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,batching_vertex:`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,begin_vertex:`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,beginnormal_vertex:`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,bsdfs:`float G_BlinnPhong_Implicit( ) {
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
} // validated`,iridescence_fragment:`#ifdef USE_IRIDESCENCE
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
#endif`,bumpmap_pars_fragment:`#ifdef USE_BUMPMAP
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
#endif`,clipping_planes_fragment:`#if NUM_CLIPPING_PLANES > 0
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
#endif`,clipping_planes_pars_fragment:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,clipping_planes_pars_vertex:`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,clipping_planes_vertex:`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,color_fragment:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,color_pars_fragment:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,color_pars_vertex:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,color_vertex:`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,common:`#define PI 3.141592653589793
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
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
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
} // validated`,cube_uv_reflection_fragment:`#ifdef ENVMAP_TYPE_CUBE_UV
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
#endif`,defaultnormal_vertex:`vec3 transformedNormal = objectNormal;
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
#endif`,displacementmap_pars_vertex:`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,displacementmap_vertex:`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,emissivemap_fragment:`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,emissivemap_pars_fragment:`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,colorspace_fragment:`gl_FragColor = linearToOutputTexel( gl_FragColor );`,colorspace_pars_fragment:`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,envmap_fragment:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,envmap_common_pars_fragment:`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
#endif`,envmap_pars_fragment:`#ifdef USE_ENVMAP
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
#endif`,envmap_pars_vertex:`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,envmap_physical_pars_fragment:`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_RETROREFLECTION
		vec3 getIBLRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 retroVec = normalize( mix( viewDir, normal, pow4( roughness ) ) );
				retroVec = transformDirectionByInverseViewMatrix( retroVec, viewMatrix );
				vec4 envMapColor = textureCubeUV( envMap, envMapRotation * retroVec, roughness );
				return envMapColor.rgb * envMapIntensity;
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
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
		#ifdef USE_RETROREFLECTION
			vec3 getIBLAnisotropyRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
				#ifdef ENVMAP_TYPE_CUBE_UV
					vec3 bentNormal = cross( bitangent, viewDir );
					bentNormal = normalize( cross( bentNormal, bitangent ) );
					bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
					return getIBLRetroRadiance( viewDir, bentNormal, roughness );
				#else
					return vec3( 0.0 );
				#endif
			}
		#endif
	#endif
#endif`,envmap_vertex:`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,fog_vertex:`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,fog_pars_vertex:`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,fog_fragment:`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,fog_pars_fragment:`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,gradientmap_pars_fragment:`#ifdef USE_GRADIENTMAP
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
}`,lightmap_pars_fragment:`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,lights_lambert_fragment:`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,lights_lambert_pars_fragment:`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,lights_pars_begin:`uniform bool receiveShadow;
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
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
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
#if NUM_SUN_LIGHTS > 0
	struct SunLight {
		vec3 direction;
		vec3 color;
	};
	uniform SunLight sunLights[ NUM_SUN_LIGHTS ];
	void getSunLightInfo( const in SunLight sunLight, out IncidentLight light ) {
		light.color = sunLight.color;
		light.direction = sunLight.direction;
		light.visible = true;
	}
#endif
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
#endif
#include <lightprobes_pars_fragment>`,lights_toon_fragment:`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,lights_toon_pars_fragment:`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,lights_phong_fragment:`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,lights_phong_pars_fragment:`varying vec3 vViewPosition;
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
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,lights_physical_fragment:`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
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
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
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
#ifdef USE_RETROREFLECTION
	material.retroreflectivity = retroreflectivity;
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
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
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
#endif`,lights_physical_pars_fragment:`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	vec2 dfg;
	vec3 multiScatteringCompensation;
	#ifdef USE_RETROREFLECTION
		float retroreflectivity;
	#endif
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
		vec3 iridescenceF0Dielectric;
		vec3 iridescenceF0Metallic;
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
		return 0.5 / max( gv + gl, EPSILON );
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
	vec3 f0 = material.specularColorBlended;
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
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
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
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec2 fab, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec2 fab, const in vec3 specularColor, const in float specularF90, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
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
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
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
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	#ifdef USE_RETROREFLECTION
		vec3 retroViewDir = reflect( - geometryViewDir, geometryNormal );
		vec3 retroSpecularBRDF = BRDF_GGX( directLight.direction, retroViewDir, geometryNormal, material );
		specularBRDF = mix( specularBRDF, retroSpecularBRDF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotVH = saturate( dot( geometryViewDir, halfDir ) );
	vec3 F = F_Schlick( material.specularColor, material.specularF90, dotVH );
	#ifdef USE_RETROREFLECTION
		vec3 retroHalfDir = normalize( directLight.direction + retroViewDir );
		float dotRetroVH = saturate( dot( retroViewDir, retroHalfDir ) );
		vec3 retroF = F_Schlick( material.specularColor, material.specularF90, dotRetroVH );
		F = mix( F, retroF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScattering, multiScattering );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScattering, multiScattering );
	#endif
	vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( material.dfg, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceF0Metallic, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( material.dfg, material.diffuseColor, material.specularF90, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,lights_fragment_begin:`
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
		vec3 iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		vec3 iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( iridescenceFresnelDielectric, iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0Dielectric = Schlick_to_F0( iridescenceFresnelDielectric, 1.0, dotNVi );
		material.iridescenceF0Metallic = Schlick_to_F0( iridescenceFresnelMetallic, 1.0, dotNVi );
	}
#endif
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
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
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
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
#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )
	SunLight sunLight;
	#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHTS; i ++ ) {
		sunLight = sunLights[ i ];
		getSunLightInfo( sunLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SUN_LIGHT_SHADOWS )
		sunLightShadow = sunLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap[ i ], sunLightShadow, UNROLLED_LOOP_INDEX ) : 1.0;
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
	#ifdef USE_LIGHT_PROBES_GRID
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		irradiance += getLightProbeGridIrradiance( probeWorldPos, probeWorldNormal );
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,lights_fragment_maps:`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		vec3 iblRadiance = getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_RETROREFLECTION
		#ifdef USE_ANISOTROPY
			vec3 retroIBLRadiance = getIBLAnisotropyRetroRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
		#else
			vec3 retroIBLRadiance = getIBLRetroRadiance( geometryViewDir, geometryNormal, material.roughness );
		#endif
		iblRadiance = mix( iblRadiance, retroIBLRadiance, saturate( material.retroreflectivity ) );
	#endif
	radiance += iblRadiance;
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,lights_fragment_end:`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,lightprobes_pars_fragment:`#ifdef USE_LIGHT_PROBES_GRID
uniform highp sampler3D probesSH;
uniform vec3 probesMin;
uniform vec3 probesMax;
uniform vec3 probesResolution;
vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 resMinusOne = res - 1.0;
	vec3 probeSpacing = gridRange / resMinusOne;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.0, 1.0 );
	uvw = uvw * resMinusOne / res + 0.5 / res;
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,logdepthbuf_fragment:`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,logdepthbuf_pars_fragment:`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_pars_vertex:`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,logdepthbuf_vertex:`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,map_fragment:`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,map_pars_fragment:`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,map_particle_fragment:`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
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
#endif`,map_particle_pars_fragment:`#if defined( USE_POINTS_UV )
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
#endif`,metalnessmap_fragment:`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,metalnessmap_pars_fragment:`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,morphinstance_vertex:`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,morphcolor_vertex:`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,morphnormal_vertex:`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,morphtarget_pars_vertex:`#ifdef USE_MORPHTARGETS
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
#endif`,morphtarget_vertex:`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,normal_fragment_begin:`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
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
	#ifdef DOUBLE_SIDED
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
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,normal_fragment_maps:`#ifdef USE_NORMALMAP_OBJECTSPACE
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
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,normal_pars_fragment:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_pars_vertex:`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,normal_vertex:`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,normalmap_pars_fragment:`#ifdef USE_NORMALMAP
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
#endif`,clearcoat_normal_fragment_begin:`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,clearcoat_normal_fragment_maps:`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,clearcoat_pars_fragment:`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,iridescence_pars_fragment:`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,opaque_fragment:`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,packing:`vec3 packNormalToRGB( const in vec3 normal ) {
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
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,premultiplied_alpha_fragment:`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,project_vertex:`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,dithering_fragment:`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,dithering_pars_fragment:`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,roughnessmap_fragment:`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,roughnessmap_pars_fragment:`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,shadowmap_pars_fragment:`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		#define SUN_LIGHT_CASCADES 2
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#else
			uniform sampler2D sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#endif
		uniform mat4 sunShadowMatrix[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		uniform vec4 sunShadowCascade[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
		struct SunLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SunLightShadow sunLightShadows[ NUM_SUN_LIGHT_SHADOWS ];
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
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
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
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
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
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
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				float radius = shadowRadius * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_SUN_LIGHT_SHADOWS > 0
		float getSunShadow(
			#if defined( SHADOWMAP_TYPE_PCF )
				sampler2DShadow shadowMap,
			#else
				sampler2D shadowMap,
			#endif
			SunLightShadow sunLightShadow,
			int shadowIndex
		) {
			vec4 shadowWorldPosition = vec4( vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * sunLightShadow.shadowNormalBias, 1.0 );
			float viewDepth = vSunShadowWorldPosition.w;
			int cascadeOffset = shadowIndex * SUN_LIGHT_CASCADES;
			float shadow = 1.0;
			for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
				vec4 cascade = sunShadowCascade[ cascadeOffset + i ];
				if ( viewDepth >= cascade.x && viewDepth < cascade.y ) {
					float cascadeShadow = getShadow(
						shadowMap,
						sunLightShadow.shadowMapSize,
						sunLightShadow.shadowIntensity,
						sunLightShadow.shadowBias,
						sunLightShadow.shadowRadius,
						sunShadowMatrix[ cascadeOffset + i ] * shadowWorldPosition
					);
					shadow = mix( cascadeShadow, shadow, smoothstep( cascade.z, cascade.y, viewDepth ) );
				}
			}
			return shadow;
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp -= shadowBias;
			#else
				float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
				dp += shadowBias;
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			vec2 sample0 = vogelDiskSample( 0, 5, phi );
			vec2 sample1 = vogelDiskSample( 1, 5, phi );
			vec2 sample2 = vogelDiskSample( 2, 5, phi );
			vec2 sample3 = vogelDiskSample( 3, 5, phi );
			vec2 sample4 = vogelDiskSample( 4, 5, phi );
			shadow = (
				texture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +
				texture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )
			) * 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,shadowmap_pars_vertex:`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
	#endif
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
#endif`,shadowmap_vertex:`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SUN_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_SUN_LIGHT_SHADOWS > 0
		vSunShadowWorldPosition = vec4( worldPosition.xyz, - mvPosition.z );
		vSunShadowWorldNormal = shadowWorldNormal;
	#endif
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
#endif`,shadowmask_pars_fragment:`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHT_SHADOWS; i ++ ) {
		sunLight = sunLightShadows[ i ];
		shadow *= receiveShadow ? getSunShadow( sunShadowMap[ i ], sunLight, UNROLLED_LOOP_INDEX ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
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
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
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
}`,skinbase_vertex:`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,skinning_pars_vertex:`#ifdef USE_SKINNING
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
#endif`,skinning_vertex:`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,skinnormal_vertex:`#ifdef USE_SKINNING
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
#endif`,specularmap_fragment:`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,specularmap_pars_fragment:`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,tonemapping_fragment:`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,tonemapping_pars_fragment:`#ifndef saturate
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
vec3 CustomToneMapping( vec3 color ) { return color; }`,transmission_fragment:`#ifdef USE_TRANSMISSION
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
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,transmission_pars_fragment:`#ifdef USE_TRANSMISSION
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
#endif`,uv_pars_fragment:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,uv_pars_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,uv_vertex:`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
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
#endif`,worldpos_vertex:`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,background_vert:`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,background_frag:`uniform sampler2D t2D;
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
}`,backgroundCube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,backgroundCube_frag:`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,cube_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,cube_frag:`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,depth_vert:`#include <common>
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
}`,depth_frag:`#if DEPTH_PACKING == 3200
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
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,distance_vert:`#define DISTANCE
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
}`,distance_frag:`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,equirect_vert:`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,equirect_frag:`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,linedashed_vert:`uniform float scale;
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
}`,linedashed_frag:`uniform vec3 diffuse;
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
}`,meshbasic_vert:`#include <common>
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
}`,meshbasic_frag:`uniform vec3 diffuse;
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
}`,meshlambert_vert:`#define LAMBERT
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
}`,meshlambert_frag:`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
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
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
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
}`,meshmatcap_vert:`#define MATCAP
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
}`,meshmatcap_frag:`#define MATCAP
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
}`,meshnormal_vert:`#define NORMAL
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
}`,meshnormal_frag:`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
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
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,meshphong_vert:`#define PHONG
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
}`,meshphong_frag:`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
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
#include <emissivemap_pars_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
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
}`,meshphysical_vert:`#define STANDARD
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
}`,meshphysical_frag:`#define STANDARD
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
#ifdef USE_RETROREFLECTION
	uniform float retroreflectivity;
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
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
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
}`,meshtoon_vert:`#define TOON
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
}`,meshtoon_frag:`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
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
}`,points_vert:`uniform float size;
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
}`,points_frag:`uniform vec3 diffuse;
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
}`,shadow_vert:`#include <common>
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
}`,shadow_frag:`uniform vec3 color;
uniform float opacity;
#include <common>
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
	#include <premultiplied_alpha_fragment>
}`,sprite_vert:`uniform float rotation;
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
}`,sprite_frag:`uniform vec3 diffuse;
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
}`},$={common:{diffuse:{value:new Q(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new Z},alphaMap:{value:null},alphaMapTransform:{value:new Z},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new Z}},envmap:{envMap:{value:null},envMapRotation:{value:new Z},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new Z}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new Z}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new Z},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new Z},normalScale:{value:new Y(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new Z},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new Z}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new Z}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new Z}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new Q(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},sunLights:{value:[],properties:{direction:{},color:{}}},sunLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},sunShadowMatrix:{value:[]},sunShadowCascade:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:null},probesMin:{value:new X},probesMax:{value:new X},probesResolution:{value:new X}},points:{diffuse:{value:new Q(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new Z},alphaTest:{value:0},uvTransform:{value:new Z}},sprite:{diffuse:{value:new Q(16777215)},opacity:{value:1},center:{value:new Y(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new Z},alphaMap:{value:null},alphaMapTransform:{value:new Z},alphaTest:{value:0}}},ao={basic:{uniforms:Bi([$.common,$.specularmap,$.envmap,$.aomap,$.lightmap,$.fog]),vertexShader:io.meshbasic_vert,fragmentShader:io.meshbasic_frag},lambert:{uniforms:Bi([$.common,$.specularmap,$.envmap,$.aomap,$.lightmap,$.emissivemap,$.bumpmap,$.normalmap,$.displacementmap,$.fog,$.lights,{emissive:{value:new Q(0)},envMapIntensity:{value:1}}]),vertexShader:io.meshlambert_vert,fragmentShader:io.meshlambert_frag},phong:{uniforms:Bi([$.common,$.specularmap,$.envmap,$.aomap,$.lightmap,$.emissivemap,$.bumpmap,$.normalmap,$.displacementmap,$.fog,$.lights,{emissive:{value:new Q(0)},specular:{value:new Q(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:io.meshphong_vert,fragmentShader:io.meshphong_frag},standard:{uniforms:Bi([$.common,$.envmap,$.aomap,$.lightmap,$.emissivemap,$.bumpmap,$.normalmap,$.displacementmap,$.roughnessmap,$.metalnessmap,$.fog,$.lights,{emissive:{value:new Q(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:io.meshphysical_vert,fragmentShader:io.meshphysical_frag},toon:{uniforms:Bi([$.common,$.aomap,$.lightmap,$.emissivemap,$.bumpmap,$.normalmap,$.displacementmap,$.gradientmap,$.fog,$.lights,{emissive:{value:new Q(0)}}]),vertexShader:io.meshtoon_vert,fragmentShader:io.meshtoon_frag},matcap:{uniforms:Bi([$.common,$.bumpmap,$.normalmap,$.displacementmap,$.fog,{matcap:{value:null}}]),vertexShader:io.meshmatcap_vert,fragmentShader:io.meshmatcap_frag},points:{uniforms:Bi([$.points,$.fog]),vertexShader:io.points_vert,fragmentShader:io.points_frag},dashed:{uniforms:Bi([$.common,$.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:io.linedashed_vert,fragmentShader:io.linedashed_frag},depth:{uniforms:Bi([$.common,$.displacementmap]),vertexShader:io.depth_vert,fragmentShader:io.depth_frag},normal:{uniforms:Bi([$.common,$.bumpmap,$.normalmap,$.displacementmap,{opacity:{value:1}}]),vertexShader:io.meshnormal_vert,fragmentShader:io.meshnormal_frag},sprite:{uniforms:Bi([$.sprite,$.fog]),vertexShader:io.sprite_vert,fragmentShader:io.sprite_frag},background:{uniforms:{uvTransform:{value:new Z},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:io.background_vert,fragmentShader:io.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new Z}},vertexShader:io.backgroundCube_vert,fragmentShader:io.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:io.cube_vert,fragmentShader:io.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:io.equirect_vert,fragmentShader:io.equirect_frag},distance:{uniforms:Bi([$.common,$.displacementmap,{referencePosition:{value:new X},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:io.distance_vert,fragmentShader:io.distance_frag},shadow:{uniforms:Bi([$.lights,$.fog,{color:{value:new Q(0)},opacity:{value:1}}]),vertexShader:io.shadow_vert,fragmentShader:io.shadow_frag}};ao.physical={uniforms:Bi([ao.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new Z},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new Z},clearcoatNormalScale:{value:new Y(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new Z},dispersion:{value:0},retroreflectivity:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new Z},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new Z},sheen:{value:0},sheenColor:{value:new Q(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new Z},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new Z},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new Z},transmissionSamplerSize:{value:new Y},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new Z},attenuationDistance:{value:0},attenuationColor:{value:new Q(0)},specularColor:{value:new Q(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new Z},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new Z},anisotropyVector:{value:new Y},anisotropyMap:{value:null},anisotropyMapTransform:{value:new Z}}]),vertexShader:io.meshphysical_vert,fragmentShader:io.meshphysical_frag};var oo={r:0,b:0,g:0},so=new zt,co=new Z;co.set(-1,0,0,0,1,0,0,0,1);function lo(e,t,n,r,i,a){let o=new Q(0),s=i===!0?0:1,c,l,u=null,d=0,f=null;function p(e){let n=e.isScene===!0?e.background:null;if(n&&n.isTexture){let r=e.backgroundBlurriness>0;n=t.get(n,r)}return n}function m(t){let r=!1,i=p(t);i===null?g(o,s):i&&i.isColor&&(g(i,1),r=!0);let c=e.xr.getEnvironmentBlendMode();c===`additive`?n.buffers.color.setClear(0,0,0,1,a):c===`alpha-blend`&&n.buffers.color.setClear(0,0,0,0,a),(e.autoClear||r)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),e.clear(e.autoClearColor,e.autoClearDepth,e.autoClearStencil))}function h(t,n){let i=p(n);i&&(i.isCubeTexture||i.mapping===306)?(l===void 0&&(l=new ai(new Ni(1,1,1),new qi({name:`BackgroundCubeMaterial`,uniforms:zi(ao.backgroundCube.uniforms),vertexShader:ao.backgroundCube.vertexShader,fragmentShader:ao.backgroundCube.fragmentShader,side:1,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute(`normal`),l.geometry.deleteAttribute(`uv`),l.onBeforeRender=function(e,t,n){this.matrixWorld.copyPosition(n.matrixWorld)},Object.defineProperty(l.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),r.update(l)),l.material.uniforms.envMap.value=i,l.material.uniforms.backgroundBlurriness.value=n.backgroundBlurriness,l.material.uniforms.backgroundIntensity.value=n.backgroundIntensity,l.material.uniforms.backgroundRotation.value.setFromMatrix4(so.makeRotationFromEuler(n.backgroundRotation)).transpose(),i.isCubeTexture&&i.isRenderTargetTexture===!1&&l.material.uniforms.backgroundRotation.value.premultiply(co),l.material.toneMapped=Ct.getTransfer(i.colorSpace)!==Ke,(u!==i||d!==i.version||f!==e.toneMapping)&&(l.material.needsUpdate=!0,u=i,d=i.version,f=e.toneMapping),l.layers.enableAll(),t.unshift(l,l.geometry,l.material,0,0,null)):i&&i.isTexture&&(c===void 0&&(c=new ai(new Ii(2,2),new qi({name:`BackgroundMaterial`,uniforms:zi(ao.background.uniforms),vertexShader:ao.background.vertexShader,fragmentShader:ao.background.fragmentShader,side:0,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),c.geometry.deleteAttribute(`normal`),Object.defineProperty(c.material,"map",{get:function(){return this.uniforms.t2D.value}}),r.update(c)),c.material.uniforms.t2D.value=i,c.material.uniforms.backgroundIntensity.value=n.backgroundIntensity,c.material.toneMapped=Ct.getTransfer(i.colorSpace)!==Ke,i.matrixAutoUpdate===!0&&i.updateMatrix(),c.material.uniforms.uvTransform.value.copy(i.matrix),(u!==i||d!==i.version||f!==e.toneMapping)&&(c.material.needsUpdate=!0,u=i,d=i.version,f=e.toneMapping),c.layers.enableAll(),t.unshift(c,c.geometry,c.material,0,0,null))}function g(t,r){t.getRGB(oo,Ui(e)),n.buffers.color.setClear(oo.r,oo.g,oo.b,r,a)}function _(){l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0),c!==void 0&&(c.geometry.dispose(),c.material.dispose(),c=void 0)}return{getClearColor:function(){return o},setClearColor:function(e,t=1){o.set(e),s=t,g(o,s)},getClearAlpha:function(){return s},setClearAlpha:function(e){s=e,g(o,s)},render:m,addToRenderList:h,dispose:_}}function uo(e,t){let n=e.getParameter(e.MAX_VERTEX_ATTRIBS),r={},i=f(null),a=i,o=!1;function s(n,r,i,s,c){let u=!1,f=d(n,s,i,r);a!==f&&(a=f,l(a.object)),u=p(n,s,i,c),u&&m(n,s,i,c),c!==null&&t.update(c,e.ELEMENT_ARRAY_BUFFER),(u||o)&&(o=!1,b(n,r,i,s),c!==null&&e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,t.get(c).buffer))}function c(){return e.createVertexArray()}function l(t){return e.bindVertexArray(t)}function u(t){return e.deleteVertexArray(t)}function d(e,t,n,i){let a=i.wireframe===!0,o=r[t.id];o===void 0&&(o={},r[t.id]=o);let s=e.isInstancedMesh===!0?e.id:0,l=o[s];l===void 0&&(l={},o[s]=l);let u=l[n.id];u===void 0&&(u={},l[n.id]=u);let d=u[a];return d===void 0&&(d=f(c()),u[a]=d),d}function f(e){let t=[],r=[],i=[];for(let e=0;e<n;e++)t[e]=0,r[e]=0,i[e]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:t,enabledAttributes:r,attributeDivisors:i,object:e,attributes:{},index:null}}function p(e,t,n,r){let i=a.attributes,o=t.attributes,s=0,c=n.getAttributes();for(let t in c)if(c[t].location>=0){let n=i[t],r=o[t];if(r===void 0&&(t===`instanceMatrix`&&e.instanceMatrix&&(r=e.instanceMatrix),t===`instanceColor`&&e.instanceColor&&(r=e.instanceColor)),n===void 0||n.attribute!==r||r&&n.data!==r.data)return!0;s++}return a.attributesNum!==s||a.index!==r}function m(e,t,n,r){let i={},o=t.attributes,s=0,c=n.getAttributes();for(let t in c)if(c[t].location>=0){let n=o[t];n===void 0&&(t===`instanceMatrix`&&e.instanceMatrix&&(n=e.instanceMatrix),t===`instanceColor`&&e.instanceColor&&(n=e.instanceColor));let r={};r.attribute=n,n&&n.data&&(r.data=n.data),i[t]=r,s++}a.attributes=i,a.attributesNum=s,a.index=r}function h(){let e=a.newAttributes;for(let t=0,n=e.length;t<n;t++)e[t]=0}function g(e){_(e,0)}function _(t,n){let r=a.newAttributes,i=a.enabledAttributes,o=a.attributeDivisors;r[t]=1,i[t]===0&&(e.enableVertexAttribArray(t),i[t]=1),o[t]!==n&&(e.vertexAttribDivisor(t,n),o[t]=n)}function v(){let t=a.newAttributes,n=a.enabledAttributes;for(let r=0,i=n.length;r<i;r++)n[r]!==t[r]&&(e.disableVertexAttribArray(r),n[r]=0)}function y(t,n,r,i,a,o,s){s===!0?e.vertexAttribIPointer(t,n,r,a,o):e.vertexAttribPointer(t,n,r,i,a,o)}function b(n,r,i,a){h();let o=a.attributes,s=i.getAttributes(),c=r.defaultAttributeValues;for(let r in s){let i=s[r];if(i.location>=0){let s=o[r];if(s===void 0&&(r===`instanceMatrix`&&n.instanceMatrix&&(s=n.instanceMatrix),r===`instanceColor`&&n.instanceColor&&(s=n.instanceColor)),s!==void 0){let r=s.normalized,o=s.itemSize,c=t.get(s);if(c===void 0)continue;let l=c.buffer,u=c.type,d=c.bytesPerElement,f=u===e.INT||u===e.UNSIGNED_INT||s.gpuType===1013;if(s.isInterleavedBufferAttribute){let t=s.data,c=t.stride,p=s.offset;if(t.isInstancedInterleavedBuffer){for(let e=0;e<i.locationSize;e++)_(i.location+e,t.meshPerAttribute);n.isInstancedMesh!==!0&&a._maxInstanceCount===void 0&&(a._maxInstanceCount=t.meshPerAttribute*t.count)}else for(let e=0;e<i.locationSize;e++)g(i.location+e);e.bindBuffer(e.ARRAY_BUFFER,l);for(let e=0;e<i.locationSize;e++)y(i.location+e,o/i.locationSize,u,r,c*d,(p+o/i.locationSize*e)*d,f)}else{if(s.isInstancedBufferAttribute){for(let e=0;e<i.locationSize;e++)_(i.location+e,s.meshPerAttribute);n.isInstancedMesh!==!0&&a._maxInstanceCount===void 0&&(a._maxInstanceCount=s.meshPerAttribute*s.count)}else for(let e=0;e<i.locationSize;e++)g(i.location+e);e.bindBuffer(e.ARRAY_BUFFER,l);for(let e=0;e<i.locationSize;e++)y(i.location+e,o/i.locationSize,u,r,o*d,o/i.locationSize*e*d,f)}}else if(c!==void 0){let t=c[r];if(t!==void 0)switch(t.length){case 2:e.vertexAttrib2fv(i.location,t);break;case 3:e.vertexAttrib3fv(i.location,t);break;case 4:e.vertexAttrib4fv(i.location,t);break;default:e.vertexAttrib1fv(i.location,t)}}}}v()}function x(){T();for(let e in r){let t=r[e];for(let e in t){let n=t[e];for(let e in n){let t=n[e];for(let e in t)u(t[e].object),delete t[e];delete n[e]}}delete r[e]}}function S(e){if(r[e.id]===void 0)return;let t=r[e.id];for(let e in t){let n=t[e];for(let e in n){let t=n[e];for(let e in t)u(t[e].object),delete t[e];delete n[e]}}delete r[e.id]}function C(e){for(let t in r){let n=r[t];for(let t in n){let r=n[t];if(r[e.id]===void 0)continue;let i=r[e.id];for(let e in i)u(i[e].object),delete i[e];delete r[e.id]}}}function w(e){for(let t in r){let n=r[t],i=e.isInstancedMesh===!0?e.id:0,a=n[i];if(a!==void 0){for(let e in a){let t=a[e];for(let e in t)u(t[e].object),delete t[e];delete a[e]}delete n[i],Object.keys(n).length===0&&delete r[t]}}}function T(){E(),o=!0,a!==i&&(a=i,l(a.object))}function E(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:s,reset:T,resetDefaultState:E,dispose:x,releaseStatesOfGeometry:S,releaseStatesOfObject:w,releaseStatesOfProgram:C,initAttributes:h,enableAttribute:g,disableUnusedAttributes:v}}function fo(e,t,n){let r;function i(e){r=e}function a(t,i){e.drawArrays(r,t,i),n.update(i,r,1)}function o(t,i,a){a!==0&&(e.drawArraysInstanced(r,t,i,a),n.update(i,r,a))}function s(e,i,a){if(a===0)return;t.get(`WEBGL_multi_draw`).multiDrawArraysWEBGL(r,e,0,i,0,a);let o=0;for(let e=0;e<a;e++)o+=i[e];n.update(o,r,1)}this.setMode=i,this.render=a,this.renderInstances=o,this.renderMultiDraw=s}function po(e,t,n,r){let i;function a(){if(i!==void 0)return i;if(t.has(`EXT_texture_filter_anisotropic`)===!0){let n=t.get(`EXT_texture_filter_anisotropic`);i=e.getParameter(n.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function o(t){return t===1023||r.convert(t)===e.getParameter(e.IMPLEMENTATION_COLOR_READ_FORMAT)}function s(n){let i=n===1016&&(t.has(`EXT_color_buffer_half_float`)||t.has(`EXT_color_buffer_float`));return!(n!==1009&&n!==1015&&!i&&r.convert(n)!==e.getParameter(e.IMPLEMENTATION_COLOR_READ_TYPE))}function c(t){if(t===`highp`){if(e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.HIGH_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.HIGH_FLOAT).precision>0)return`highp`;t=`mediump`}return t===`mediump`&&e.getShaderPrecisionFormat(e.VERTEX_SHADER,e.MEDIUM_FLOAT).precision>0&&e.getShaderPrecisionFormat(e.FRAGMENT_SHADER,e.MEDIUM_FLOAT).precision>0?`mediump`:`lowp`}let l=n.precision===void 0?`highp`:n.precision,u=c(l);u!==l&&(K(`WebGLRenderer:`,l,`not supported, using`,u,`instead.`),l=u);let d=n.logarithmicDepthBuffer===!0,f=n.reversedDepthBuffer===!0&&t.has(`EXT_clip_control`);n.reversedDepthBuffer===!0&&f===!1&&K(`WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.`);let p=e.getParameter(e.MAX_TEXTURE_IMAGE_UNITS),m=e.getParameter(e.MAX_VERTEX_TEXTURE_IMAGE_UNITS),h=e.getParameter(e.MAX_TEXTURE_SIZE),g=e.getParameter(e.MAX_CUBE_MAP_TEXTURE_SIZE),_=e.getParameter(e.MAX_VERTEX_ATTRIBS),v=e.getParameter(e.MAX_VERTEX_UNIFORM_VECTORS),y=e.getParameter(e.MAX_VARYING_VECTORS),b=e.getParameter(e.MAX_FRAGMENT_UNIFORM_VECTORS),x=e.getParameter(e.MAX_SAMPLES),S=e.getParameter(e.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:a,getMaxPrecision:c,textureFormatReadable:o,textureTypeReadable:s,precision:l,logarithmicDepthBuffer:d,reversedDepthBuffer:f,maxTextures:p,maxVertexTextures:m,maxTextureSize:h,maxCubemapSize:g,maxAttributes:_,maxVertexUniforms:v,maxVaryings:y,maxFragmentUniforms:b,maxSamples:x,samples:S}}function mo(e){let t=this,n=null,r=0,i=!1,a=!1,o=new Cr,s=new Z,c={value:null,needsUpdate:!1};this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(e,t){let n=e.length!==0||t||r!==0||i;return i=t,r=e.length,n},this.beginShadows=function(){a=!0,u(null)},this.endShadows=function(){a=!1},this.setGlobalState=function(e,t){n=u(e,t,0)},this.setState=function(t,o,s){let d=t.clippingPlanes,f=t.clipIntersection,p=t.clipShadows,m=e.get(t);if(!i||d===null||d.length===0||a&&!p)a?u(null):l();else{let e=a?0:r,t=e*4,i=m.clippingState||null;c.value=i,i=u(d,o,t,s);for(let e=0;e!==t;++e)i[e]=n[e];m.clippingState=i,this.numIntersection=f?this.numPlanes:0,this.numPlanes+=e}};function l(){c.value!==n&&(c.value=n,c.needsUpdate=r>0),t.numPlanes=r,t.numIntersection=0}function u(e,n,r,i){let a=e===null?0:e.length,l=null;if(a!==0){if(l=c.value,i!==!0||l===null){let t=r+a*4,i=n.matrixWorldInverse;s.getNormalMatrix(i),(l===null||l.length<t)&&(l=new Float32Array(t));for(let t=0,n=r;t!==a;++t,n+=4)o.copy(e[t]).applyMatrix4(i,s),o.normal.toArray(l,n),l[n+3]=o.constant}c.value=l,c.needsUpdate=!0}return t.numPlanes=a,t.numIntersection=0,l}}var ho=4,go=6,_o=20,vo=256,yo=new Pa,bo=new Q,xo=null,So=0,Co=0,wo=!1,To=new X,Eo=new X,Do=class{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._sizeLods=[],this._lodMeshes=[],this._backgroundBox=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null}fromScene(e,t=0,n=.1,r=100,i={}){let{size:a=256,position:o=To}=i;xo=this._renderer.getRenderTarget(),So=this._renderer.getActiveCubeFace(),Co=this._renderer.getActiveMipmapLevel(),wo=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(a);let s=this._allocateTargets();return s.depthBuffer=!0,this._sceneToCubeUV(e,n,r,s,o),t>0&&this._blur(s,0,0,t),this._applyPMREM(s),this._cleanup(s),s}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=Po(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=No(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose(),this._backgroundBox!==null&&(this._backgroundBox.geometry.dispose(),this._backgroundBox.material.dispose())}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=2**this._lodMax}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._ggxMaterial!==null&&this._ggxMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodMeshes.length;e++)this._lodMeshes[e].geometry.dispose()}_cleanup(e){this._renderer.setRenderTarget(xo,So,Co),this._renderer.xr.enabled=wo,e.scissorTest=!1,Ao(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===301||e.mapping===302?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),xo=this._renderer.getRenderTarget(),So=this._renderer.getActiveCubeFace(),Co=this._renderer.getActiveMipmapLevel(),wo=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;let n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){let e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:y,minFilter:y,generateMipmaps:!1,type:k,format:L,colorSpace:We,depthBuffer:!1},r=ko(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=ko(e,t,n);let{_lodMax:r}=this;({lodMeshes:this._lodMeshes,sizeLods:this._sizeLods}=Oo(r)),this._blurMaterial=Mo(r,e,t),this._ggxMaterial=jo(r,e,t)}return r}_compileMaterial(e){let t=new ai(new gr,e);this._renderer.compile(t,yo)}_sceneToCubeUV(e,t,n,r,i){let a=new ja(90,1,t,n),o=[1,-1,1,1,1,1],s=[1,1,1,-1,-1,-1],c=this._renderer,l=c.autoClear,u=c.toneMapping;c.getClearColor(bo),c.toneMapping=0,c.autoClear=!1,c.state.buffers.depth.getReversed()&&(c.setRenderTarget(r),c.clearDepth(),c.setRenderTarget(null)),this._backgroundBox===null&&(this._backgroundBox=new ai(new Ni,new qr({name:`PMREM.Background`,side:1,depthWrite:!1,depthTest:!1})));let d=this._backgroundBox,f=d.material,p=!1,m=e.background;m?m.isColor&&(f.color.copy(m),e.background=null,p=!0):(f.color.copy(bo),p=!0);for(let t=0;t<6;t++){let n=t%3;n===0?(a.up.set(0,o[t],0),a.position.set(i.x,i.y,i.z),a.lookAt(i.x+s[t],i.y,i.z)):n===1?(a.up.set(0,0,o[t]),a.position.set(i.x,i.y,i.z),a.lookAt(i.x,i.y+s[t],i.z)):(a.up.set(0,o[t],0),a.position.set(i.x,i.y,i.z),a.lookAt(i.x,i.y,i.z+s[t]));let l=this._cubeSize;Ao(r,n*l,t>2?l:0,l,l),c.setRenderTarget(r),p&&c.render(d,a),c.render(e,a)}c.toneMapping=u,c.autoClear=l,e.background=m}_textureToCubeUV(e,t){let n=this._renderer,r=e.mapping===301||e.mapping===302;r?(this._cubemapMaterial===null&&(this._cubemapMaterial=Po()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=No());let i=r?this._cubemapMaterial:this._equirectMaterial,a=this._lodMeshes[0];a.material=i;let o=i.uniforms;o.envMap.value=e;let s=this._cubeSize;Ao(t,0,0,3*s,2*s),n.setRenderTarget(t),n.render(a,yo)}_applyPMREM(e){let t=this._renderer,n=t.autoClear;t.autoClear=!1;let r=this._lodMeshes.length;for(let t=1;t<r;t++)this._applyGGXFilter(e,t-1,t);t.autoClear=n}_applyGGXFilter(e,t,n){let r=this._renderer,i=this._pingPongRenderTarget,a=this._ggxMaterial,o=this._lodMeshes[n];o.material=a;let s=a.uniforms,c=n/(this._lodMeshes.length-1),l=t/(this._lodMeshes.length-1),u=Math.sqrt(c*c-l*l)*(c*1.25),{_lodMax:d}=this,f=this._sizeLods[n],p=3*f*(n>d-ho?n-d+ho:0),m=4*(this._cubeSize-f);s.envMap.value=e.texture,s.roughness.value=u,s.mipInt.value=d-t,Ao(i,p,m,3*f,2*f),r.setRenderTarget(i),r.render(o,yo),s.envMap.value=i.texture,s.roughness.value=0,s.mipInt.value=d-n,Ao(e,p,m,3*f,2*f),r.setRenderTarget(e),r.render(o,yo)}_blur(e,t,n,r){let i=this._pingPongRenderTarget,a=Math.min(r,Math.PI)/Math.SQRT2;this._blurPass(e,i,t,n,a),this._blurPass(i,e,n,n,a)}_blurPass(e,t,n,r,i){let a=this._renderer,o=this._blurMaterial,s=this._lodMeshes[r];s.material=o;let c=o.uniforms;c.envMap.value=e.texture,c.sigma.value=i,c.mipInt.value=this._lodMax-n;let l=this._sizeLods[r];Ao(t,3*l*(r>this._lodMax-ho?r-this._lodMax+ho:0),4*(this._cubeSize-l),3*l,2*l),a.setRenderTarget(t),a.render(s,yo)}};function Oo(e){let t=[],n=[],r=e,i=e-ho+1+go;for(let e=0;e<i;e++){let e=2**r;t.push(e);let i=1/(e-2),a=-i,o=1+i,s=[a,a,o,a,o,o,a,a,o,o,a,o],c=new Float32Array(108),l=new Float32Array(108);for(let e=0;e<6;e++){let t=e%3*2/3-1,n=e>2?0:-1,r=[t,n,0,t+2/3,n,0,t+2/3,n+1,0,t,n,0,t+2/3,n+1,0,t,n+1,0];c.set(r,18*e);for(let t=0;t<6;t++){let n=s[t*2]*2-1,r=s[t*2+1]*2-1;e===0?Eo.set(1,r,n):e===1?Eo.set(-n,1,-r):e===2?Eo.set(-n,r,1):e===3?Eo.set(-1,r,-n):e===4?Eo.set(-n,-1,r):Eo.set(n,r,-1),Eo.toArray(l,(e*6+t)*3)}}let u=new gr;u.setAttribute(`position`,new tr(c,3)),u.setAttribute(`outputDirection`,new tr(l,3)),n.push(new ai(u,null)),r>ho&&r--}return{lodMeshes:n,sizeLods:t}}function ko(e,t,n){let r=new It(e,t,n);return r.texture.mapping=306,r.texture.name=`PMREM.cubeUv`,r.scissorTest=!0,r}function Ao(e,t,n,r,i){e.viewport.set(t,n,r,i),e.scissor.set(t,n,r,i)}function jo(e,t,n){return new qi({name:`PMREMGGXConvolution`,defines:{GGX_SAMPLES:vo,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},roughness:{value:0},mipInt:{value:0}},vertexShader:Fo(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float roughness;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359

			// Van der Corput radical inverse
			float radicalInverse_VdC(uint bits) {
				bits = (bits << 16u) | (bits >> 16u);
				bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
				bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
				bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
				bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
				return float(bits) * 2.3283064365386963e-10; // / 0x100000000
			}

			// Hammersley sequence
			vec2 hammersley(uint i, uint N) {
				return vec2(float(i) / float(N), radicalInverse_VdC(i));
			}

			// GGX VNDF importance sampling (Eric Heitz 2018)
			// "Sampling the GGX Distribution of Visible Normals"
			// https://jcgt.org/published/0007/04/01/
			vec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {
				float alpha = roughness * roughness;

				// Section 4.1: Orthonormal basis
				vec3 T1 = vec3(1.0, 0.0, 0.0);
				vec3 T2 = cross(V, T1);

				// Section 4.2: Parameterization of projected area
				float r = sqrt(Xi.x);
				float phi = 2.0 * PI * Xi.y;
				float t1 = r * cos(phi);
				float t2 = r * sin(phi);
				float s = 0.5 * (1.0 + V.z);
				t2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;

				// Section 4.3: Reprojection onto hemisphere
				vec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;

				// Section 3.4: Transform back to ellipsoid configuration
				return normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));
			}

			void main() {
				vec3 N = normalize(vOutputDirection);
				vec3 V = N; // Assume view direction equals normal for pre-filtering

				vec3 prefilteredColor = vec3(0.0);
				float totalWeight = 0.0;

				// For very low roughness, just sample the environment directly
				if (roughness < 0.001) {
					gl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);
					return;
				}

				// Tangent space basis for VNDF sampling
				vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
				vec3 tangent = normalize(cross(up, N));
				vec3 bitangent = cross(N, tangent);

				for(uint i = 0u; i < uint(GGX_SAMPLES); i++) {
					vec2 Xi = hammersley(i, uint(GGX_SAMPLES));

					// For PMREM, V = N, so in tangent space V is always (0, 0, 1)
					vec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);

					// Transform H back to world space
					vec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);
					vec3 L = normalize(2.0 * dot(V, H) * H - V);

					float NdotL = max(dot(N, L), 0.0);

					if(NdotL > 0.0) {
						// Sample environment at fixed mip level
						// VNDF importance sampling handles the distribution filtering
						vec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);

						// Weight by NdotL for the split-sum approximation
						// VNDF PDF naturally accounts for the visible microfacet distribution
						prefilteredColor += sampleColor * NdotL;
						totalWeight += NdotL;
					}
				}

				if (totalWeight > 0.0) {
					prefilteredColor = prefilteredColor / totalWeight;
				}

				gl_FragColor = vec4(prefilteredColor, 1.0);
			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function Mo(e,t,n){return new qi({name:`SphericalGaussianBlur`,defines:{SAMPLES:_o,CUBEUV_TEXEL_WIDTH:1/t,CUBEUV_TEXEL_HEIGHT:1/n,CUBEUV_MAX_MIP:`${e}.0`},uniforms:{envMap:{value:null},sigma:{value:0},mipInt:{value:0}},vertexShader:Fo(),fragmentShader:`

			precision highp float;
			precision highp int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform float sigma;
			uniform float mipInt;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			#define PI 3.14159265359
			#define GOLDEN_ANGLE 2.39996322973

			void main() {

				if ( sigma == 0.0 ) {

					gl_FragColor = vec4( bilinearCubeUV( envMap, vOutputDirection, mipInt ), 1.0 );
					return;

				}

				vec3 outputDirection = normalize( vOutputDirection );

				vec3 up = abs( outputDirection.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
				vec3 tangent = normalize( cross( up, outputDirection ) );
				vec3 bitangent = cross( outputDirection, tangent );

				// Truncate the kernel at three standard deviations or at the antipode.
				float thetaMax = min( 3.0 * sigma, PI );
				float truncation = 1.0 - exp( - 0.5 * thetaMax * thetaMax / ( sigma * sigma ) );

				vec3 accumColor = vec3( 0.0 );
				float accumWeight = 0.0;

				for ( int i = 0; i < SAMPLES; i ++ ) {

					// Stratified inverse-CDF sampling of the Gaussian, placed on a golden-angle spiral.
					float stratum = ( float( i ) + 0.5 ) / float( SAMPLES );
					float theta = sigma * sqrt( - 2.0 * log( 1.0 - stratum * truncation ) );
					float phi = float( i ) * GOLDEN_ANGLE;

					vec3 offset = cos( phi ) * tangent + sin( phi ) * bitangent;
					vec3 sampleDirection = cos( theta ) * outputDirection + sin( theta ) * offset;

					// Correct the planar sample density to solid angle.
					float weight = sin( theta ) / theta;

					accumColor += weight * bilinearCubeUV( envMap, sampleDirection, mipInt );
					accumWeight += weight;

				}

				gl_FragColor = vec4( accumColor / accumWeight, 1.0 );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function No(){return new qi({name:`EquirectangularToCubeUV`,uniforms:{envMap:{value:null}},vertexShader:Fo(),fragmentShader:`

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
		`,blending:0,depthTest:!1,depthWrite:!1})}function Po(){return new qi({name:`CubemapToCubeUV`,uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Fo(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:0,depthTest:!1,depthWrite:!1})}function Fo(){return`

		precision mediump float;
		precision mediump int;

		attribute vec3 outputDirection;

		varying vec3 vOutputDirection;

		void main() {

			vOutputDirection = outputDirection;
			gl_Position = vec4( position, 1.0 );

		}
	`}var Io=class extends It{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;let n={width:e,height:e,depth:1},r=[n,n,n,n,n,n];this.texture=new Oi(r),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;let n={uniforms:{tEquirect:{value:null}},vertexShader:`

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
			`},r=new Ni(5,5,5),i=new qi({name:`CubemapFromEquirect`,uniforms:zi(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:1,blending:0});i.uniforms.tEquirect.value=t;let a=new ai(r,i),o=t.minFilter;return t.minFilter===1008&&(t.minFilter=y),new Ba(1,10,this).update(e,a),t.minFilter=o,a.geometry.dispose(),a.material.dispose(),this}clear(e,t=!0,n=!0,r=!0){let i=e.getRenderTarget();for(let i=0;i<6;i++)e.setRenderTarget(this,i),e.clear(t,n,r);e.setRenderTarget(i)}};function Lo(e){let t=new WeakMap,n=new WeakMap,r=null;function i(e,t=!1){return e==null?null:t?o(e):a(e)}function a(n){if(n&&n.isTexture){let r=n.mapping;if(r===303||r===304){if(t.has(n)){let e=t.get(n).texture;return s(e,n.mapping)}{let r=n.image;if(r&&r.height>0){let i=new Io(r.height);return i.fromEquirectangularTexture(e,n),t.set(n,i),n.addEventListener(`dispose`,l),s(i.texture,n.mapping)}return null}}}return n}function o(t){if(t&&t.isTexture){let i=t.mapping,a=i===303||i===304,o=i===301||i===302;if(a||o){let i=n.get(t),s=i===void 0?0:i.texture.pmremVersion;if(t.isRenderTargetTexture&&t.pmremVersion!==s)return r===null&&(r=new Do(e)),i=a?r.fromEquirectangular(t,i):r.fromCubemap(t,i),i.texture.pmremVersion=t.pmremVersion,n.set(t,i),i.texture;if(i!==void 0)return i.texture;{let s=t.image;return a&&s&&s.height>0||o&&s&&c(s)?(r===null&&(r=new Do(e)),i=a?r.fromEquirectangular(t):r.fromCubemap(t),i.texture.pmremVersion=t.pmremVersion,n.set(t,i),t.addEventListener(`dispose`,u),i.texture):null}}}return t}function s(e,t){return t===303?e.mapping=301:t===304&&(e.mapping=302),e}function c(e){let t=0;for(let n=0;n<6;n++)e[n]!==void 0&&t++;return t===6}function l(e){let n=e.target;n.removeEventListener(`dispose`,l);let r=t.get(n);r!==void 0&&(t.delete(n),r.dispose())}function u(e){let t=e.target;t.removeEventListener(`dispose`,u);let r=n.get(t);r!==void 0&&(n.delete(t),r.dispose())}function d(){t=new WeakMap,n=new WeakMap,r!==null&&(r.dispose(),r=null)}return{get:i,dispose:d}}function Ro(e){let t={};function n(n){if(t[n]!==void 0)return t[n];let r=e.getExtension(n);return t[n]=r,r}return{has:function(e){return n(e)!==null},init:function(){n(`EXT_color_buffer_float`),n(`WEBGL_clip_cull_distance`),n(`OES_texture_float_linear`),n(`EXT_color_buffer_half_float`),n(`WEBGL_multisampled_render_to_texture`),n(`WEBGL_render_shared_exponent`)},get:function(e){let t=n(e);return t===null&&it(`WebGLRenderer: `+e+` extension not supported.`),t}}}function zo(e,t,n,r){let i={},a=new WeakMap;function o(e){let s=e.target;s.index!==null&&t.remove(s.index);for(let e in s.attributes)t.remove(s.attributes[e]);s.removeEventListener(`dispose`,o),delete i[s.id];let c=a.get(s);c&&(t.remove(c),a.delete(s)),r.releaseStatesOfGeometry(s),s.isInstancedBufferGeometry===!0&&delete s._maxInstanceCount,n.memory.geometries--}function s(e,t){return i[t.id]===!0?t:(t.addEventListener(`dispose`,o),i[t.id]=!0,n.memory.geometries++,t)}function c(n){let r=n.attributes;for(let n in r)t.update(r[n],e.ARRAY_BUFFER)}function l(e){let n=[],r=e.index,i=e.attributes.position,o=0;if(i===void 0)return;if(r!==null){let e=r.array;o=r.version;for(let t=0,r=e.length;t<r;t+=3){let r=e[t+0],i=e[t+1],a=e[t+2];n.push(r,i,i,a,a,r)}}else{let e=i.array;o=i.version;for(let t=0,r=e.length/3-1;t<r;t+=3){let e=t+0,r=t+1,i=t+2;n.push(e,r,r,i,i,e)}}let s=new(i.count>=65535?rr:nr)(n,1);s.version=o;let c=a.get(e);c&&t.remove(c),a.set(e,s)}function u(e){let t=a.get(e);if(t){let n=e.index;n!==null&&t.version<n.version&&l(e)}else l(e);return a.get(e)}return{get:s,update:c,getWireframeAttribute:u}}function Bo(e,t,n){let r;function i(e){r=e}let a,o;function s(e){a=e.type,o=e.bytesPerElement}function c(t,i){e.drawElements(r,i,a,t*o),n.update(i,r,1)}function l(t,i,s){s!==0&&(e.drawElementsInstanced(r,i,a,t*o,s),n.update(i,r,s))}function u(e,i,o){if(o===0)return;t.get(`WEBGL_multi_draw`).multiDrawElementsWEBGL(r,i,0,a,e,0,o);let s=0;for(let e=0;e<o;e++)s+=i[e];n.update(s,r,1)}this.setMode=i,this.setIndex=s,this.render=c,this.renderInstances=l,this.renderMultiDraw=u}function Vo(e){let t={geometries:0,textures:0},n={frame:0,calls:0,triangles:0,points:0,lines:0};function r(t,r,i){switch(n.calls++,r){case e.TRIANGLES:n.triangles+=t/3*i;break;case e.LINES:n.lines+=t/2*i;break;case e.LINE_STRIP:n.lines+=i*(t-1);break;case e.LINE_LOOP:n.lines+=i*t;break;case e.POINTS:n.points+=i*t;break;default:q(`WebGLInfo: Unknown draw mode:`,r)}}function i(){n.calls=0,n.triangles=0,n.points=0,n.lines=0}return{memory:t,render:n,programs:null,autoReset:!0,reset:i,update:r}}function Ho(e,t,n){let r=new WeakMap,i=new Pt;function a(a,o,s){let c=a.morphTargetInfluences,l=o.morphAttributes.position||o.morphAttributes.normal||o.morphAttributes.color,u=l===void 0?0:l.length,d=r.get(o);if(d===void 0||d.count!==u){d!==void 0&&d.texture.dispose();let e=o.morphAttributes.position!==void 0,n=o.morphAttributes.normal!==void 0,a=o.morphAttributes.color!==void 0,s=o.morphAttributes.position||[],c=o.morphAttributes.normal||[],l=o.morphAttributes.color||[],f=0;e===!0&&(f=1),n===!0&&(f=2),a===!0&&(f=3);let p=o.attributes.position.count*f,m=1;p>t.maxTextureSize&&(m=Math.ceil(p/t.maxTextureSize),p=t.maxTextureSize);let h=new Float32Array(p*m*4*u),g=new Lt(h,p,m,u);g.type=O,g.needsUpdate=!0;let _=f*4;for(let t=0;t<u;t++){let r=s[t],o=c[t],u=l[t],d=p*m*4*t;for(let t=0;t<r.count;t++){let s=t*_;e===!0&&(i.fromBufferAttribute(r,t),h[d+s+0]=i.x,h[d+s+1]=i.y,h[d+s+2]=i.z,h[d+s+3]=0),n===!0&&(i.fromBufferAttribute(o,t),h[d+s+4]=i.x,h[d+s+5]=i.y,h[d+s+6]=i.z,h[d+s+7]=0),a===!0&&(i.fromBufferAttribute(u,t),h[d+s+8]=i.x,h[d+s+9]=i.y,h[d+s+10]=i.z,h[d+s+11]=u.itemSize===4?i.w:1)}}d={count:u,texture:g,size:new Y(p,m)},r.set(o,d);function v(){g.dispose(),r.delete(o),o.removeEventListener(`dispose`,v)}o.addEventListener(`dispose`,v)}if(a.isInstancedMesh===!0&&a.morphTexture!==null)s.getUniforms().setValue(e,`morphTexture`,a.morphTexture,n);else{let t=0;for(let e=0;e<c.length;e++)t+=c[e];let n=o.morphTargetsRelative?1:1-t;s.getUniforms().setValue(e,`morphTargetBaseInfluence`,n),s.getUniforms().setValue(e,`morphTargetInfluences`,c)}s.getUniforms().setValue(e,`morphTargetsTexture`,d.texture,n),s.getUniforms().setValue(e,`morphTargetsTextureSize`,d.size)}return{update:a}}function Uo(e,t,n,r,i){let a=new WeakMap;function o(r){let o=i.render.frame,s=r.geometry,l=t.get(r,s);if(a.get(l)!==o&&(t.update(l),a.set(l,o)),r.isInstancedMesh&&(r.hasEventListener(`dispose`,c)===!1&&r.addEventListener(`dispose`,c),a.get(r)!==o&&(n.update(r.instanceMatrix,e.ARRAY_BUFFER),r.instanceColor!==null&&n.update(r.instanceColor,e.ARRAY_BUFFER),a.set(r,o))),r.isSkinnedMesh){let e=r.skeleton;a.get(e)!==o&&(e.update(),a.set(e,o))}return l}function s(){a=new WeakMap}function c(e){let t=e.target;t.removeEventListener(`dispose`,c),r.releaseStatesOfObject(t),n.remove(t.instanceMatrix),t.instanceColor!==null&&n.remove(t.instanceColor)}return{update:o,dispose:s}}var Wo={1:`LINEAR_TONE_MAPPING`,2:`REINHARD_TONE_MAPPING`,3:`CINEON_TONE_MAPPING`,4:`ACES_FILMIC_TONE_MAPPING`,6:`AGX_TONE_MAPPING`,7:`NEUTRAL_TONE_MAPPING`,5:`CUSTOM_TONE_MAPPING`};function Go(e,t,n,r,i,a){let o=new It(t,n,{type:e,depthBuffer:i,stencilBuffer:a,samples:r?4:0,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,resolveDepthBuffer:!1,resolveStencilBuffer:!1}),s=null,c=null,l=new gr;l.setAttribute(`position`,new ir([-1,3,0,-1,-1,0,3,-1,0],3)),l.setAttribute(`uv`,new ir([0,2,0,0,2,0],2));let u=new Ji({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),d=new ai(l,u),f=new Pa(-1,1,1,-1,0,1),p=null,m=null,h=!1,g,_=null,v=[],y=!1;this.setSize=function(e,t){o.setSize(e,t),s!==null&&s.setSize(e,t),c!==null&&c.setSize(e,t);for(let n=0;n<v.length;n++){let r=v[n];r.setSize&&r.setSize(e,t)}},this.setEffects=function(e){v=e,y=v.length>0&&v[0].isRenderPass===!0;let t=o.width,n=o.height;v.length>0&&s===null&&(s=new It(t,n,{type:k,depthBuffer:!1,stencilBuffer:!1}),c=new It(t,n,{type:k,depthBuffer:!1,stencilBuffer:!1}));for(let e=0;e<v.length;e++){let r=v[e];r.setSize&&r.setSize(t,n)}},this.begin=function(e,t){if(h||e.toneMapping===0&&v.length===0)return!1;if(_=t,t!==null){let e=t.width,n=t.height;(o.width!==e||o.height!==n)&&this.setSize(e,n)}return y===!1&&e.setRenderTarget(o),g=e.toneMapping,e.toneMapping=0,!0},this.hasRenderPass=function(){return y},this.end=function(e,t){e.toneMapping=g,h=!0;let n=o,r=s;for(let i=0;i<v.length;i++){let a=v[i];a.enabled!==!1&&(a.render(e,r,n,t),a.needsSwap!==!1&&(n=r,r=r===s?c:s))}if(p!==e.outputColorSpace||m!==e.toneMapping){p=e.outputColorSpace,m=e.toneMapping,u.defines={},Ct.getTransfer(p)===`srgb`&&(u.defines.SRGB_TRANSFER=``);let t=Wo[m];t&&(u.defines[t]=``),u.needsUpdate=!0}u.uniforms.tDiffuse.value=n.texture,e.setRenderTarget(_),e.render(d,f),_=null,h=!1},this.isCompositing=function(){return h},this.dispose=function(){o.dispose(),s!==null&&s.dispose(),c!==null&&c.dispose(),l.dispose(),u.dispose()}}var Ko=new Nt,qo=new Ai(1,1),Jo=new Lt,Yo=new Rt,Xo=new Oi,Zo=[],Qo=[],$o=new Float32Array(16),es=new Float32Array(9),ts=new Float32Array(4);function ns(e,t,n){let r=e[0];if(r<=0||r>0)return e;let i=t*n,a=Zo[i];if(a===void 0&&(a=new Float32Array(i),Zo[i]=a),t!==0){r.toArray(a,0);for(let r=1,i=0;r!==t;++r)i+=n,e[r].toArray(a,i)}return a}function rs(e,t){if(e.length!==t.length)return!1;for(let n=0,r=e.length;n<r;n++)if(e[n]!==t[n])return!1;return!0}function is(e,t){for(let n=0,r=t.length;n<r;n++)e[n]=t[n]}function as(e,t){let n=Qo[t];n===void 0&&(n=new Int32Array(t),Qo[t]=n);for(let r=0;r!==t;++r)n[r]=e.allocateTextureUnit();return n}function os(e,t){let n=this.cache;n[0]!==t&&(e.uniform1f(this.addr,t),n[0]=t)}function ss(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2f(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(rs(n,t))return;e.uniform2fv(this.addr,t),is(n,t)}}function cs(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3f(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else if(t.r!==void 0)(n[0]!==t.r||n[1]!==t.g||n[2]!==t.b)&&(e.uniform3f(this.addr,t.r,t.g,t.b),n[0]=t.r,n[1]=t.g,n[2]=t.b);else{if(rs(n,t))return;e.uniform3fv(this.addr,t),is(n,t)}}function ls(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4f(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(rs(n,t))return;e.uniform4fv(this.addr,t),is(n,t)}}function us(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(rs(n,t))return;e.uniformMatrix2fv(this.addr,!1,t),is(n,t)}else{if(rs(n,r))return;ts.set(r),e.uniformMatrix2fv(this.addr,!1,ts),is(n,r)}}function ds(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(rs(n,t))return;e.uniformMatrix3fv(this.addr,!1,t),is(n,t)}else{if(rs(n,r))return;es.set(r),e.uniformMatrix3fv(this.addr,!1,es),is(n,r)}}function fs(e,t){let n=this.cache,r=t.elements;if(r===void 0){if(rs(n,t))return;e.uniformMatrix4fv(this.addr,!1,t),is(n,t)}else{if(rs(n,r))return;$o.set(r),e.uniformMatrix4fv(this.addr,!1,$o),is(n,r)}}function ps(e,t){let n=this.cache;n[0]!==t&&(e.uniform1i(this.addr,t),n[0]=t)}function ms(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2i(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(rs(n,t))return;e.uniform2iv(this.addr,t),is(n,t)}}function hs(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3i(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else{if(rs(n,t))return;e.uniform3iv(this.addr,t),is(n,t)}}function gs(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4i(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(rs(n,t))return;e.uniform4iv(this.addr,t),is(n,t)}}function _s(e,t){let n=this.cache;n[0]!==t&&(e.uniform1ui(this.addr,t),n[0]=t)}function vs(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y)&&(e.uniform2ui(this.addr,t.x,t.y),n[0]=t.x,n[1]=t.y);else{if(rs(n,t))return;e.uniform2uiv(this.addr,t),is(n,t)}}function ys(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z)&&(e.uniform3ui(this.addr,t.x,t.y,t.z),n[0]=t.x,n[1]=t.y,n[2]=t.z);else{if(rs(n,t))return;e.uniform3uiv(this.addr,t),is(n,t)}}function bs(e,t){let n=this.cache;if(t.x!==void 0)(n[0]!==t.x||n[1]!==t.y||n[2]!==t.z||n[3]!==t.w)&&(e.uniform4ui(this.addr,t.x,t.y,t.z,t.w),n[0]=t.x,n[1]=t.y,n[2]=t.z,n[3]=t.w);else{if(rs(n,t))return;e.uniform4uiv(this.addr,t),is(n,t)}}function xs(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i);let a;this.type===e.SAMPLER_2D_SHADOW?(qo.compareFunction=n.isReversedDepthBuffer()?518:515,a=qo):a=Ko,n.setTexture2D(t||a,i)}function Ss(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTexture3D(t||Yo,i)}function Cs(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTextureCube(t||Xo,i)}function ws(e,t,n){let r=this.cache,i=n.allocateTextureUnit();r[0]!==i&&(e.uniform1i(this.addr,i),r[0]=i),n.setTexture2DArray(t||Jo,i)}function Ts(e){switch(e){case 5126:return os;case 35664:return ss;case 35665:return cs;case 35666:return ls;case 35674:return us;case 35675:return ds;case 35676:return fs;case 5124:case 35670:return ps;case 35667:case 35671:return ms;case 35668:case 35672:return hs;case 35669:case 35673:return gs;case 5125:return _s;case 36294:return vs;case 36295:return ys;case 36296:return bs;case 35678:case 36198:case 36298:case 36306:case 35682:return xs;case 35679:case 36299:case 36307:return Ss;case 35680:case 36300:case 36308:case 36293:return Cs;case 36289:case 36303:case 36311:case 36292:return ws}}function Es(e,t){e.uniform1fv(this.addr,t)}function Ds(e,t){let n=ns(t,this.size,2);e.uniform2fv(this.addr,n)}function Os(e,t){let n=ns(t,this.size,3);e.uniform3fv(this.addr,n)}function ks(e,t){let n=ns(t,this.size,4);e.uniform4fv(this.addr,n)}function As(e,t){let n=ns(t,this.size,4);e.uniformMatrix2fv(this.addr,!1,n)}function js(e,t){let n=ns(t,this.size,9);e.uniformMatrix3fv(this.addr,!1,n)}function Ms(e,t){let n=ns(t,this.size,16);e.uniformMatrix4fv(this.addr,!1,n)}function Ns(e,t){e.uniform1iv(this.addr,t)}function Ps(e,t){e.uniform2iv(this.addr,t)}function Fs(e,t){e.uniform3iv(this.addr,t)}function Is(e,t){e.uniform4iv(this.addr,t)}function Ls(e,t){e.uniform1uiv(this.addr,t)}function Rs(e,t){e.uniform2uiv(this.addr,t)}function zs(e,t){e.uniform3uiv(this.addr,t)}function Bs(e,t){e.uniform4uiv(this.addr,t)}function Vs(e,t,n){let r=this.cache,i=t.length,a=as(n,i);rs(r,a)||(e.uniform1iv(this.addr,a),is(r,a));let o;o=this.type===e.SAMPLER_2D_SHADOW?qo:Ko;for(let e=0;e!==i;++e)n.setTexture2D(t[e]||o,a[e])}function Hs(e,t,n){let r=this.cache,i=t.length,a=as(n,i);rs(r,a)||(e.uniform1iv(this.addr,a),is(r,a));for(let e=0;e!==i;++e)n.setTexture3D(t[e]||Yo,a[e])}function Us(e,t,n){let r=this.cache,i=t.length,a=as(n,i);rs(r,a)||(e.uniform1iv(this.addr,a),is(r,a));for(let e=0;e!==i;++e)n.setTextureCube(t[e]||Xo,a[e])}function Ws(e,t,n){let r=this.cache,i=t.length,a=as(n,i);rs(r,a)||(e.uniform1iv(this.addr,a),is(r,a));for(let e=0;e!==i;++e)n.setTexture2DArray(t[e]||Jo,a[e])}function Gs(e){switch(e){case 5126:return Es;case 35664:return Ds;case 35665:return Os;case 35666:return ks;case 35674:return As;case 35675:return js;case 35676:return Ms;case 5124:case 35670:return Ns;case 35667:case 35671:return Ps;case 35668:case 35672:return Fs;case 35669:case 35673:return Is;case 5125:return Ls;case 36294:return Rs;case 36295:return zs;case 36296:return Bs;case 35678:case 36198:case 36298:case 36306:case 35682:return Vs;case 35679:case 36299:case 36307:return Hs;case 35680:case 36300:case 36308:case 36293:return Us;case 36289:case 36303:case 36311:case 36292:return Ws}}var Ks=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=Ts(t.type)}},qs=class{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=Gs(t.type)}},Js=class{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){let r=this.seq;for(let i=0,a=r.length;i!==a;++i){let a=r[i];a.setValue(e,t[a.id],n)}}},Ys=/(\w+)(\])?(\[|\.)?/g;function Xs(e,t){e.seq.push(t),e.map[t.id]=t}function Zs(e,t,n){let r=e.name,i=r.length;for(Ys.lastIndex=0;;){let a=Ys.exec(r),o=Ys.lastIndex,s=a[1],c=a[2]===`]`,l=a[3];if(c&&(s|=0),l===void 0||l===`[`&&o+2===i){Xs(n,l===void 0?new Ks(s,e,t):new qs(s,e,t));break}{let e=n.map[s];e===void 0&&(e=new Js(s),Xs(n,e)),n=e}}}var Qs=class{constructor(e,t){this.seq=[],this.map={};let n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let r=0;r<n;++r){let n=e.getActiveUniform(t,r);Zs(n,e.getUniformLocation(t,n.name),this)}let r=[],i=[];for(let t of this.seq)t.type===e.SAMPLER_2D_SHADOW||t.type===e.SAMPLER_CUBE_SHADOW||t.type===e.SAMPLER_2D_ARRAY_SHADOW?r.push(t):i.push(t);r.length>0&&(this.seq=r.concat(i))}setValue(e,t,n,r){let i=this.map[t];i!==void 0&&i.setValue(e,n,r)}setOptional(e,t,n){let r=t[n];r!==void 0&&this.setValue(e,n,r)}static upload(e,t,n,r){for(let i=0,a=t.length;i!==a;++i){let a=t[i],o=n[a.id];o.needsUpdate!==!1&&a.setValue(e,o.value,r)}}static seqWithValue(e,t){let n=[];for(let r=0,i=e.length;r!==i;++r){let i=e[r];i.id in t&&n.push(i)}return n}};function $s(e,t,n){let r=e.createShader(t);return e.shaderSource(r,n),e.compileShader(r),r}var ec=37297,tc=0;function nc(e,t){let n=e.split(`
`),r=[],i=Math.max(t-6,0),a=Math.min(t+6,n.length);for(let e=i;e<a;e++){let i=e+1;r.push(`${i===t?`>`:` `} ${i}: ${n[e]}`)}return r.join(`
`)}var rc=new Z;function ic(e){Ct._getMatrix(rc,Ct.workingColorSpace,e);let t=`mat3( ${rc.elements.map(e=>e.toFixed(4))} )`;switch(Ct.getTransfer(e)){case Ge:return[t,`LinearTransferOETF`];case Ke:return[t,`sRGBTransferOETF`];default:return K(`WebGLProgram: Unsupported color space: `,e),[t,`LinearTransferOETF`]}}function ac(e,t,n){let r=e.getShaderParameter(t,e.COMPILE_STATUS),i=(e.getShaderInfoLog(t)||``).trim();if(r&&i===``)return``;let a=/ERROR: 0:(\d+)/.exec(i);if(a){let r=parseInt(a[1]);return n.toUpperCase()+`

`+i+`

`+nc(e.getShaderSource(t),r)}return i}function oc(e,t){let n=ic(t);return[`vec4 ${e}( vec4 value ) {`,`	return ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`,`}`].join(`
`)}var sc={1:`Linear`,2:`Reinhard`,3:`Cineon`,4:`ACESFilmic`,6:`AgX`,7:`Neutral`,5:`Custom`};function cc(e,t){let n=sc[t];return n===void 0?(K(`WebGLProgram: Unsupported toneMapping:`,t),`vec3 `+e+`( vec3 color ) { return LinearToneMapping( color ); }`):`vec3 `+e+`( vec3 color ) { return `+n+`ToneMapping( color ); }`}var lc=new X;function uc(){return Ct.getLuminanceCoefficients(lc),[`float luminance( const in vec3 rgb ) {`,`	const vec3 weights = vec3( ${lc.x.toFixed(4)}, ${lc.y.toFixed(4)}, ${lc.z.toFixed(4)} );`,`	return dot( weights, rgb );`,`}`].join(`
`)}function dc(e){return[e.extensionClipCullDistance?`#extension GL_ANGLE_clip_cull_distance : require`:``,e.extensionMultiDraw?`#extension GL_ANGLE_multi_draw : require`:``].filter(mc).join(`
`)}function fc(e){let t=[];for(let n in e){let r=e[n];r!==!1&&t.push(`#define `+n+` `+r)}return t.join(`
`)}function pc(e,t){let n={},r=e.getProgramParameter(t,e.ACTIVE_ATTRIBUTES);for(let i=0;i<r;i++){let r=e.getActiveAttrib(t,i),a=r.name,o=1;r.type===e.FLOAT_MAT2&&(o=2),r.type===e.FLOAT_MAT3&&(o=3),r.type===e.FLOAT_MAT4&&(o=4),n[a]={type:r.type,location:e.getAttribLocation(t,a),locationSize:o}}return n}function mc(e){return e!==``}function hc(e,t){let n=t.numSpotLightShadows+t.numSpotLightMaps-t.numSpotLightShadowsWithMaps;return e.replace(/NUM_SUN_LIGHTS/g,t.numSunLights).replace(/NUM_DIR_LIGHTS/g,t.numDirLights).replace(/NUM_SPOT_LIGHTS/g,t.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,t.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,n).replace(/NUM_RECT_AREA_LIGHTS/g,t.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,t.numPointLights).replace(/NUM_HEMI_LIGHTS/g,t.numHemiLights).replace(/NUM_SUN_LIGHT_SHADOWS/g,t.numSunLightShadows).replace(/NUM_DIR_LIGHT_SHADOWS/g,t.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,t.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,t.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,t.numPointLightShadows)}function gc(e,t){return e.replace(/NUM_CLIPPING_PLANES/g,t.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,t.numClippingPlanes-t.numClipIntersection)}var _c=/^[ \t]*#include +<([\w\d./]+)>/gm;function vc(e){return e.replace(_c,bc)}var yc=new Map;function bc(e,t){let n=io[t];if(n===void 0){let e=yc.get(t);if(e!==void 0)n=io[e],K(`WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.`,t,e);else throw Error(`THREE.WebGLProgram: Can not resolve #include <`+t+`>`)}return vc(n)}var xc=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function Sc(e){return e.replace(xc,Cc)}function Cc(e,t,n,r){let i=``;for(let e=parseInt(t);e<parseInt(n);e++)i+=r.replace(/\[\s*i\s*\]/g,`[ `+e+` ]`).replace(/UNROLLED_LOOP_INDEX/g,e);return i}function wc(e){let t=`precision ${e.precision} float;
	precision ${e.precision} int;
	precision ${e.precision} sampler2D;
	precision ${e.precision} samplerCube;
	precision ${e.precision} sampler3D;
	precision ${e.precision} sampler2DArray;
	precision ${e.precision} sampler2DShadow;
	precision ${e.precision} samplerCubeShadow;
	precision ${e.precision} sampler2DArrayShadow;
	precision ${e.precision} isampler2D;
	precision ${e.precision} isampler3D;
	precision ${e.precision} isamplerCube;
	precision ${e.precision} isampler2DArray;
	precision ${e.precision} usampler2D;
	precision ${e.precision} usampler3D;
	precision ${e.precision} usamplerCube;
	precision ${e.precision} usampler2DArray;
	`;return e.precision===`highp`?t+=`
#define HIGH_PRECISION`:e.precision===`mediump`?t+=`
#define MEDIUM_PRECISION`:e.precision===`lowp`&&(t+=`
#define LOW_PRECISION`),t}var Tc={1:`SHADOWMAP_TYPE_PCF`,3:`SHADOWMAP_TYPE_VSM`};function Ec(e){return Tc[e.shadowMapType]||`SHADOWMAP_TYPE_BASIC`}var Dc={301:`ENVMAP_TYPE_CUBE`,302:`ENVMAP_TYPE_CUBE`,306:`ENVMAP_TYPE_CUBE_UV`};function Oc(e){return e.envMap===!1?`ENVMAP_TYPE_CUBE`:Dc[e.envMapMode]||`ENVMAP_TYPE_CUBE`}var kc={302:`ENVMAP_MODE_REFRACTION`};function Ac(e){return e.envMap===!1?`ENVMAP_MODE_REFLECTION`:kc[e.envMapMode]||`ENVMAP_MODE_REFLECTION`}var jc={0:`ENVMAP_BLENDING_MULTIPLY`,1:`ENVMAP_BLENDING_MIX`,2:`ENVMAP_BLENDING_ADD`};function Mc(e){return e.envMap===!1?`ENVMAP_BLENDING_NONE`:jc[e.combine]||`ENVMAP_BLENDING_NONE`}function Nc(e){let t=e.envMapCubeUVHeight;if(t===null)return null;let n=Math.log2(t)-2,r=1/t;return{texelWidth:1/(3*Math.max(2**n,112)),texelHeight:r,maxMip:n}}function Pc(e,t,n,r){let i=e.getContext(),a=n.defines,o=n.vertexShader,s=n.fragmentShader,c=Ec(n),l=Oc(n),u=Ac(n),d=Mc(n),f=Nc(n),p=dc(n),m=fc(a),h=i.createProgram(),g,_,v=n.glslVersion?`#version `+n.glslVersion+`
`:``;n.isRawShaderMaterial?(g=[`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m].filter(mc).join(`
`),g.length>0&&(g+=`
`),_=[`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m].filter(mc).join(`
`),_.length>0&&(_+=`
`)):(g=[wc(n),`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m,n.extensionClipCullDistance?`#define USE_CLIP_DISTANCE`:``,n.batching?`#define USE_BATCHING`:``,n.batchingColor?`#define USE_BATCHING_COLOR`:``,n.instancing?`#define USE_INSTANCING`:``,n.instancingColor?`#define USE_INSTANCING_COLOR`:``,n.instancingMorph?`#define USE_INSTANCING_MORPH`:``,n.useFog&&n.fog?`#define USE_FOG`:``,n.useFog&&n.fogExp2?`#define FOG_EXP2`:``,n.map?`#define USE_MAP`:``,n.envMap?`#define USE_ENVMAP`:``,n.envMap?`#define `+u:``,n.lightMap?`#define USE_LIGHTMAP`:``,n.aoMap?`#define USE_AOMAP`:``,n.bumpMap?`#define USE_BUMPMAP`:``,n.normalMap?`#define USE_NORMALMAP`:``,n.normalMapObjectSpace?`#define USE_NORMALMAP_OBJECTSPACE`:``,n.normalMapTangentSpace?`#define USE_NORMALMAP_TANGENTSPACE`:``,n.displacementMap?`#define USE_DISPLACEMENTMAP`:``,n.emissiveMap?`#define USE_EMISSIVEMAP`:``,n.anisotropy?`#define USE_ANISOTROPY`:``,n.anisotropyMap?`#define USE_ANISOTROPYMAP`:``,n.clearcoatMap?`#define USE_CLEARCOATMAP`:``,n.clearcoatRoughnessMap?`#define USE_CLEARCOAT_ROUGHNESSMAP`:``,n.clearcoatNormalMap?`#define USE_CLEARCOAT_NORMALMAP`:``,n.iridescenceMap?`#define USE_IRIDESCENCEMAP`:``,n.iridescenceThicknessMap?`#define USE_IRIDESCENCE_THICKNESSMAP`:``,n.specularMap?`#define USE_SPECULARMAP`:``,n.specularColorMap?`#define USE_SPECULAR_COLORMAP`:``,n.specularIntensityMap?`#define USE_SPECULAR_INTENSITYMAP`:``,n.roughnessMap?`#define USE_ROUGHNESSMAP`:``,n.metalnessMap?`#define USE_METALNESSMAP`:``,n.alphaMap?`#define USE_ALPHAMAP`:``,n.alphaHash?`#define USE_ALPHAHASH`:``,n.transmission?`#define USE_TRANSMISSION`:``,n.transmissionMap?`#define USE_TRANSMISSIONMAP`:``,n.thicknessMap?`#define USE_THICKNESSMAP`:``,n.sheenColorMap?`#define USE_SHEEN_COLORMAP`:``,n.sheenRoughnessMap?`#define USE_SHEEN_ROUGHNESSMAP`:``,n.mapUv?`#define MAP_UV `+n.mapUv:``,n.alphaMapUv?`#define ALPHAMAP_UV `+n.alphaMapUv:``,n.lightMapUv?`#define LIGHTMAP_UV `+n.lightMapUv:``,n.aoMapUv?`#define AOMAP_UV `+n.aoMapUv:``,n.emissiveMapUv?`#define EMISSIVEMAP_UV `+n.emissiveMapUv:``,n.bumpMapUv?`#define BUMPMAP_UV `+n.bumpMapUv:``,n.normalMapUv?`#define NORMALMAP_UV `+n.normalMapUv:``,n.displacementMapUv?`#define DISPLACEMENTMAP_UV `+n.displacementMapUv:``,n.metalnessMapUv?`#define METALNESSMAP_UV `+n.metalnessMapUv:``,n.roughnessMapUv?`#define ROUGHNESSMAP_UV `+n.roughnessMapUv:``,n.anisotropyMapUv?`#define ANISOTROPYMAP_UV `+n.anisotropyMapUv:``,n.clearcoatMapUv?`#define CLEARCOATMAP_UV `+n.clearcoatMapUv:``,n.clearcoatNormalMapUv?`#define CLEARCOAT_NORMALMAP_UV `+n.clearcoatNormalMapUv:``,n.clearcoatRoughnessMapUv?`#define CLEARCOAT_ROUGHNESSMAP_UV `+n.clearcoatRoughnessMapUv:``,n.iridescenceMapUv?`#define IRIDESCENCEMAP_UV `+n.iridescenceMapUv:``,n.iridescenceThicknessMapUv?`#define IRIDESCENCE_THICKNESSMAP_UV `+n.iridescenceThicknessMapUv:``,n.sheenColorMapUv?`#define SHEEN_COLORMAP_UV `+n.sheenColorMapUv:``,n.sheenRoughnessMapUv?`#define SHEEN_ROUGHNESSMAP_UV `+n.sheenRoughnessMapUv:``,n.specularMapUv?`#define SPECULARMAP_UV `+n.specularMapUv:``,n.specularColorMapUv?`#define SPECULAR_COLORMAP_UV `+n.specularColorMapUv:``,n.specularIntensityMapUv?`#define SPECULAR_INTENSITYMAP_UV `+n.specularIntensityMapUv:``,n.transmissionMapUv?`#define TRANSMISSIONMAP_UV `+n.transmissionMapUv:``,n.thicknessMapUv?`#define THICKNESSMAP_UV `+n.thicknessMapUv:``,n.vertexTangents&&n.flatShading===!1?`#define USE_TANGENT`:``,n.vertexNormals?`#define HAS_NORMAL`:``,n.vertexColors?`#define USE_COLOR`:``,n.vertexAlphas?`#define USE_COLOR_ALPHA`:``,n.vertexUv1s?`#define USE_UV1`:``,n.vertexUv2s?`#define USE_UV2`:``,n.vertexUv3s?`#define USE_UV3`:``,n.pointsUvs?`#define USE_POINTS_UV`:``,n.flatShading?`#define FLAT_SHADED`:``,n.skinning?`#define USE_SKINNING`:``,n.morphTargets?`#define USE_MORPHTARGETS`:``,n.morphNormals&&n.flatShading===!1?`#define USE_MORPHNORMALS`:``,n.morphColors?`#define USE_MORPHCOLORS`:``,n.morphTargetsCount>0?`#define MORPHTARGETS_TEXTURE_STRIDE `+n.morphTextureStride:``,n.morphTargetsCount>0?`#define MORPHTARGETS_COUNT `+n.morphTargetsCount:``,n.doubleSided?`#define DOUBLE_SIDED`:``,n.flipSided?`#define FLIP_SIDED`:``,n.shadowMapEnabled?`#define USE_SHADOWMAP`:``,n.shadowMapEnabled?`#define `+c:``,n.sizeAttenuation?`#define USE_SIZEATTENUATION`:``,n.numLightProbes>0?`#define USE_LIGHT_PROBES`:``,n.logarithmicDepthBuffer?`#define USE_LOGARITHMIC_DEPTH_BUFFER`:``,n.reversedDepthBuffer?`#define USE_REVERSED_DEPTH_BUFFER`:``,`uniform mat4 modelMatrix;`,`uniform mat4 modelViewMatrix;`,`uniform mat4 projectionMatrix;`,`uniform mat4 viewMatrix;`,`uniform mat3 normalMatrix;`,`uniform vec3 cameraPosition;`,`uniform bool isOrthographic;`,`#ifdef USE_INSTANCING`,`	attribute mat4 instanceMatrix;`,`#endif`,`#ifdef USE_INSTANCING_COLOR`,`	attribute vec3 instanceColor;`,`#endif`,`#ifdef USE_INSTANCING_MORPH`,`	uniform sampler2D morphTexture;`,`#endif`,`attribute vec3 position;`,`attribute vec3 normal;`,`attribute vec2 uv;`,`#ifdef USE_UV1`,`	attribute vec2 uv1;`,`#endif`,`#ifdef USE_UV2`,`	attribute vec2 uv2;`,`#endif`,`#ifdef USE_UV3`,`	attribute vec2 uv3;`,`#endif`,`#ifdef USE_TANGENT`,`	attribute vec4 tangent;`,`#endif`,`#if defined( USE_COLOR_ALPHA )`,`	attribute vec4 color;`,`#elif defined( USE_COLOR )`,`	attribute vec3 color;`,`#endif`,`#ifdef USE_SKINNING`,`	attribute vec4 skinIndex;`,`	attribute vec4 skinWeight;`,`#endif`,`
`].filter(mc).join(`
`),_=[wc(n),`#define SHADER_TYPE `+n.shaderType,`#define SHADER_NAME `+n.shaderName,m,n.useFog&&n.fog?`#define USE_FOG`:``,n.useFog&&n.fogExp2?`#define FOG_EXP2`:``,n.alphaToCoverage?`#define ALPHA_TO_COVERAGE`:``,n.map?`#define USE_MAP`:``,n.matcap?`#define USE_MATCAP`:``,n.envMap?`#define USE_ENVMAP`:``,n.envMap?`#define `+l:``,n.envMap?`#define `+u:``,n.envMap?`#define `+d:``,f?`#define CUBEUV_TEXEL_WIDTH `+f.texelWidth:``,f?`#define CUBEUV_TEXEL_HEIGHT `+f.texelHeight:``,f?`#define CUBEUV_MAX_MIP `+f.maxMip+`.0`:``,n.lightMap?`#define USE_LIGHTMAP`:``,n.aoMap?`#define USE_AOMAP`:``,n.bumpMap?`#define USE_BUMPMAP`:``,n.normalMap?`#define USE_NORMALMAP`:``,n.normalMapObjectSpace?`#define USE_NORMALMAP_OBJECTSPACE`:``,n.normalMapTangentSpace?`#define USE_NORMALMAP_TANGENTSPACE`:``,n.packedNormalMap?`#define USE_PACKED_NORMALMAP`:``,n.emissiveMap?`#define USE_EMISSIVEMAP`:``,n.anisotropy?`#define USE_ANISOTROPY`:``,n.anisotropyMap?`#define USE_ANISOTROPYMAP`:``,n.clearcoat?`#define USE_CLEARCOAT`:``,n.clearcoatMap?`#define USE_CLEARCOATMAP`:``,n.clearcoatRoughnessMap?`#define USE_CLEARCOAT_ROUGHNESSMAP`:``,n.clearcoatNormalMap?`#define USE_CLEARCOAT_NORMALMAP`:``,n.dispersion?`#define USE_DISPERSION`:``,n.retroreflection?`#define USE_RETROREFLECTION`:``,n.iridescence?`#define USE_IRIDESCENCE`:``,n.iridescenceMap?`#define USE_IRIDESCENCEMAP`:``,n.iridescenceThicknessMap?`#define USE_IRIDESCENCE_THICKNESSMAP`:``,n.specularMap?`#define USE_SPECULARMAP`:``,n.specularColorMap?`#define USE_SPECULAR_COLORMAP`:``,n.specularIntensityMap?`#define USE_SPECULAR_INTENSITYMAP`:``,n.roughnessMap?`#define USE_ROUGHNESSMAP`:``,n.metalnessMap?`#define USE_METALNESSMAP`:``,n.alphaMap?`#define USE_ALPHAMAP`:``,n.alphaTest?`#define USE_ALPHATEST`:``,n.alphaHash?`#define USE_ALPHAHASH`:``,n.sheen?`#define USE_SHEEN`:``,n.sheenColorMap?`#define USE_SHEEN_COLORMAP`:``,n.sheenRoughnessMap?`#define USE_SHEEN_ROUGHNESSMAP`:``,n.transmission?`#define USE_TRANSMISSION`:``,n.transmissionMap?`#define USE_TRANSMISSIONMAP`:``,n.thicknessMap?`#define USE_THICKNESSMAP`:``,n.vertexTangents&&n.flatShading===!1?`#define USE_TANGENT`:``,n.vertexColors||n.instancingColor?`#define USE_COLOR`:``,n.vertexAlphas||n.batchingColor?`#define USE_COLOR_ALPHA`:``,n.vertexUv1s?`#define USE_UV1`:``,n.vertexUv2s?`#define USE_UV2`:``,n.vertexUv3s?`#define USE_UV3`:``,n.pointsUvs?`#define USE_POINTS_UV`:``,n.gradientMap?`#define USE_GRADIENTMAP`:``,n.flatShading?`#define FLAT_SHADED`:``,n.doubleSided?`#define DOUBLE_SIDED`:``,n.flipSided?`#define FLIP_SIDED`:``,n.shadowMapEnabled?`#define USE_SHADOWMAP`:``,n.shadowMapEnabled?`#define `+c:``,n.premultipliedAlpha?`#define PREMULTIPLIED_ALPHA`:``,n.numLightProbes>0?`#define USE_LIGHT_PROBES`:``,n.numLightProbeGrids>0?`#define USE_LIGHT_PROBES_GRID`:``,n.decodeVideoTexture?`#define DECODE_VIDEO_TEXTURE`:``,n.decodeVideoTextureEmissive?`#define DECODE_VIDEO_TEXTURE_EMISSIVE`:``,n.logarithmicDepthBuffer?`#define USE_LOGARITHMIC_DEPTH_BUFFER`:``,n.reversedDepthBuffer?`#define USE_REVERSED_DEPTH_BUFFER`:``,`uniform mat4 viewMatrix;`,`uniform vec3 cameraPosition;`,`uniform bool isOrthographic;`,n.toneMapping===0?``:`#define TONE_MAPPING`,n.toneMapping===0?``:io.tonemapping_pars_fragment,n.toneMapping===0?``:cc(`toneMapping`,n.toneMapping),n.dithering?`#define DITHERING`:``,n.opaque?`#define OPAQUE`:``,io.colorspace_pars_fragment,oc(`linearToOutputTexel`,n.outputColorSpace),uc(),n.useDepthPacking?`#define DEPTH_PACKING `+n.depthPacking:``,`
`].filter(mc).join(`
`)),o=vc(o),o=hc(o,n),o=gc(o,n),s=vc(s),s=hc(s,n),s=gc(s,n),o=Sc(o),s=Sc(s),n.isRawShaderMaterial!==!0&&(v=`#version 300 es
`,g=[p,`#define attribute in`,`#define varying out`,`#define texture2D texture`].join(`
`)+`
`+g,_=[`#define varying in`,n.glslVersion===`300 es`?``:`layout(location = 0) out highp vec4 pc_fragColor;`,n.glslVersion===`300 es`?``:`#define gl_FragColor pc_fragColor`,`#define gl_FragDepthEXT gl_FragDepth`,`#define texture2D texture`,`#define textureCube texture`,`#define texture2DProj textureProj`,`#define texture2DLodEXT textureLod`,`#define texture2DProjLodEXT textureProjLod`,`#define textureCubeLodEXT textureLod`,`#define texture2DGradEXT textureGrad`,`#define texture2DProjGradEXT textureProjGrad`,`#define textureCubeGradEXT textureGrad`].join(`
`)+`
`+_);let y=v+g+o,b=v+_+s,x=$s(i,i.VERTEX_SHADER,y),S=$s(i,i.FRAGMENT_SHADER,b);i.attachShader(h,x),i.attachShader(h,S),n.index0AttributeName===void 0?n.hasPositionAttribute===!0&&i.bindAttribLocation(h,0,`position`):i.bindAttribLocation(h,0,n.index0AttributeName),i.linkProgram(h);function C(t){if(e.debug.checkShaderErrors){let n=i.getProgramInfoLog(h)||``,r=i.getShaderInfoLog(x)||``,a=i.getShaderInfoLog(S)||``,o=n.trim(),s=r.trim(),c=a.trim(),l=!0,u=!0;if(i.getProgramParameter(h,i.LINK_STATUS)===!1){if(l=!1,typeof e.debug.onShaderError==`function`)e.debug.onShaderError(i,h,x,S);else{let e=ac(i,x,`vertex`),n=ac(i,S,`fragment`);q(`WebGLProgram: Shader Error `+i.getError()+` - VALIDATE_STATUS `+i.getProgramParameter(h,i.VALIDATE_STATUS)+`

Material Name: `+t.name+`
Material Type: `+t.type+`

Program Info Log: `+o+`
`+e+`
`+n)}}else o===``?(s===``||c===``)&&(u=!1):K(`WebGLProgram: Program Info Log:`,o);u&&(t.diagnostics={runnable:l,programLog:o,vertexShader:{log:s,prefix:g},fragmentShader:{log:c,prefix:_}})}i.deleteShader(x),i.deleteShader(S),w=new Qs(i,h),T=pc(i,h)}let w;this.getUniforms=function(){return w===void 0&&C(this),w};let T;this.getAttributes=function(){return T===void 0&&C(this),T};let E=n.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return E===!1&&(E=i.getProgramParameter(h,ec)),E},this.destroy=function(){r.releaseStatesOfProgram(this),i.deleteProgram(h),this.program=void 0},this.type=n.shaderType,this.name=n.shaderName,this.id=tc++,this.cacheKey=t,this.usedTimes=1,this.program=h,this.vertexShader=x,this.fragmentShader=S,this}var Fc=0,Ic=class{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e,t,n){let r=this._getShaderCacheForMaterial(e);return r.has(t)===!1&&(r.add(t),t.usedTimes++),r.has(n)===!1&&(r.add(n),n.usedTimes++),this}remove(e){let t=this.materialCache.get(e);for(let e of t)e.usedTimes--,e.usedTimes===0&&this.shaderCache.delete(e.code);return this.materialCache.delete(e),this}getVertexShaderStage(e){return this._getShaderStage(e.vertexShader)}getFragmentShaderStage(e){return this._getShaderStage(e.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){let t=this.materialCache,n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){let t=this.shaderCache,n=t.get(e);return n===void 0&&(n=new Lc(e),t.set(e,n)),n}},Lc=class{constructor(e){this.id=Fc++,this.code=e,this.usedTimes=0}};function Rc(e){return e===1030||e===37490||e===36285}function zc(e,t,n,r,i,a){let o=new Xt,s=new Ic,c=new Set,l=[],u=new Map,d=r.logarithmicDepthBuffer,f=r.precision,p={MeshDepthMaterial:`depth`,MeshDistanceMaterial:`distance`,MeshNormalMaterial:`normal`,MeshBasicMaterial:`basic`,MeshLambertMaterial:`lambert`,MeshPhongMaterial:`phong`,MeshToonMaterial:`toon`,MeshStandardMaterial:`physical`,MeshPhysicalMaterial:`physical`,MeshMatcapMaterial:`matcap`,LineBasicMaterial:`basic`,LineDashedMaterial:`dashed`,PointsMaterial:`points`,ShadowMaterial:`shadow`,SpriteMaterial:`sprite`};function m(e){return c.add(e),e===0?`uv`:`uv${e}`}function h(i,o,l,u,h,g){let _=u.fog,v=h.geometry,y=i.isMeshStandardMaterial||i.isMeshLambertMaterial||i.isMeshPhongMaterial?u.environment:null,b=i.isMeshStandardMaterial||i.isMeshLambertMaterial&&!i.envMap||i.isMeshPhongMaterial&&!i.envMap,x=t.get(i.envMap||y,b),S=x&&x.mapping===306?x.image.height:null,C=p[i.type];i.precision!==null&&(f=r.getMaxPrecision(i.precision),f!==i.precision&&K(`WebGLProgram.getParameters:`,i.precision,`not supported, using`,f,`instead.`));let w=v.morphAttributes.position||v.morphAttributes.normal||v.morphAttributes.color,T=w===void 0?0:w.length,E=0;v.morphAttributes.position!==void 0&&(E=1),v.morphAttributes.normal!==void 0&&(E=2),v.morphAttributes.color!==void 0&&(E=3);let D,O,k,A;if(C){let e=ao[C];D=e.vertexShader,O=e.fragmentShader}else{D=i.vertexShader,O=i.fragmentShader;let e=s.getVertexShaderStage(i),t=s.getFragmentShaderStage(i);s.update(i,e,t),k=e.id,A=t.id}let j=e.getRenderTarget(),M=e.state.buffers.depth.getReversed(),N=h.isInstancedMesh===!0,P=h.isBatchedMesh===!0,F=!!i.map,I=!!i.matcap,L=!!x,ee=!!i.aoMap,te=!!i.lightMap,ne=!!i.bumpMap&&i.wireframe===!1,re=!!i.normalMap,R=!!i.displacementMap,ie=!!i.emissiveMap,z=!!i.metalnessMap,B=!!i.roughnessMap,ae=i.anisotropy>0,oe=i.clearcoat>0,V=i.dispersion>0,se=i.retroreflectivity>0,ce=i.iridescence>0,le=i.sheen>0,ue=i.transmission>0,de=ae&&!!i.anisotropyMap,H=oe&&!!i.clearcoatMap,fe=oe&&!!i.clearcoatNormalMap,pe=oe&&!!i.clearcoatRoughnessMap,me=ce&&!!i.iridescenceMap,he=ce&&!!i.iridescenceThicknessMap,ge=le&&!!i.sheenColorMap,_e=le&&!!i.sheenRoughnessMap,ve=!!i.specularMap,ye=!!i.specularColorMap,be=!!i.specularIntensityMap,xe=ue&&!!i.transmissionMap,Se=ue&&!!i.thicknessMap,Ce=!!i.gradientMap,we=!!i.alphaMap,Te=i.alphaTest>0,U=!!i.alphaHash,Ee=!!i.extensions,De=0;i.toneMapped&&(j===null||j.isXRRenderTarget===!0)&&(De=e.toneMapping);let Oe={shaderID:C,shaderType:i.type,shaderName:i.name,vertexShader:D,fragmentShader:O,defines:i.defines,customVertexShaderID:k,customFragmentShaderID:A,isRawShaderMaterial:i.isRawShaderMaterial===!0,glslVersion:i.glslVersion,precision:f,batching:P,batchingColor:P&&h._colorsTexture!==null,instancing:N,instancingColor:N&&h.instanceColor!==null,instancingMorph:N&&h.morphTexture!==null,outputColorSpace:j===null?e.outputColorSpace:j.isXRRenderTarget===!0?j.texture.colorSpace:Ct.workingColorSpace,alphaToCoverage:!!i.alphaToCoverage,map:F,matcap:I,envMap:L,envMapMode:L&&x.mapping,envMapCubeUVHeight:S,aoMap:ee,lightMap:te,bumpMap:ne,normalMap:re,displacementMap:R,emissiveMap:ie,normalMapObjectSpace:re&&i.normalMapType===1,normalMapTangentSpace:re&&i.normalMapType===0,packedNormalMap:re&&i.normalMapType===0&&Rc(i.normalMap.format),metalnessMap:z,roughnessMap:B,anisotropy:ae,anisotropyMap:de,clearcoat:oe,clearcoatMap:H,clearcoatNormalMap:fe,clearcoatRoughnessMap:pe,dispersion:V,retroreflection:se,iridescence:ce,iridescenceMap:me,iridescenceThicknessMap:he,sheen:le,sheenColorMap:ge,sheenRoughnessMap:_e,specularMap:ve,specularColorMap:ye,specularIntensityMap:be,transmission:ue,transmissionMap:xe,thicknessMap:Se,gradientMap:Ce,opaque:i.transparent===!1&&i.blending===1&&i.alphaToCoverage===!1,alphaMap:we,alphaTest:Te,alphaHash:U,combine:i.combine,mapUv:F&&m(i.map.channel),aoMapUv:ee&&m(i.aoMap.channel),lightMapUv:te&&m(i.lightMap.channel),bumpMapUv:ne&&m(i.bumpMap.channel),normalMapUv:re&&m(i.normalMap.channel),displacementMapUv:R&&m(i.displacementMap.channel),emissiveMapUv:ie&&m(i.emissiveMap.channel),metalnessMapUv:z&&m(i.metalnessMap.channel),roughnessMapUv:B&&m(i.roughnessMap.channel),anisotropyMapUv:de&&m(i.anisotropyMap.channel),clearcoatMapUv:H&&m(i.clearcoatMap.channel),clearcoatNormalMapUv:fe&&m(i.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:pe&&m(i.clearcoatRoughnessMap.channel),iridescenceMapUv:me&&m(i.iridescenceMap.channel),iridescenceThicknessMapUv:he&&m(i.iridescenceThicknessMap.channel),sheenColorMapUv:ge&&m(i.sheenColorMap.channel),sheenRoughnessMapUv:_e&&m(i.sheenRoughnessMap.channel),specularMapUv:ve&&m(i.specularMap.channel),specularColorMapUv:ye&&m(i.specularColorMap.channel),specularIntensityMapUv:be&&m(i.specularIntensityMap.channel),transmissionMapUv:xe&&m(i.transmissionMap.channel),thicknessMapUv:Se&&m(i.thicknessMap.channel),alphaMapUv:we&&m(i.alphaMap.channel),vertexTangents:!!v.attributes.tangent&&(re||ae),vertexNormals:!!v.attributes.normal,vertexColors:i.vertexColors,vertexAlphas:i.vertexColors===!0&&!!v.attributes.color&&v.attributes.color.itemSize===4,pointsUvs:h.isPoints===!0&&!!v.attributes.uv&&(F||we),fog:!!_,useFog:i.fog===!0,fogExp2:!!_&&_.isFogExp2,flatShading:i.wireframe===!1&&(i.flatShading===!0||v.attributes.normal===void 0&&re===!1&&(i.isMeshLambertMaterial||i.isMeshPhongMaterial||i.isMeshStandardMaterial||i.isMeshPhysicalMaterial)),sizeAttenuation:i.sizeAttenuation===!0,logarithmicDepthBuffer:d,reversedDepthBuffer:M,skinning:h.isSkinnedMesh===!0,hasPositionAttribute:v.attributes.position!==void 0,morphTargets:v.morphAttributes.position!==void 0,morphNormals:v.morphAttributes.normal!==void 0,morphColors:v.morphAttributes.color!==void 0,morphTargetsCount:T,morphTextureStride:E,numSunLights:o.sun.length,numDirLights:o.directional.length,numPointLights:o.point.length,numSpotLights:o.spot.length,numSpotLightMaps:o.spotLightMap.length,numRectAreaLights:o.rectArea.length,numHemiLights:o.hemi.length,numSunLightShadows:o.sunShadowMap.length,numDirLightShadows:o.directionalShadowMap.length,numPointLightShadows:o.pointShadowMap.length,numSpotLightShadows:o.spotShadowMap.length,numSpotLightShadowsWithMaps:o.numSpotLightShadowsWithMaps,numLightProbes:o.numLightProbes,numLightProbeGrids:g.length,numClippingPlanes:a.numPlanes,numClipIntersection:a.numIntersection,dithering:i.dithering,shadowMapEnabled:e.shadowMap.enabled&&l.length>0,shadowMapType:e.shadowMap.type,toneMapping:De,decodeVideoTexture:F&&i.map.isVideoTexture===!0&&Ct.getTransfer(i.map.colorSpace)===`srgb`,decodeVideoTextureEmissive:ie&&i.emissiveMap.isVideoTexture===!0&&Ct.getTransfer(i.emissiveMap.colorSpace)===`srgb`,premultipliedAlpha:i.premultipliedAlpha,doubleSided:i.side===2,flipSided:i.side===1,useDepthPacking:i.depthPacking>=0,depthPacking:i.depthPacking||0,index0AttributeName:i.index0AttributeName,extensionClipCullDistance:Ee&&i.extensions.clipCullDistance===!0&&n.has(`WEBGL_clip_cull_distance`),extensionMultiDraw:(Ee&&i.extensions.multiDraw===!0||P)&&n.has(`WEBGL_multi_draw`),rendererExtensionParallelShaderCompile:n.has(`KHR_parallel_shader_compile`),customProgramCacheKey:i.customProgramCacheKey()};return Oe.vertexUv1s=c.has(1),Oe.vertexUv2s=c.has(2),Oe.vertexUv3s=c.has(3),c.clear(),Oe}function g(t){let n=[];if(t.shaderID?n.push(t.shaderID):(n.push(t.customVertexShaderID),n.push(t.customFragmentShaderID)),t.defines!==void 0)for(let e in t.defines)n.push(e),n.push(t.defines[e]);return t.isRawShaderMaterial===!1&&(_(n,t),v(n,t),n.push(e.outputColorSpace)),n.push(t.customProgramCacheKey),n.join()}function _(e,t){e.push(t.precision),e.push(t.outputColorSpace),e.push(t.envMapMode),e.push(t.envMapCubeUVHeight),e.push(t.mapUv),e.push(t.alphaMapUv),e.push(t.lightMapUv),e.push(t.aoMapUv),e.push(t.bumpMapUv),e.push(t.normalMapUv),e.push(t.displacementMapUv),e.push(t.emissiveMapUv),e.push(t.metalnessMapUv),e.push(t.roughnessMapUv),e.push(t.anisotropyMapUv),e.push(t.clearcoatMapUv),e.push(t.clearcoatNormalMapUv),e.push(t.clearcoatRoughnessMapUv),e.push(t.iridescenceMapUv),e.push(t.iridescenceThicknessMapUv),e.push(t.sheenColorMapUv),e.push(t.sheenRoughnessMapUv),e.push(t.specularMapUv),e.push(t.specularColorMapUv),e.push(t.specularIntensityMapUv),e.push(t.transmissionMapUv),e.push(t.thicknessMapUv),e.push(t.combine),e.push(t.fogExp2),e.push(t.sizeAttenuation),e.push(t.morphTargetsCount),e.push(t.morphAttributeCount),e.push(t.numSunLights),e.push(t.numDirLights),e.push(t.numPointLights),e.push(t.numSpotLights),e.push(t.numSpotLightMaps),e.push(t.numHemiLights),e.push(t.numRectAreaLights),e.push(t.numSunLightShadows),e.push(t.numDirLightShadows),e.push(t.numPointLightShadows),e.push(t.numSpotLightShadows),e.push(t.numSpotLightShadowsWithMaps),e.push(t.numLightProbes),e.push(t.shadowMapType),e.push(t.toneMapping),e.push(t.numClippingPlanes),e.push(t.numClipIntersection),e.push(t.depthPacking)}function v(e,t){o.disableAll(),t.instancing&&o.enable(0),t.instancingColor&&o.enable(1),t.instancingMorph&&o.enable(2),t.matcap&&o.enable(3),t.envMap&&o.enable(4),t.normalMapObjectSpace&&o.enable(5),t.normalMapTangentSpace&&o.enable(6),t.clearcoat&&o.enable(7),t.iridescence&&o.enable(8),t.alphaTest&&o.enable(9),t.vertexColors&&o.enable(10),t.vertexAlphas&&o.enable(11),t.vertexUv1s&&o.enable(12),t.vertexUv2s&&o.enable(13),t.vertexUv3s&&o.enable(14),t.vertexTangents&&o.enable(15),t.anisotropy&&o.enable(16),t.alphaHash&&o.enable(17),t.batching&&o.enable(18),t.dispersion&&o.enable(19),t.retroreflection&&o.enable(24),t.batchingColor&&o.enable(20),t.gradientMap&&o.enable(21),t.packedNormalMap&&o.enable(22),t.vertexNormals&&o.enable(23),e.push(o.mask),o.disableAll(),t.fog&&o.enable(0),t.useFog&&o.enable(1),t.flatShading&&o.enable(2),t.logarithmicDepthBuffer&&o.enable(3),t.reversedDepthBuffer&&o.enable(4),t.skinning&&o.enable(5),t.morphTargets&&o.enable(6),t.morphNormals&&o.enable(7),t.morphColors&&o.enable(8),t.premultipliedAlpha&&o.enable(9),t.shadowMapEnabled&&o.enable(10),t.doubleSided&&o.enable(11),t.flipSided&&o.enable(12),t.useDepthPacking&&o.enable(13),t.dithering&&o.enable(14),t.transmission&&o.enable(15),t.sheen&&o.enable(16),t.opaque&&o.enable(17),t.pointsUvs&&o.enable(18),t.decodeVideoTexture&&o.enable(19),t.decodeVideoTextureEmissive&&o.enable(20),t.alphaToCoverage&&o.enable(21),t.numLightProbeGrids>0&&o.enable(22),t.hasPositionAttribute&&o.enable(23),e.push(o.mask)}function y(e){let t=p[e.type],n;if(t){let e=ao[t];n=Wi.clone(e.uniforms)}else n=e.uniforms;return n}function b(t,n){let r=u.get(n);return r===void 0?(r=new Pc(e,n,t,i),l.push(r),u.set(n,r)):++r.usedTimes,r}function x(e){if(--e.usedTimes===0){let t=l.indexOf(e);l[t]=l[l.length-1],l.pop(),u.delete(e.cacheKey),e.destroy()}}function S(e){s.remove(e)}function C(){s.dispose()}return{getParameters:h,getProgramCacheKey:g,getUniforms:y,acquireProgram:b,releaseProgram:x,releaseShaderCache:S,programs:l,dispose:C}}function Bc(){let e=new WeakMap;function t(t){return e.has(t)}function n(t){let n=e.get(t);return n===void 0&&(n={},e.set(t,n)),n}function r(t){e.delete(t)}function i(t,n,r){e.get(t)[n]=r}function a(){e=new WeakMap}return{has:t,get:n,remove:r,update:i,dispose:a}}function Vc(e,t){return e.groupOrder===t.groupOrder?e.renderOrder===t.renderOrder?e.material.id===t.material.id?e.materialVariant===t.materialVariant?e.z===t.z?e.id-t.id:e.z-t.z:e.materialVariant-t.materialVariant:e.material.id-t.material.id:e.renderOrder-t.renderOrder:e.groupOrder-t.groupOrder}function Hc(e,t){return e.groupOrder===t.groupOrder?e.renderOrder===t.renderOrder?e.z===t.z?e.id-t.id:t.z-e.z:e.renderOrder-t.renderOrder:e.groupOrder-t.groupOrder}function Uc(){let e=[],t=0,n=[],r=[],i=[];function a(){t=0,n.length=0,r.length=0,i.length=0}function o(e){let t=0;return e.isInstancedMesh&&(t+=2),e.isSkinnedMesh&&(t+=1),t}function s(n,r,i,a,s,c){let l=e[t];return l===void 0?(l={id:n.id,object:n,geometry:r,material:i,materialVariant:o(n),groupOrder:a,renderOrder:n.renderOrder,z:s,group:c},e[t]=l):(l.id=n.id,l.object=n,l.geometry=r,l.material=i,l.materialVariant=o(n),l.groupOrder=a,l.renderOrder=n.renderOrder,l.z=s,l.group=c),t++,l}function c(e,t,a,o,c,l,u){u.reversedDepth===!0&&(c=-c);let d=s(e,t,a,o,c,l);a.transmission>0?r.push(d):a.transparent===!0?i.push(d):n.push(d)}function l(e,t,a,o,c,l){let u=s(e,t,a,o,c,l);a.transmission>0?r.unshift(u):a.transparent===!0?i.unshift(u):n.unshift(u)}function u(e,t){n.length>1&&n.sort(e||Vc),r.length>1&&r.sort(t||Hc),i.length>1&&i.sort(t||Hc)}function d(){for(let n=t,r=e.length;n<r;n++){let t=e[n];if(t.id===null)break;t.id=null,t.object=null,t.geometry=null,t.material=null,t.group=null}}return{opaque:n,transmissive:r,transparent:i,init:a,push:c,unshift:l,finish:d,sort:u}}function Wc(){let e=new WeakMap;function t(t,n){let r=e.get(t),i;return r===void 0?(i=new Uc,e.set(t,[i])):n>=r.length?(i=new Uc,r.push(i)):i=r[n],i}function n(){e=new WeakMap}return{get:t,dispose:n}}function Gc(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let n;switch(t.type){case`SunLight`:case`DirectionalLight`:n={direction:new X,color:new Q};break;case`SpotLight`:n={position:new X,direction:new X,color:new Q,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case`PointLight`:n={position:new X,color:new Q,distance:0,decay:0};break;case`HemisphereLight`:n={direction:new X,skyColor:new Q,groundColor:new Q};break;case`RectAreaLight`:n={color:new Q,position:new X,halfWidth:new X,halfHeight:new X}}return e[t.id]=n,n}}}function Kc(){let e={};return{get:function(t){if(e[t.id]!==void 0)return e[t.id];let n;switch(t.type){case`SunLight`:case`DirectionalLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Y};break;case`SpotLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Y};break;case`PointLight`:n={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new Y,shadowCameraNear:1,shadowCameraFar:1e3}}return e[t.id]=n,n}}}var qc=0;function Jc(e,t){return(t.castShadow?2:0)-(e.castShadow?2:0)+ +!!t.map-!!e.map}function Yc(e){let t=new Gc,n=Kc(),r={version:0,hash:{sunLength:-1,directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numSunShadows:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],sun:[],sunShadow:[],sunShadowMap:[],sunShadowMatrix:[],sunShadowCascade:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let e=0;e<9;e++)r.probe.push(new X);let i=new X,a=new zt,o=new zt;function s(i){let a=0,o=0,s=0;for(let e=0;e<9;e++)r.probe[e].set(0,0,0);let c=0,l=0,u=0,d=0,f=0,p=0,m=0,h=0,g=0,_=0,v=0,y=0,b=0,x=0;i.sort(Jc);for(let e=0,S=i.length;e<S;e++){let S=i[e],C=S.color,w=S.intensity,T=S.distance,E=null;if(S.shadow&&S.shadow.map&&(E=S.shadow.map.texture.format===1030?S.shadow.map.texture:S.shadow.map.depthTexture||S.shadow.map.texture),S.isAmbientLight)a+=C.r*w,o+=C.g*w,s+=C.b*w;else if(S.isLightProbe){for(let e=0;e<9;e++)r.probe[e].addScaledVector(S.sh.coefficients[e],w);x++}else if(S.isSunLight){let e=t.get(S);if(e.color.copy(S.color).multiplyScalar(S.intensity),S.castShadow){let e=S.shadow,t=n.get(S);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize.copy(e.mapSize).multiply(e.getFrameExtents()),r.sunShadow[l]=t,r.sunShadowMap[l]=E;let i=e.getViewportCount();for(let t=0;t<i;t++)r.sunShadowMatrix[u+t]=e.getMatrix(t),r.sunShadowCascade[u+t]=e._cascadeData[t];u+=i,l++}r.sun[c]=e,c++}else if(S.isDirectionalLight){let e=t.get(S);if(e.color.copy(S.color).multiplyScalar(S.intensity),S.castShadow){let e=S.shadow,t=n.get(S);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize=e.mapSize,r.directionalShadow[d]=t,r.directionalShadowMap[d]=E,r.directionalShadowMatrix[d]=S.shadow.matrix,g++}r.directional[d]=e,d++}else if(S.isSpotLight){let e=t.get(S);e.position.setFromMatrixPosition(S.matrixWorld),e.color.copy(C).multiplyScalar(w),e.distance=T,e.coneCos=Math.cos(S.angle),e.penumbraCos=Math.cos(S.angle*(1-S.penumbra)),e.decay=S.decay,r.spot[p]=e;let i=S.shadow;if(S.map&&(r.spotLightMap[y]=S.map,y++,i.updateMatrices(S),S.castShadow&&b++),r.spotLightMatrix[p]=i.matrix,S.castShadow){let e=n.get(S);e.shadowIntensity=i.intensity,e.shadowBias=i.bias,e.shadowNormalBias=i.normalBias,e.shadowRadius=i.radius,e.shadowMapSize=i.mapSize,r.spotShadow[p]=e,r.spotShadowMap[p]=E,v++}p++}else if(S.isRectAreaLight){let e=t.get(S);e.color.copy(C).multiplyScalar(w),e.halfWidth.set(S.width*.5,0,0),e.halfHeight.set(0,S.height*.5,0),r.rectArea[m]=e,m++}else if(S.isPointLight){let e=t.get(S);if(e.color.copy(S.color).multiplyScalar(S.intensity),e.distance=S.distance,e.decay=S.decay,S.castShadow){let e=S.shadow,t=n.get(S);t.shadowIntensity=e.intensity,t.shadowBias=e.bias,t.shadowNormalBias=e.normalBias,t.shadowRadius=e.radius,t.shadowMapSize=e.mapSize,t.shadowCameraNear=e.camera.near,t.shadowCameraFar=e.camera.far,r.pointShadow[f]=t,r.pointShadowMap[f]=E,r.pointShadowMatrix[f]=S.shadow.matrix,_++}r.point[f]=e,f++}else if(S.isHemisphereLight){let e=t.get(S);e.skyColor.copy(S.color).multiplyScalar(w),e.groundColor.copy(S.groundColor).multiplyScalar(w),r.hemi[h]=e,h++}}m>0&&(e.has(`OES_texture_float_linear`)===!0?(r.rectAreaLTC1=$.LTC_FLOAT_1,r.rectAreaLTC2=$.LTC_FLOAT_2):(r.rectAreaLTC1=$.LTC_HALF_1,r.rectAreaLTC2=$.LTC_HALF_2)),r.ambient[0]=a,r.ambient[1]=o,r.ambient[2]=s;let S=r.hash;(S.sunLength!==c||S.directionalLength!==d||S.pointLength!==f||S.spotLength!==p||S.rectAreaLength!==m||S.hemiLength!==h||S.numSunShadows!==l||S.numDirectionalShadows!==g||S.numPointShadows!==_||S.numSpotShadows!==v||S.numSpotMaps!==y||S.numLightProbes!==x)&&(r.sun.length=c,r.directional.length=d,r.spot.length=p,r.rectArea.length=m,r.point.length=f,r.hemi.length=h,r.sunShadow.length=l,r.sunShadowMap.length=l,r.sunShadowMatrix.length=u,r.sunShadowCascade.length=u,r.directionalShadow.length=g,r.directionalShadowMap.length=g,r.directionalShadowMatrix.length=g,r.pointShadow.length=_,r.pointShadowMap.length=_,r.pointShadowMatrix.length=_,r.spotShadow.length=v,r.spotShadowMap.length=v,r.spotLightMatrix.length=v+y-b,r.spotLightMap.length=y,r.numSpotLightShadowsWithMaps=b,r.numLightProbes=x,S.sunLength=c,S.directionalLength=d,S.pointLength=f,S.spotLength=p,S.rectAreaLength=m,S.hemiLength=h,S.numSunShadows=l,S.numDirectionalShadows=g,S.numPointShadows=_,S.numSpotShadows=v,S.numSpotMaps=y,S.numLightProbes=x,r.version=qc++)}function c(e,t){let n=0,s=0,c=0,l=0,u=0,d=0,f=t.matrixWorldInverse;for(let t=0,p=e.length;t<p;t++){let p=e[t];if(p.isSunLight){let e=r.sun[n];e.direction.setFromMatrixPosition(p.matrixWorld),e.direction.transformDirection(f),n++}else if(p.isDirectionalLight){let e=r.directional[s];e.direction.setFromMatrixPosition(p.matrixWorld),i.setFromMatrixPosition(p.target.matrixWorld),e.direction.sub(i),e.direction.transformDirection(f),s++}else if(p.isSpotLight){let e=r.spot[l];e.position.setFromMatrixPosition(p.matrixWorld),e.position.applyMatrix4(f),e.direction.setFromMatrixPosition(p.matrixWorld),i.setFromMatrixPosition(p.target.matrixWorld),e.direction.sub(i),e.direction.transformDirection(f),l++}else if(p.isRectAreaLight){let e=r.rectArea[u];e.position.setFromMatrixPosition(p.matrixWorld),e.position.applyMatrix4(f),o.identity(),a.copy(p.matrixWorld),a.premultiply(f),o.extractRotation(a),e.halfWidth.set(p.width*.5,0,0),e.halfHeight.set(0,p.height*.5,0),e.halfWidth.applyMatrix4(o),e.halfHeight.applyMatrix4(o),u++}else if(p.isPointLight){let e=r.point[c];e.position.setFromMatrixPosition(p.matrixWorld),e.position.applyMatrix4(f),c++}else if(p.isHemisphereLight){let e=r.hemi[d];e.direction.setFromMatrixPosition(p.matrixWorld),e.direction.transformDirection(f),d++}}}return{setup:s,setupView:c,state:r}}function Xc(e){let t=new Yc(e),n=[],r=[],i=[];function a(e){d.camera=e,n.length=0,r.length=0,i.length=0}function o(e){n.push(e)}function s(e){r.push(e)}function c(e){i.push(e)}function l(){t.setup(n)}function u(e){t.setupView(n,e)}let d={lightsArray:n,shadowsArray:r,lightProbeGridArray:i,camera:null,lights:t,transmissionRenderTarget:{},textureUnits:0};return{init:a,state:d,setupLights:l,setupLightsView:u,pushLight:o,pushShadow:s,pushLightProbeGrid:c}}function Zc(e){let t=new WeakMap;function n(n,r=0){let i=t.get(n),a;return i===void 0?(a=new Xc(e),t.set(n,[a])):r>=i.length?(a=new Xc(e),i.push(a)):a=i[r],a}function r(){t=new WeakMap}return{get:n,dispose:r}}var Qc=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,$c=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,el=[new X(1,0,0),new X(-1,0,0),new X(0,1,0),new X(0,-1,0),new X(0,0,1),new X(0,0,-1)],tl=[new X(0,-1,0),new X(0,-1,0),new X(0,0,1),new X(0,0,-1),new X(0,-1,0),new X(0,-1,0)],nl=new zt,rl=new X,il=new X;function al(e,t,n){let r=new pi,i=new Y,a=new Y,o=new Pt,s=new Zi,c=new Qi,l={},u=n.maxTextureSize,d={0:1,1:0,2:2},f=new qi({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new Y},radius:{value:4}},vertexShader:Qc,fragmentShader:$c}),p=f.clone();p.defines.HORIZONTAL_PASS=1;let m=new gr;m.setAttribute(`position`,new tr(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));let h=new ai(m,f),_=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=1;let v=this.type;this.render=function(t,n,s){if(_.enabled===!1||_.autoUpdate===!1&&_.needsUpdate===!1||t.length===0)return;this.type===2&&(K(`WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead.`),this.type=1);let c=e.getRenderTarget(),l=e.getActiveCubeFace(),d=e.getActiveMipmapLevel(),f=e.state;f.setBlending(0),f.buffers.depth.getReversed()===!0?f.buffers.color.setClear(0,0,0,0):f.buffers.color.setClear(1,1,1,1),f.buffers.depth.setTest(!0),f.setScissorTest(!1);let p=v!==this.type;p&&n.traverse(function(e){e.material&&(Array.isArray(e.material)?e.material.forEach(e=>e.needsUpdate=!0):e.material.needsUpdate=!0)});for(let c=0,l=t.length;c<l;c++){let l=t[c],d=l.shadow;if(d===void 0){K(`WebGLShadowMap:`,l,`has no shadow.`);continue}if(d.autoUpdate===!1&&d.needsUpdate===!1)continue;i.copy(d.mapSize);let m=d.getFrameExtents();i.multiply(m),a.copy(d.mapSize),(i.x>u||i.y>u)&&(i.x>u&&(a.x=Math.floor(u/m.x),i.x=a.x*m.x,d.mapSize.x=a.x),i.y>u&&(a.y=Math.floor(u/m.y),i.y=a.y*m.y,d.mapSize.y=a.y));let h=e.state.buffers.depth.getReversed();if(d.camera._reversedDepth=h,d.map===null||p===!0){if(d.map!==null&&(d.map.depthTexture!==null&&(d.map.depthTexture.dispose(),d.map.depthTexture=null),d.map.dispose()),this.type===3){if(l.isPointLight){K(`WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.`);continue}d.map=new It(i.x,i.y,{format:R,type:k,minFilter:y,magFilter:y,generateMipmaps:!1}),d.map.texture.name=l.name+`.shadowMap`,d.map.depthTexture=new Ai(i.x,i.y,O),d.map.depthTexture.name=l.name+`.shadowMapDepth`,d.map.depthTexture.format=ee,d.map.depthTexture.compareFunction=null,d.map.depthTexture.minFilter=g,d.map.depthTexture.magFilter=g}else l.isPointLight?(d.map=new Io(i.x),d.map.depthTexture=new ji(i.x,D)):(d.map=new It(i.x,i.y),d.map.depthTexture=new Ai(i.x,i.y,D)),d.map.depthTexture.name=l.name+`.shadowMap`,d.map.depthTexture.format=ee,this.type===1?(d.map.depthTexture.compareFunction=h?518:515,d.map.depthTexture.minFilter=y,d.map.depthTexture.magFilter=y):(d.map.depthTexture.compareFunction=null,d.map.depthTexture.minFilter=g,d.map.depthTexture.magFilter=g);d.camera.updateProjectionMatrix()}d.map.isWebGLCubeRenderTarget!==!0&&(d.map.width!==i.x||d.map.height!==i.y)&&d.map.setSize(i.x,i.y);let _=d.map.isWebGLCubeRenderTarget?6:d.getViewportCount();l.isPointLight!==!0&&d.updateMatrices(l,s);for(let t=0;t<_;t++){let i=d.getCamera(t);if(l.isPointLight){let e=d.camera,n=d.matrix,r=l.distance||e.far;r!==e.far&&(e.far=r,e.updateProjectionMatrix()),rl.setFromMatrixPosition(l.matrixWorld),e.position.copy(rl),il.copy(e.position),il.add(el[t]),e.up.copy(tl[t]),e.lookAt(il),e.updateMatrixWorld(),n.makeTranslation(-rl.x,-rl.y,-rl.z),nl.multiplyMatrices(e.projectionMatrix,e.matrixWorldInverse),d._frustum.setFromProjectionMatrix(nl,e.coordinateSystem,e.reversedDepth)}if(d.map.isWebGLCubeRenderTarget)e.setRenderTarget(d.map,t),e.clear();else{t===0&&(e.setRenderTarget(d.map),e.clear());let n=d.getViewport(t);o.set(a.x*n.x,a.y*n.y,a.x*n.z,a.y*n.w),f.viewport(o)}r=d.getFrustum(t),S(n,s,i,l,this.type)}d.isPointLightShadow!==!0&&this.type===3&&b(d,s),d.needsUpdate=!1}v=this.type,_.needsUpdate=!1,e.setRenderTarget(c,l,d)};function b(n,r){let a=t.update(h);f.defines.VSM_SAMPLES!==n.blurSamples&&(f.defines.VSM_SAMPLES=n.blurSamples,p.defines.VSM_SAMPLES=n.blurSamples,f.needsUpdate=!0,p.needsUpdate=!0),n.mapPass===null?n.mapPass=new It(i.x,i.y,{format:R,type:k}):(n.mapPass.width!==n.map.width||n.mapPass.height!==n.map.height)&&n.mapPass.setSize(n.map.width,n.map.height),f.uniforms.shadow_pass.value=n.map.depthTexture,f.uniforms.resolution.value.set(n.map.width,n.map.height),f.uniforms.radius.value=n.radius,e.setRenderTarget(n.mapPass),e.clear(),e.renderBufferDirect(r,null,a,f,h,null),p.uniforms.shadow_pass.value=n.mapPass.texture,p.uniforms.resolution.value.set(n.map.width,n.map.height),p.uniforms.radius.value=n.radius,e.setRenderTarget(n.map),e.clear(),e.renderBufferDirect(r,null,a,p,h,null)}function x(t,n,r,i){let a=null,o=r.isPointLight===!0?t.customDistanceMaterial:t.customDepthMaterial;if(o!==void 0)a=o;else if(a=r.isPointLight===!0?c:s,e.localClippingEnabled&&n.clipShadows===!0&&Array.isArray(n.clippingPlanes)&&n.clippingPlanes.length!==0||n.displacementMap&&n.displacementScale!==0||n.alphaMap&&n.alphaTest>0||n.map&&n.alphaTest>0||n.alphaToCoverage===!0){let e=a.uuid,t=n.uuid,r=l[e];r===void 0&&(r={},l[e]=r);let i=r[t];i===void 0&&(i=a.clone(),r[t]=i,n.addEventListener(`dispose`,C)),a=i}if(a.visible=n.visible,a.wireframe=n.wireframe,i===3?a.side=n.shadowSide===null?n.side:n.shadowSide:a.side=n.shadowSide===null?d[n.side]:n.shadowSide,a.alphaMap=n.alphaMap,a.alphaTest=n.alphaToCoverage===!0?.5:n.alphaTest,a.map=n.map,a.clipShadows=n.clipShadows,a.clippingPlanes=n.clippingPlanes,a.clipIntersection=n.clipIntersection,a.displacementMap=n.displacementMap,a.displacementScale=n.displacementScale,a.displacementBias=n.displacementBias,a.wireframeLinewidth=n.wireframeLinewidth,a.linewidth=n.linewidth,r.isPointLight===!0&&a.isMeshDistanceMaterial===!0){let t=e.properties.get(a);t.light=r}return a}function S(n,i,a,o,s){if(n.visible===!1)return;if(n.layers.test(i.layers)&&(n.isMesh||n.isLine||n.isPoints)&&(n.castShadow||n.receiveShadow&&s===3)&&(!n.frustumCulled||n.intersectsFrustum(r))){n.modelViewMatrix.multiplyMatrices(a.matrixWorldInverse,n.matrixWorld);let r=t.update(n),c=n.material;if(Array.isArray(c)){let t=r.groups;for(let l=0,u=t.length;l<u;l++){let u=t[l],d=c[u.materialIndex];if(d&&d.visible){let t=x(n,d,o,s);n.onBeforeShadow(e,n,i,a,r,t,u),e.renderBufferDirect(a,null,r,t,n,u),n.onAfterShadow(e,n,i,a,r,t,u)}}}else if(c.visible){let t=x(n,c,o,s);n.onBeforeShadow(e,n,i,a,r,t,null),e.renderBufferDirect(a,null,r,t,n,null),n.onAfterShadow(e,n,i,a,r,t,null)}}let c=n.children;for(let e=0,t=c.length;e<t;e++)S(c[e],i,a,o,s)}function C(e){e.target.removeEventListener(`dispose`,C);for(let t in l){let n=l[t],r=e.target.uuid;r in n&&(n[r].dispose(),delete n[r])}}}function ol(e,t){function n(){let t=!1,n=new Pt,r=null,i=new Pt(0,0,0,0);return{setMask:function(n){r!==n&&!t&&(e.colorMask(n,n,n,n),r=n)},setLocked:function(e){t=e},setClear:function(t,r,a,o,s){s===!0&&(t*=o,r*=o,a*=o),n.set(t,r,a,o),i.equals(n)===!1&&(e.clearColor(t,r,a,o),i.copy(n))},reset:function(){t=!1,r=null,i.set(-1,0,0,0)}}}function r(){let n=!1,r=!1,i=null,a=null,o=null;return{setReversed:function(e){if(r!==e){let n=t.get(`EXT_clip_control`);e?n.clipControlEXT(n.LOWER_LEFT_EXT,n.ZERO_TO_ONE_EXT):n.clipControlEXT(n.LOWER_LEFT_EXT,n.NEGATIVE_ONE_TO_ONE_EXT),r=e;let i=o;o=null,this.setClear(i)}},getReversed:function(){return r},setTest:function(t){t?z(e.DEPTH_TEST):B(e.DEPTH_TEST)},setMask:function(t){i!==t&&!n&&(e.depthMask(t),i=t)},setFunc:function(t){if(r&&(t=ot[t]),a!==t){switch(t){case 0:e.depthFunc(e.NEVER);break;case 1:e.depthFunc(e.ALWAYS);break;case 2:e.depthFunc(e.LESS);break;case 3:e.depthFunc(e.LEQUAL);break;case 4:e.depthFunc(e.EQUAL);break;case 5:e.depthFunc(e.GEQUAL);break;case 6:e.depthFunc(e.GREATER);break;case 7:e.depthFunc(e.NOTEQUAL);break;default:e.depthFunc(e.LEQUAL)}a=t}},setLocked:function(e){n=e},setClear:function(t){o!==t&&(o=t,r&&(t=1-t),e.clearDepth(t))},reset:function(){n=!1,i=null,a=null,o=null,r=!1}}}function i(){let t=!1,n=null,r=null,i=null,a=null,o=null,s=null,c=null,l=null;return{setTest:function(n){t||(n?z(e.STENCIL_TEST):B(e.STENCIL_TEST))},setMask:function(r){n!==r&&!t&&(e.stencilMask(r),n=r)},setFunc:function(t,n,o){(r!==t||i!==n||a!==o)&&(e.stencilFunc(t,n,o),r=t,i=n,a=o)},setOp:function(t,n,r){(o!==t||s!==n||c!==r)&&(e.stencilOp(t,n,r),o=t,s=n,c=r)},setLocked:function(e){t=e},setClear:function(t){l!==t&&(e.clearStencil(t),l=t)},reset:function(){t=!1,n=null,r=null,i=null,a=null,o=null,s=null,c=null,l=null}}}let a=new n,o=new r,s=new i,c=new WeakMap,l=new WeakMap,u={},d={},f={},p=new WeakMap,m=[],h=null,g=!1,_=null,v=null,y=null,b=null,x=null,S=null,C=null,w=new Q(0,0,0),T=0,E=!1,D=null,O=null,k=null,A=null,j=null,M=e.getParameter(e.MAX_COMBINED_TEXTURE_IMAGE_UNITS),N=!1,P=0,F=e.getParameter(e.VERSION);F.indexOf(`WebGL`)===-1?F.indexOf(`OpenGL ES`)!==-1&&(P=parseFloat(/^OpenGL ES (\d)/.exec(F)[1]),N=P>=2):(P=parseFloat(/^WebGL (\d)/.exec(F)[1]),N=P>=1);let I=null,L={},ee=e.getParameter(e.SCISSOR_BOX),te=e.getParameter(e.VIEWPORT),ne=new Pt().fromArray(ee),re=new Pt().fromArray(te);function R(t,n,r,i){let a=new Uint8Array(4),o=e.createTexture();e.bindTexture(t,o),e.texParameteri(t,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(t,e.TEXTURE_MAG_FILTER,e.NEAREST);for(let o=0;o<r;o++)t===e.TEXTURE_3D||t===e.TEXTURE_2D_ARRAY?e.texImage3D(n,0,e.RGBA,1,1,i,0,e.RGBA,e.UNSIGNED_BYTE,a):e.texImage2D(n+o,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,a);return o}let ie={};ie[e.TEXTURE_2D]=R(e.TEXTURE_2D,e.TEXTURE_2D,1),ie[e.TEXTURE_CUBE_MAP]=R(e.TEXTURE_CUBE_MAP,e.TEXTURE_CUBE_MAP_POSITIVE_X,6),ie[e.TEXTURE_2D_ARRAY]=R(e.TEXTURE_2D_ARRAY,e.TEXTURE_2D_ARRAY,1,1),ie[e.TEXTURE_3D]=R(e.TEXTURE_3D,e.TEXTURE_3D,1,1),a.setClear(0,0,0,1),o.setClear(1),s.setClear(0),z(e.DEPTH_TEST),o.setFunc(3),de(!1),H(1),z(e.CULL_FACE),le(0);function z(t){u[t]!==!0&&(e.enable(t),u[t]=!0)}function B(t){u[t]!==!1&&(e.disable(t),u[t]=!1)}function ae(t,n){return f[t]!==n&&(e.bindFramebuffer(t,n),f[t]=n,t===e.DRAW_FRAMEBUFFER&&(f[e.FRAMEBUFFER]=n),t===e.FRAMEBUFFER&&(f[e.DRAW_FRAMEBUFFER]=n),!0)}function oe(t,n){let r=m,i=!1;if(t){r=p.get(n),r===void 0&&(r=[],p.set(n,r));let a=t.textures;if(r.length!==a.length||r[0]!==e.COLOR_ATTACHMENT0){for(let t=0,n=a.length;t<n;t++)r[t]=e.COLOR_ATTACHMENT0+t;r.length=a.length,i=!0}}else r[0]!==e.BACK&&(r[0]=e.BACK,i=!0);i&&e.drawBuffers(r)}function V(t){return h!==t&&(e.useProgram(t),h=t,!0)}let se={100:e.FUNC_ADD,101:e.FUNC_SUBTRACT,102:e.FUNC_REVERSE_SUBTRACT};se[103]=e.MIN,se[104]=e.MAX;let ce={200:e.ZERO,201:e.ONE,202:e.SRC_COLOR,204:e.SRC_ALPHA,210:e.SRC_ALPHA_SATURATE,208:e.DST_COLOR,206:e.DST_ALPHA,203:e.ONE_MINUS_SRC_COLOR,205:e.ONE_MINUS_SRC_ALPHA,209:e.ONE_MINUS_DST_COLOR,207:e.ONE_MINUS_DST_ALPHA,211:e.CONSTANT_COLOR,212:e.ONE_MINUS_CONSTANT_COLOR,213:e.CONSTANT_ALPHA,214:e.ONE_MINUS_CONSTANT_ALPHA};function le(t,n,r,i,a,o,s,c,l,u){if(t===0){g===!0&&(B(e.BLEND),g=!1);return}if(g===!1&&(z(e.BLEND),g=!0),t!==5){if(t!==_||u!==E){if((v!==100||x!==100)&&(e.blendEquation(e.FUNC_ADD),v=100,x=100),u)switch(t){case 1:e.blendFuncSeparate(e.ONE,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case 2:e.blendFunc(e.ONE,e.ONE);break;case 3:e.blendFuncSeparate(e.ZERO,e.ONE_MINUS_SRC_COLOR,e.ZERO,e.ONE);break;case 4:e.blendFuncSeparate(e.DST_COLOR,e.ONE_MINUS_SRC_ALPHA,e.ZERO,e.ONE);break;default:q(`WebGLState: Invalid blending: `,t)}else switch(t){case 1:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA);break;case 2:e.blendFuncSeparate(e.SRC_ALPHA,e.ONE,e.ONE,e.ONE);break;case 3:q(`WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true`);break;case 4:q(`WebGLState: MultiplyBlending requires material.premultipliedAlpha = true`);break;default:q(`WebGLState: Invalid blending: `,t)}y=null,b=null,S=null,C=null,w.set(0,0,0),T=0,_=t,E=u}return}a||=n,o||=r,s||=i,(n!==v||a!==x)&&(e.blendEquationSeparate(se[n],se[a]),v=n,x=a),(r!==y||i!==b||o!==S||s!==C)&&(e.blendFuncSeparate(ce[r],ce[i],ce[o],ce[s]),y=r,b=i,S=o,C=s),(c.equals(w)===!1||l!==T)&&(e.blendColor(c.r,c.g,c.b,l),w.copy(c),T=l),_=t,E=!1}function ue(t,n){t.side===2?B(e.CULL_FACE):z(e.CULL_FACE);let r=t.side===1;n&&(r=!r),de(r),t.blending===1&&t.transparent===!1?le(0):le(t.blending,t.blendEquation,t.blendSrc,t.blendDst,t.blendEquationAlpha,t.blendSrcAlpha,t.blendDstAlpha,t.blendColor,t.blendAlpha,t.premultipliedAlpha),o.setFunc(t.depthFunc),o.setTest(t.depthTest),o.setMask(t.depthWrite),a.setMask(t.colorWrite);let i=t.stencilWrite;s.setTest(i),i&&(s.setMask(t.stencilWriteMask),s.setFunc(t.stencilFunc,t.stencilRef,t.stencilFuncMask),s.setOp(t.stencilFail,t.stencilZFail,t.stencilZPass)),pe(t.polygonOffset,t.polygonOffsetFactor,t.polygonOffsetUnits),t.alphaToCoverage===!0?z(e.SAMPLE_ALPHA_TO_COVERAGE):B(e.SAMPLE_ALPHA_TO_COVERAGE)}function de(t){D!==t&&(t?e.frontFace(e.CW):e.frontFace(e.CCW),D=t)}function H(t){t===0?B(e.CULL_FACE):(z(e.CULL_FACE),t!==O&&(t===1?e.cullFace(e.BACK):t===2?e.cullFace(e.FRONT):e.cullFace(e.FRONT_AND_BACK))),O=t}function fe(t){t!==k&&(N&&e.lineWidth(t),k=t)}function pe(t,n,r){t?(z(e.POLYGON_OFFSET_FILL),(A!==n||j!==r)&&(A=n,j=r,o.getReversed()&&(n=-n),e.polygonOffset(n,r))):B(e.POLYGON_OFFSET_FILL)}function me(t){t?z(e.SCISSOR_TEST):B(e.SCISSOR_TEST)}function he(t){t===void 0&&(t=e.TEXTURE0+M-1),I!==t&&(e.activeTexture(t),I=t)}function ge(t,n,r){r===void 0&&(r=I===null?e.TEXTURE0+M-1:I);let i=L[r];i===void 0&&(i={type:void 0,texture:void 0},L[r]=i),(i.type!==t||i.texture!==n)&&(I!==r&&(e.activeTexture(r),I=r),e.bindTexture(t,n||ie[t]),i.type=t,i.texture=n)}function _e(){let t=L[I];t!==void 0&&t.type!==void 0&&(e.bindTexture(t.type,null),t.type=void 0,t.texture=void 0)}function ve(){try{e.compressedTexImage2D(...arguments)}catch(e){q(`WebGLState:`,e)}}function ye(){try{e.compressedTexImage3D(...arguments)}catch(e){q(`WebGLState:`,e)}}function be(){try{e.texSubImage2D(...arguments)}catch(e){q(`WebGLState:`,e)}}function xe(){try{e.texSubImage3D(...arguments)}catch(e){q(`WebGLState:`,e)}}function Se(){try{e.compressedTexSubImage2D(...arguments)}catch(e){q(`WebGLState:`,e)}}function Ce(){try{e.compressedTexSubImage3D(...arguments)}catch(e){q(`WebGLState:`,e)}}function we(){try{e.texStorage2D(...arguments)}catch(e){q(`WebGLState:`,e)}}function Te(){try{e.texStorage3D(...arguments)}catch(e){q(`WebGLState:`,e)}}function U(){try{e.texImage2D(...arguments)}catch(e){q(`WebGLState:`,e)}}function Ee(){try{e.texImage3D(...arguments)}catch(e){q(`WebGLState:`,e)}}function De(t){return d[t]===void 0?e.getParameter(t):d[t]}function Oe(t,n){d[t]!==n&&(e.pixelStorei(t,n),d[t]=n)}function W(t){ne.equals(t)===!1&&(e.scissor(t.x,t.y,t.z,t.w),ne.copy(t))}function ke(t){re.equals(t)===!1&&(e.viewport(t.x,t.y,t.z,t.w),re.copy(t))}function G(t,n){let r=l.get(n);r===void 0&&(r=new WeakMap,l.set(n,r));let i=r.get(t);i===void 0&&(i=e.getUniformBlockIndex(n,t.name),r.set(t,i))}function Ae(t,n){let r=l.get(n).get(t);c.get(n)!==r&&(e.uniformBlockBinding(n,r,t.__bindingPointIndex),c.set(n,r))}function je(){e.disable(e.BLEND),e.disable(e.CULL_FACE),e.disable(e.DEPTH_TEST),e.disable(e.POLYGON_OFFSET_FILL),e.disable(e.SCISSOR_TEST),e.disable(e.STENCIL_TEST),e.disable(e.SAMPLE_ALPHA_TO_COVERAGE),e.blendEquation(e.FUNC_ADD),e.blendFunc(e.ONE,e.ZERO),e.blendFuncSeparate(e.ONE,e.ZERO,e.ONE,e.ZERO),e.blendColor(0,0,0,0),e.colorMask(!0,!0,!0,!0),e.clearColor(0,0,0,0),e.depthMask(!0),e.depthFunc(e.LESS),o.setReversed(!1),e.clearDepth(1),e.stencilMask(4294967295),e.stencilFunc(e.ALWAYS,0,4294967295),e.stencilOp(e.KEEP,e.KEEP,e.KEEP),e.clearStencil(0),e.cullFace(e.BACK),e.frontFace(e.CCW),e.polygonOffset(0,0),e.activeTexture(e.TEXTURE0),e.bindFramebuffer(e.FRAMEBUFFER,null),e.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),e.bindFramebuffer(e.READ_FRAMEBUFFER,null),e.useProgram(null),e.lineWidth(1),e.scissor(0,0,e.canvas.width,e.canvas.height),e.viewport(0,0,e.canvas.width,e.canvas.height),e.pixelStorei(e.PACK_ALIGNMENT,4),e.pixelStorei(e.UNPACK_ALIGNMENT,4),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),e.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,e.BROWSER_DEFAULT_WEBGL),e.pixelStorei(e.PACK_ROW_LENGTH,0),e.pixelStorei(e.PACK_SKIP_PIXELS,0),e.pixelStorei(e.PACK_SKIP_ROWS,0),e.pixelStorei(e.UNPACK_ROW_LENGTH,0),e.pixelStorei(e.UNPACK_IMAGE_HEIGHT,0),e.pixelStorei(e.UNPACK_SKIP_PIXELS,0),e.pixelStorei(e.UNPACK_SKIP_ROWS,0),e.pixelStorei(e.UNPACK_SKIP_IMAGES,0),u={},d={},I=null,L={},f={},p=new WeakMap,m=[],h=null,g=!1,_=null,v=null,y=null,b=null,x=null,S=null,C=null,w=new Q(0,0,0),T=0,E=!1,D=null,O=null,k=null,A=null,j=null,ne.set(0,0,e.canvas.width,e.canvas.height),re.set(0,0,e.canvas.width,e.canvas.height),a.reset(),o.reset(),s.reset()}return{buffers:{color:a,depth:o,stencil:s},enable:z,disable:B,bindFramebuffer:ae,drawBuffers:oe,useProgram:V,setBlending:le,setMaterial:ue,setFlipSided:de,setCullFace:H,setLineWidth:fe,setPolygonOffset:pe,setScissorTest:me,activeTexture:he,bindTexture:ge,unbindTexture:_e,compressedTexImage2D:ve,compressedTexImage3D:ye,texImage2D:U,texImage3D:Ee,pixelStorei:Oe,getParameter:De,updateUBOMapping:G,uniformBlockBinding:Ae,texStorage2D:we,texStorage3D:Te,texSubImage2D:be,texSubImage3D:xe,compressedTexSubImage2D:Se,compressedTexSubImage3D:Ce,scissor:W,viewport:ke,reset:je}}function sl(e,t,n,r,i,a,o){let s=t.has(`WEBGL_multisampled_render_to_texture`)?t.get(`WEBGL_multisampled_render_to_texture`):null,c=typeof navigator>`u`?!1:/OculusBrowser/g.test(navigator.userAgent),l=new Y,u=new WeakMap,d=new Set,f,S=new WeakMap,C=!1;try{C=typeof OffscreenCanvas<`u`&&new OffscreenCanvas(1,1).getContext(`2d`)!==null}catch{}function w(e,t){return C?new OffscreenCanvas(e,t):$e(`canvas`)}function T(e,t,n){let r=1,i=De(e);if((i.width>n||i.height>n)&&(r=n/Math.max(i.width,i.height)),r<1){if(typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<`u`&&e instanceof HTMLCanvasElement||typeof ImageBitmap<`u`&&e instanceof ImageBitmap||typeof VideoFrame<`u`&&e instanceof VideoFrame){let n=Math.floor(r*i.width),a=Math.floor(r*i.height);f===void 0&&(f=w(n,a));let o=t?w(n,a):f;return o.width=n,o.height=a,o.getContext(`2d`).drawImage(e,0,0,n,a),K(`WebGLRenderer: Texture has been resized from (`+i.width+`x`+i.height+`) to (`+n+`x`+a+`).`),o}return`data`in e&&K(`WebGLRenderer: Image in DataTexture is too big (`+i.width+`x`+i.height+`).`),e}return e}function E(e){return e.generateMipmaps}function D(t){e.generateMipmap(t)}function O(t){return t.isWebGLCubeRenderTarget?e.TEXTURE_CUBE_MAP:t.isWebGL3DRenderTarget?e.TEXTURE_3D:t.isWebGLArrayRenderTarget||t.isCompressedArrayTexture?e.TEXTURE_2D_ARRAY:e.TEXTURE_2D}function k(n,r,i,a,o,s=!1){if(n!==null){if(e[n]!==void 0)return e[n];K(`WebGLRenderer: Attempt to use non-existing WebGL internal format '`+n+`'`)}let c;a&&(c=t.get(`EXT_texture_norm16`),c||K(`WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension`));let l=r;if(r===e.RED&&(i===e.FLOAT&&(l=e.R32F),i===e.HALF_FLOAT&&(l=e.R16F),i===e.UNSIGNED_BYTE&&(l=e.R8),i===e.UNSIGNED_SHORT&&c&&(l=c.R16_EXT),i===e.SHORT&&c&&(l=c.R16_SNORM_EXT)),r===e.RED_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.R8UI),i===e.UNSIGNED_SHORT&&(l=e.R16UI),i===e.UNSIGNED_INT&&(l=e.R32UI),i===e.BYTE&&(l=e.R8I),i===e.SHORT&&(l=e.R16I),i===e.INT&&(l=e.R32I)),r===e.RG&&(i===e.FLOAT&&(l=e.RG32F),i===e.HALF_FLOAT&&(l=e.RG16F),i===e.UNSIGNED_BYTE&&(l=e.RG8),i===e.UNSIGNED_SHORT&&c&&(l=c.RG16_EXT),i===e.SHORT&&c&&(l=c.RG16_SNORM_EXT)),r===e.RG_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.RG8UI),i===e.UNSIGNED_SHORT&&(l=e.RG16UI),i===e.UNSIGNED_INT&&(l=e.RG32UI),i===e.BYTE&&(l=e.RG8I),i===e.SHORT&&(l=e.RG16I),i===e.INT&&(l=e.RG32I)),r===e.RGB_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.RGB8UI),i===e.UNSIGNED_SHORT&&(l=e.RGB16UI),i===e.UNSIGNED_INT&&(l=e.RGB32UI),i===e.BYTE&&(l=e.RGB8I),i===e.SHORT&&(l=e.RGB16I),i===e.INT&&(l=e.RGB32I)),r===e.RGBA_INTEGER&&(i===e.UNSIGNED_BYTE&&(l=e.RGBA8UI),i===e.UNSIGNED_SHORT&&(l=e.RGBA16UI),i===e.UNSIGNED_INT&&(l=e.RGBA32UI),i===e.BYTE&&(l=e.RGBA8I),i===e.SHORT&&(l=e.RGBA16I),i===e.INT&&(l=e.RGBA32I)),r===e.RGB&&(i===e.UNSIGNED_SHORT&&c&&(l=c.RGB16_EXT),i===e.SHORT&&c&&(l=c.RGB16_SNORM_EXT),i===e.UNSIGNED_INT_5_9_9_9_REV&&(l=e.RGB9_E5),i===e.UNSIGNED_INT_10F_11F_11F_REV&&(l=e.R11F_G11F_B10F)),r===e.RGBA){let t=s?Ge:Ct.getTransfer(o);i===e.FLOAT&&(l=e.RGBA32F),i===e.HALF_FLOAT&&(l=e.RGBA16F),i===e.UNSIGNED_BYTE&&(l=t===`srgb`?e.SRGB8_ALPHA8:e.RGBA8),i===e.UNSIGNED_SHORT&&c&&(l=c.RGBA16_EXT),i===e.SHORT&&c&&(l=c.RGBA16_SNORM_EXT),i===e.UNSIGNED_SHORT_4_4_4_4&&(l=e.RGBA4),i===e.UNSIGNED_SHORT_5_5_5_1&&(l=e.RGB5_A1)}return(l===e.R16F||l===e.R32F||l===e.RG16F||l===e.RG32F||l===e.RGBA16F||l===e.RGBA32F)&&t.get(`EXT_color_buffer_float`),l}function A(t,n){let r;return t?n===null||n===1014||n===1020?r=e.DEPTH24_STENCIL8:n===1015?r=e.DEPTH32F_STENCIL8:n===1012&&(r=e.DEPTH24_STENCIL8,K(`DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.`)):n===null||n===1014||n===1020?r=e.DEPTH_COMPONENT24:n===1015?r=e.DEPTH_COMPONENT32F:n===1012&&(r=e.DEPTH_COMPONENT16),r}function j(e,t){return E(e)===!0||e.isFramebufferTexture&&e.minFilter!==1003&&e.minFilter!==1006?Math.log2(Math.max(t.width,t.height))+1:e.mipmaps!==void 0&&e.mipmaps.length>0?e.mipmaps.length:e.isCompressedTexture&&Array.isArray(e.image)?t.mipmaps.length:1}function M(e){let t=e.target;t.removeEventListener(`dispose`,M),P(t),t.isVideoTexture&&u.delete(t),t.isHTMLTexture&&d.delete(t)}function N(e){let t=e.target;t.removeEventListener(`dispose`,N),I(t)}function P(e){let t=r.get(e);if(t.__webglInit===void 0)return;let n=e.source,i=S.get(n);if(i){let r=i[t.__cacheKey];r.usedTimes--,r.usedTimes===0&&F(e),Object.keys(i).length===0&&S.delete(n)}r.remove(e)}function F(t){let n=r.get(t);e.deleteTexture(n.__webglTexture);let i=t.source,a=S.get(i);delete a[n.__cacheKey],o.memory.textures--}function I(t){let n=r.get(t);if(t.depthTexture&&(t.depthTexture.dispose(),r.remove(t.depthTexture)),t.isWebGLCubeRenderTarget)for(let t=0;t<6;t++){if(Array.isArray(n.__webglFramebuffer[t]))for(let r=0;r<n.__webglFramebuffer[t].length;r++)e.deleteFramebuffer(n.__webglFramebuffer[t][r]);else e.deleteFramebuffer(n.__webglFramebuffer[t]);n.__webglDepthbuffer&&e.deleteRenderbuffer(n.__webglDepthbuffer[t])}else{if(Array.isArray(n.__webglFramebuffer))for(let t=0;t<n.__webglFramebuffer.length;t++)e.deleteFramebuffer(n.__webglFramebuffer[t]);else e.deleteFramebuffer(n.__webglFramebuffer);if(n.__webglDepthbuffer&&e.deleteRenderbuffer(n.__webglDepthbuffer),n.__webglMultisampledFramebuffer&&e.deleteFramebuffer(n.__webglMultisampledFramebuffer),n.__webglColorRenderbuffer)for(let t=0;t<n.__webglColorRenderbuffer.length;t++)n.__webglColorRenderbuffer[t]&&e.deleteRenderbuffer(n.__webglColorRenderbuffer[t]);n.__webglDepthRenderbuffer&&e.deleteRenderbuffer(n.__webglDepthRenderbuffer)}let i=t.textures;for(let t=0,n=i.length;t<n;t++){let n=r.get(i[t]);n.__webglTexture&&(e.deleteTexture(n.__webglTexture),o.memory.textures--),r.remove(i[t])}r.remove(t)}let L=0;function ee(){L=0}function ne(){return L}function re(e){L=e}function R(){let e=L;return e>=i.maxTextures&&K(`WebGLTextures: Trying to use `+(e+1)+` texture units while this GPU supports only `+i.maxTextures),L+=1,e}function ie(e){let t=[];return t.push(e.wrapS),t.push(e.wrapT),t.push(e.wrapR||0),t.push(e.magFilter),t.push(e.minFilter),t.push(e.anisotropy),t.push(e.internalFormat),t.push(e.format),t.push(e.type),t.push(e.generateMipmaps),t.push(e.premultiplyAlpha),t.push(e.flipY),t.push(e.unpackAlignment),t.push(e.colorSpace),t.join()}function z(t,i){let a=r.get(t);if(t.isVideoTexture&&U(t),t.isRenderTargetTexture===!1&&t.isExternalTexture!==!0&&t.version>0&&a.__version!==t.version){let e=t.image;if(e===null)K(`WebGLRenderer: Texture marked for update but no image data found.`);else if(e.complete===!1)K(`WebGLRenderer: Texture marked for update but image is incomplete`);else{fe(a,t,i);return}}else t.isExternalTexture&&(a.__webglTexture=t.sourceTexture?t.sourceTexture:null);n.bindTexture(e.TEXTURE_2D,a.__webglTexture,e.TEXTURE0+i)}function B(t,i){let a=r.get(t);if(t.isRenderTargetTexture===!1&&t.version>0&&a.__version!==t.version){fe(a,t,i);return}t.isExternalTexture&&(a.__webglTexture=t.sourceTexture?t.sourceTexture:null),n.bindTexture(e.TEXTURE_2D_ARRAY,a.__webglTexture,e.TEXTURE0+i)}function ae(t,i){let a=r.get(t);if(t.isRenderTargetTexture===!1&&t.version>0&&a.__version!==t.version){fe(a,t,i);return}n.bindTexture(e.TEXTURE_3D,a.__webglTexture,e.TEXTURE0+i)}function oe(t,i){let a=r.get(t);if(t.isCubeDepthTexture!==!0&&t.version>0&&a.__version!==t.version){pe(a,t,i);return}n.bindTexture(e.TEXTURE_CUBE_MAP,a.__webglTexture,e.TEXTURE0+i)}let V={[p]:e.REPEAT,[m]:e.CLAMP_TO_EDGE,[h]:e.MIRRORED_REPEAT},se={[g]:e.NEAREST,[_]:e.NEAREST_MIPMAP_NEAREST,[v]:e.NEAREST_MIPMAP_LINEAR,[y]:e.LINEAR,[b]:e.LINEAR_MIPMAP_NEAREST,[x]:e.LINEAR_MIPMAP_LINEAR},ce={512:e.NEVER,519:e.ALWAYS,513:e.LESS,515:e.LEQUAL,514:e.EQUAL,518:e.GEQUAL,516:e.GREATER,517:e.NOTEQUAL};function le(n,a){if(a.type===1015&&t.has(`OES_texture_float_linear`)===!1&&(a.magFilter===1006||a.magFilter===1007||a.magFilter===1005||a.magFilter===1008||a.minFilter===1006||a.minFilter===1007||a.minFilter===1005||a.minFilter===1008)&&K(`WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device.`),e.texParameteri(n,e.TEXTURE_WRAP_S,V[a.wrapS]),e.texParameteri(n,e.TEXTURE_WRAP_T,V[a.wrapT]),(n===e.TEXTURE_3D||n===e.TEXTURE_2D_ARRAY)&&e.texParameteri(n,e.TEXTURE_WRAP_R,V[a.wrapR]),e.texParameteri(n,e.TEXTURE_MAG_FILTER,se[a.magFilter]),e.texParameteri(n,e.TEXTURE_MIN_FILTER,se[a.minFilter]),a.compareFunction&&(e.texParameteri(n,e.TEXTURE_COMPARE_MODE,e.COMPARE_REF_TO_TEXTURE),e.texParameteri(n,e.TEXTURE_COMPARE_FUNC,ce[a.compareFunction])),t.has(`EXT_texture_filter_anisotropic`)===!0){if(a.magFilter===1003||a.minFilter!==1005&&a.minFilter!==1008||a.type===1015&&t.has(`OES_texture_float_linear`)===!1)return;if(a.anisotropy>1||r.get(a).__currentAnisotropy){let o=t.get(`EXT_texture_filter_anisotropic`);e.texParameterf(n,o.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(a.anisotropy,i.getMaxAnisotropy())),r.get(a).__currentAnisotropy=a.anisotropy}}}function ue(t,n){let r=!1;t.__webglInit===void 0&&(t.__webglInit=!0,n.addEventListener(`dispose`,M));let i=n.source,a=S.get(i);a===void 0&&(a={},S.set(i,a));let s=ie(n);if(s!==t.__cacheKey){a[s]===void 0&&(a[s]={texture:e.createTexture(),usedTimes:0},o.memory.textures++,r=!0),a[s].usedTimes++;let i=a[t.__cacheKey];i!==void 0&&(a[t.__cacheKey].usedTimes--,i.usedTimes===0&&F(n)),t.__cacheKey=s,t.__webglTexture=a[s].texture}return r}function de(e,t,n){return Math.floor(Math.floor(e/n)/t)}function H(t,r,i,a){let o=t.updateRanges;if(o.length===0)n.texSubImage2D(e.TEXTURE_2D,0,0,0,r.width,r.height,i,a,r.data);else{o.sort((e,t)=>e.start-t.start);let s=0;for(let e=1;e<o.length;e++){let t=o[s],n=o[e],i=t.start+t.count,a=de(n.start,r.width,4),c=de(t.start,r.width,4);n.start<=i+1&&a===c&&de(n.start+n.count-1,r.width,4)===a?t.count=Math.max(t.count,n.start+n.count-t.start):(++s,o[s]=n)}o.length=s+1;let c=n.getParameter(e.UNPACK_ROW_LENGTH),l=n.getParameter(e.UNPACK_SKIP_PIXELS),u=n.getParameter(e.UNPACK_SKIP_ROWS);n.pixelStorei(e.UNPACK_ROW_LENGTH,r.width);for(let t=0,s=o.length;t<s;t++){let s=o[t],c=Math.floor(s.start/4),l=Math.ceil(s.count/4),u=c%r.width,d=Math.floor(c/r.width),f=l;n.pixelStorei(e.UNPACK_SKIP_PIXELS,u),n.pixelStorei(e.UNPACK_SKIP_ROWS,d),n.texSubImage2D(e.TEXTURE_2D,0,u,d,f,1,i,a,r.data)}t.clearUpdateRanges(),n.pixelStorei(e.UNPACK_ROW_LENGTH,c),n.pixelStorei(e.UNPACK_SKIP_PIXELS,l),n.pixelStorei(e.UNPACK_SKIP_ROWS,u)}}function fe(t,o,s){let c=e.TEXTURE_2D;(o.isDataArrayTexture||o.isCompressedArrayTexture)&&(c=e.TEXTURE_2D_ARRAY),o.isData3DTexture&&(c=e.TEXTURE_3D);let l=ue(t,o),u=o.source;n.bindTexture(c,t.__webglTexture,e.TEXTURE0+s);let f=r.get(u);if(u.version!==f.__version||l===!0){if(n.activeTexture(e.TEXTURE0+s),!(typeof ImageBitmap<`u`&&o.image instanceof ImageBitmap)){let t=Ct.getPrimaries(Ct.workingColorSpace),r=o.colorSpace===``?null:Ct.getPrimaries(o.colorSpace),i=o.colorSpace===``||t===r?e.NONE:e.BROWSER_DEFAULT_WEBGL;n.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,o.flipY),n.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,o.premultiplyAlpha),n.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,i)}n.pixelStorei(e.UNPACK_ALIGNMENT,o.unpackAlignment);let t=T(o.image,!1,i.maxTextureSize);t=Ee(o,t);let r=a.convert(o.format,o.colorSpace),p=a.convert(o.type),m=k(o.internalFormat,r,p,o.normalized,o.colorSpace,o.isVideoTexture);le(c,o);let h,g=o.mipmaps,_=o.isVideoTexture!==!0,v=f.__version===void 0||l===!0,y=u.dataReady,b=j(o,t);if(o.isDepthTexture)m=A(o.format===te,o.type),v&&(_?n.texStorage2D(e.TEXTURE_2D,1,m,t.width,t.height):n.texImage2D(e.TEXTURE_2D,0,m,t.width,t.height,0,r,p,null));else if(o.isDataTexture){if(g.length>0){_&&v&&n.texStorage2D(e.TEXTURE_2D,b,m,g[0].width,g[0].height);for(let t=0,i=g.length;t<i;t++)h=g[t],_?y&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,h.width,h.height,r,p,h.data):n.texImage2D(e.TEXTURE_2D,t,m,h.width,h.height,0,r,p,h.data);o.generateMipmaps=!1}else _?(v&&n.texStorage2D(e.TEXTURE_2D,b,m,t.width,t.height),y&&H(o,t,r,p)):n.texImage2D(e.TEXTURE_2D,0,m,t.width,t.height,0,r,p,t.data)}else if(o.isCompressedTexture){if(o.isCompressedArrayTexture){_&&v&&n.texStorage3D(e.TEXTURE_2D_ARRAY,b,m,g[0].width,g[0].height,t.depth);for(let i=0,a=g.length;i<a;i++)if(h=g[i],o.format!==1023){if(r!==null){if(_){if(y){if(o.layerUpdates.size>0){let t=eo(h.width,h.height,o.format,o.type);for(let a of o.layerUpdates){let o=h.data.subarray(a*t/h.data.BYTES_PER_ELEMENT,(a+1)*t/h.data.BYTES_PER_ELEMENT);n.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,i,0,0,a,h.width,h.height,1,r,o)}}else n.compressedTexSubImage3D(e.TEXTURE_2D_ARRAY,i,0,0,0,h.width,h.height,t.depth,r,h.data)}}else n.compressedTexImage3D(e.TEXTURE_2D_ARRAY,i,m,h.width,h.height,t.depth,0,h.data,0,0)}else K(`WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()`)}else _?y&&n.texSubImage3D(e.TEXTURE_2D_ARRAY,i,0,0,0,h.width,h.height,t.depth,r,p,h.data):n.texImage3D(e.TEXTURE_2D_ARRAY,i,m,h.width,h.height,t.depth,0,r,p,h.data);o.layerUpdates.size>0&&o.clearLayerUpdates()}else{_&&v&&n.texStorage2D(e.TEXTURE_2D,b,m,g[0].width,g[0].height);for(let t=0,i=g.length;t<i;t++)h=g[t],o.format===1023?_?y&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,h.width,h.height,r,p,h.data):n.texImage2D(e.TEXTURE_2D,t,m,h.width,h.height,0,r,p,h.data):r===null?K(`WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()`):_?y&&n.compressedTexSubImage2D(e.TEXTURE_2D,t,0,0,h.width,h.height,r,h.data):n.compressedTexImage2D(e.TEXTURE_2D,t,m,h.width,h.height,0,h.data)}}else if(o.isDataArrayTexture){if(_){if(v&&n.texStorage3D(e.TEXTURE_2D_ARRAY,b,m,t.width,t.height,t.depth),y){if(o.layerUpdates.size>0){let i=eo(t.width,t.height,o.format,o.type);for(let a of o.layerUpdates){let o=t.data.subarray(a*i/t.data.BYTES_PER_ELEMENT,(a+1)*i/t.data.BYTES_PER_ELEMENT);n.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,a,t.width,t.height,1,r,p,o)}o.clearLayerUpdates()}else n.texSubImage3D(e.TEXTURE_2D_ARRAY,0,0,0,0,t.width,t.height,t.depth,r,p,t.data)}}else n.texImage3D(e.TEXTURE_2D_ARRAY,0,m,t.width,t.height,t.depth,0,r,p,t.data)}else if(o.isData3DTexture)_?(v&&n.texStorage3D(e.TEXTURE_3D,b,m,t.width,t.height,t.depth),y&&n.texSubImage3D(e.TEXTURE_3D,0,0,0,0,t.width,t.height,t.depth,r,p,t.data)):n.texImage3D(e.TEXTURE_3D,0,m,t.width,t.height,t.depth,0,r,p,t.data);else if(o.isFramebufferTexture){if(v){if(_)n.texStorage2D(e.TEXTURE_2D,b,m,t.width,t.height);else{let i=t.width,a=t.height;for(let t=0;t<b;t++)n.texImage2D(e.TEXTURE_2D,t,m,i,a,0,r,p,null),i>>=1,a>>=1}}}else if(o.isHTMLTexture){if(`texElementImage2D`in e){let n=e.canvas;if(n.hasAttribute(`layoutsubtree`)||n.setAttribute(`layoutsubtree`,`true`),t.parentNode!==n){n.appendChild(t),d.add(o),n.onpaint=e=>{let t=e.changedElements;for(let e of d)t.includes(e.image)&&(e.needsUpdate=!0)},n.requestPaint();return}if(e.texElementImage2D.length===3)e.texElementImage2D(e.TEXTURE_2D,e.RGBA8,t);else{let n=e.RGBA,r=e.RGBA,i=e.UNSIGNED_BYTE;e.texElementImage2D(e.TEXTURE_2D,0,n,r,i,t)}e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}}else if(g.length>0){if(_&&v){let t=De(g[0]);n.texStorage2D(e.TEXTURE_2D,b,m,t.width,t.height)}for(let t=0,i=g.length;t<i;t++)h=g[t],_?y&&n.texSubImage2D(e.TEXTURE_2D,t,0,0,r,p,h):n.texImage2D(e.TEXTURE_2D,t,m,r,p,h);o.generateMipmaps=!1}else if(_){if(v){let r=De(t);n.texStorage2D(e.TEXTURE_2D,b,m,r.width,r.height)}y&&n.texSubImage2D(e.TEXTURE_2D,0,0,0,r,p,t)}else n.texImage2D(e.TEXTURE_2D,0,m,r,p,t);E(o)&&D(c),f.__version=u.version,o.onUpdate&&o.onUpdate(o)}t.__version=o.version}function pe(t,o,s){if(o.image.length!==6)return;let c=ue(t,o),l=o.source;n.bindTexture(e.TEXTURE_CUBE_MAP,t.__webglTexture,e.TEXTURE0+s);let u=r.get(l);if(l.version!==u.__version||c===!0){n.activeTexture(e.TEXTURE0+s);let t=Ct.getPrimaries(Ct.workingColorSpace),r=o.colorSpace===``?null:Ct.getPrimaries(o.colorSpace),d=o.colorSpace===``||t===r?e.NONE:e.BROWSER_DEFAULT_WEBGL;n.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,o.flipY),n.pixelStorei(e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,o.premultiplyAlpha),n.pixelStorei(e.UNPACK_ALIGNMENT,o.unpackAlignment),n.pixelStorei(e.UNPACK_COLORSPACE_CONVERSION_WEBGL,d);let f=o.isCompressedTexture||o.image[0].isCompressedTexture,p=o.image[0]&&o.image[0].isDataTexture,m=[];for(let e=0;e<6;e++)!f&&!p?m[e]=T(o.image[e],!0,i.maxCubemapSize):m[e]=p?o.image[e].image:o.image[e],m[e]=Ee(o,m[e]);let h=m[0],g=a.convert(o.format,o.colorSpace),_=a.convert(o.type),v=k(o.internalFormat,g,_,o.normalized,o.colorSpace),y=o.isVideoTexture!==!0,b=u.__version===void 0||c===!0,x=l.dataReady,S=j(o,h);le(e.TEXTURE_CUBE_MAP,o);let C;if(f){y&&b&&n.texStorage2D(e.TEXTURE_CUBE_MAP,S,v,h.width,h.height);for(let t=0;t<6;t++){C=m[t].mipmaps;for(let r=0;r<C.length;r++){let i=C[r];o.format===1023?y?x&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,0,0,i.width,i.height,g,_,i.data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,v,i.width,i.height,0,g,_,i.data):g===null?K(`WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()`):y?x&&n.compressedTexSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,0,0,i.width,i.height,g,i.data):n.compressedTexImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r,v,i.width,i.height,0,i.data)}}}else{if(C=o.mipmaps,y&&b){C.length>0&&S++;let t=De(m[0]);n.texStorage2D(e.TEXTURE_CUBE_MAP,S,v,t.width,t.height)}for(let t=0;t<6;t++)if(p){y?x&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,0,0,m[t].width,m[t].height,g,_,m[t].data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,v,m[t].width,m[t].height,0,g,_,m[t].data);for(let r=0;r<C.length;r++){let i=C[r].image[t].image;y?x&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,0,0,i.width,i.height,g,_,i.data):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,v,i.width,i.height,0,g,_,i.data)}}else{y?x&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,0,0,g,_,m[t]):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,0,v,g,_,m[t]);for(let r=0;r<C.length;r++){let i=C[r];y?x&&n.texSubImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,0,0,g,_,i.image[t]):n.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+t,r+1,v,g,_,i.image[t])}}}E(o)&&D(e.TEXTURE_CUBE_MAP),u.__version=l.version,o.onUpdate&&o.onUpdate(o)}t.__version=o.version}function me(t,i,o,c,l,u){let d=a.convert(o.format,o.colorSpace),f=a.convert(o.type),p=k(o.internalFormat,d,f,o.normalized,o.colorSpace),m=r.get(i),h=r.get(o);if(h.__renderTarget=i,!m.__hasExternalTextures){let t=Math.max(1,i.width>>u),r=Math.max(1,i.height>>u);l===e.TEXTURE_3D||l===e.TEXTURE_2D_ARRAY?n.texImage3D(l,u,p,t,r,i.depth,0,d,f,null):n.texImage2D(l,u,p,t,r,0,d,f,null)}n.bindFramebuffer(e.FRAMEBUFFER,t),Te(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,c,l,h.__webglTexture,0,we(i)):(l===e.TEXTURE_2D||l>=e.TEXTURE_CUBE_MAP_POSITIVE_X&&l<=e.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&e.framebufferTexture2D(e.FRAMEBUFFER,c,l,h.__webglTexture,u),n.bindFramebuffer(e.FRAMEBUFFER,null)}function he(t,n,r){if(e.bindRenderbuffer(e.RENDERBUFFER,t),n.depthBuffer){let i=n.depthTexture,a=i&&i.isDepthTexture?i.type:null,o=A(n.stencilBuffer,a),c=n.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;Te(n)?s.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,we(n),o,n.width,n.height):r?e.renderbufferStorageMultisample(e.RENDERBUFFER,we(n),o,n.width,n.height):e.renderbufferStorage(e.RENDERBUFFER,o,n.width,n.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,c,e.RENDERBUFFER,t)}else{let t=n.textures;for(let i=0;i<t.length;i++){let o=t[i],c=a.convert(o.format,o.colorSpace),l=a.convert(o.type),u=k(o.internalFormat,c,l,o.normalized,o.colorSpace);Te(n)?s.renderbufferStorageMultisampleEXT(e.RENDERBUFFER,we(n),u,n.width,n.height):r?e.renderbufferStorageMultisample(e.RENDERBUFFER,we(n),u,n.width,n.height):e.renderbufferStorage(e.RENDERBUFFER,u,n.width,n.height)}}e.bindRenderbuffer(e.RENDERBUFFER,null)}function ge(t,i,o){let c=i.isWebGLCubeRenderTarget===!0;if(n.bindFramebuffer(e.FRAMEBUFFER,t),!(i.depthTexture&&i.depthTexture.isDepthTexture))throw Error(`THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.`);let l=r.get(i.depthTexture);if(l.__renderTarget=i,(!l.__webglTexture||i.depthTexture.image.width!==i.width||i.depthTexture.image.height!==i.height)&&(i.depthTexture.image.width=i.width,i.depthTexture.image.height=i.height,i.depthTexture.needsUpdate=!0),c){if(l.__webglInit===void 0&&(l.__webglInit=!0,i.depthTexture.addEventListener(`dispose`,M)),l.__webglTexture===void 0){l.__webglTexture=e.createTexture(),n.bindTexture(e.TEXTURE_CUBE_MAP,l.__webglTexture),le(e.TEXTURE_CUBE_MAP,i.depthTexture);let t=a.convert(i.depthTexture.format),r=a.convert(i.depthTexture.type),o;i.depthTexture.format===1026?o=e.DEPTH_COMPONENT24:i.depthTexture.format===1027&&(o=e.DEPTH24_STENCIL8);for(let n=0;n<6;n++)e.texImage2D(e.TEXTURE_CUBE_MAP_POSITIVE_X+n,0,o,i.width,i.height,0,t,r,null)}}else z(i.depthTexture,0);let u=l.__webglTexture,d=we(i),f=c?e.TEXTURE_CUBE_MAP_POSITIVE_X+o:e.TEXTURE_2D,p=i.depthTexture.format===1027?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;if(i.depthTexture.format===1026)Te(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,p,f,u,0,d):e.framebufferTexture2D(e.FRAMEBUFFER,p,f,u,0);else if(i.depthTexture.format===1027)Te(i)?s.framebufferTexture2DMultisampleEXT(e.FRAMEBUFFER,p,f,u,0,d):e.framebufferTexture2D(e.FRAMEBUFFER,p,f,u,0);else throw Error(`THREE.WebGLTextures: Unknown depthTexture format.`)}function _e(t){let i=r.get(t),a=t.isWebGLCubeRenderTarget===!0;if(i.__boundDepthTexture!==t.depthTexture){let e=t.depthTexture;if(i.__depthDisposeCallback&&i.__depthDisposeCallback(),e){let t=()=>{delete i.__boundDepthTexture,delete i.__depthDisposeCallback,e.removeEventListener(`dispose`,t)};e.addEventListener(`dispose`,t),i.__depthDisposeCallback=t}i.__boundDepthTexture=e}if(t.depthTexture&&!i.__autoAllocateDepthBuffer){if(a)for(let e=0;e<6;e++)ge(i.__webglFramebuffer[e],t,e);else{let e=t.texture.mipmaps;e&&e.length>0?ge(i.__webglFramebuffer[0],t,0):ge(i.__webglFramebuffer,t,0)}}else if(a){i.__webglDepthbuffer=[];for(let r=0;r<6;r++)if(n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer[r]),i.__webglDepthbuffer[r]===void 0)i.__webglDepthbuffer[r]=e.createRenderbuffer(),he(i.__webglDepthbuffer[r],t,!1);else{let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,a=i.__webglDepthbuffer[r];e.bindRenderbuffer(e.RENDERBUFFER,a),e.framebufferRenderbuffer(e.FRAMEBUFFER,n,e.RENDERBUFFER,a)}}else{let r=t.texture.mipmaps;if(r&&r.length>0?n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer[0]):n.bindFramebuffer(e.FRAMEBUFFER,i.__webglFramebuffer),i.__webglDepthbuffer===void 0)i.__webglDepthbuffer=e.createRenderbuffer(),he(i.__webglDepthbuffer,t,!1);else{let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,r=i.__webglDepthbuffer;e.bindRenderbuffer(e.RENDERBUFFER,r),e.framebufferRenderbuffer(e.FRAMEBUFFER,n,e.RENDERBUFFER,r)}}n.bindFramebuffer(e.FRAMEBUFFER,null)}function ve(t,n,i){let a=r.get(t);n!==void 0&&me(a.__webglFramebuffer,t,t.texture,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,0),i!==void 0&&_e(t)}function ye(t){let i=t.texture,s=r.get(t),c=r.get(i);t.addEventListener(`dispose`,N);let l=t.textures,u=t.isWebGLCubeRenderTarget===!0,d=l.length>1;if(d||(c.__webglTexture===void 0&&(c.__webglTexture=e.createTexture()),c.__version=i.version,o.memory.textures++),u){s.__webglFramebuffer=[];for(let t=0;t<6;t++)if(i.mipmaps&&i.mipmaps.length>0){s.__webglFramebuffer[t]=[];for(let n=0;n<i.mipmaps.length;n++)s.__webglFramebuffer[t][n]=e.createFramebuffer()}else s.__webglFramebuffer[t]=e.createFramebuffer()}else{if(i.mipmaps&&i.mipmaps.length>0){s.__webglFramebuffer=[];for(let t=0;t<i.mipmaps.length;t++)s.__webglFramebuffer[t]=e.createFramebuffer()}else s.__webglFramebuffer=e.createFramebuffer();if(d)for(let t=0,n=l.length;t<n;t++){let n=r.get(l[t]);n.__webglTexture===void 0&&(n.__webglTexture=e.createTexture(),o.memory.textures++)}if(t.samples>0&&Te(t)===!1){s.__webglMultisampledFramebuffer=e.createFramebuffer(),s.__webglColorRenderbuffer=[],n.bindFramebuffer(e.FRAMEBUFFER,s.__webglMultisampledFramebuffer);for(let n=0;n<l.length;n++){let r=l[n];s.__webglColorRenderbuffer[n]=e.createRenderbuffer(),e.bindRenderbuffer(e.RENDERBUFFER,s.__webglColorRenderbuffer[n]);let i=a.convert(r.format,r.colorSpace),o=a.convert(r.type),c=k(r.internalFormat,i,o,r.normalized,r.colorSpace,t.isXRRenderTarget===!0),u=we(t);e.renderbufferStorageMultisample(e.RENDERBUFFER,u,c,t.width,t.height),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+n,e.RENDERBUFFER,s.__webglColorRenderbuffer[n])}e.bindRenderbuffer(e.RENDERBUFFER,null),t.depthBuffer&&(s.__webglDepthRenderbuffer=e.createRenderbuffer(),he(s.__webglDepthRenderbuffer,t,!0)),n.bindFramebuffer(e.FRAMEBUFFER,null)}}if(u){n.bindTexture(e.TEXTURE_CUBE_MAP,c.__webglTexture),le(e.TEXTURE_CUBE_MAP,i);for(let n=0;n<6;n++)if(i.mipmaps&&i.mipmaps.length>0)for(let r=0;r<i.mipmaps.length;r++)me(s.__webglFramebuffer[n][r],t,i,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+n,r);else me(s.__webglFramebuffer[n],t,i,e.COLOR_ATTACHMENT0,e.TEXTURE_CUBE_MAP_POSITIVE_X+n,0);E(i)&&D(e.TEXTURE_CUBE_MAP),n.unbindTexture()}else if(d){for(let i=0,a=l.length;i<a;i++){let a=l[i],o=r.get(a),c=e.TEXTURE_2D;(t.isWebGL3DRenderTarget||t.isWebGLArrayRenderTarget)&&(c=t.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),n.bindTexture(c,o.__webglTexture),le(c,a),me(s.__webglFramebuffer,t,a,e.COLOR_ATTACHMENT0+i,c,0),E(a)&&D(c)}n.unbindTexture()}else{let r=e.TEXTURE_2D;if((t.isWebGL3DRenderTarget||t.isWebGLArrayRenderTarget)&&(r=t.isWebGL3DRenderTarget?e.TEXTURE_3D:e.TEXTURE_2D_ARRAY),n.bindTexture(r,c.__webglTexture),le(r,i),i.mipmaps&&i.mipmaps.length>0)for(let n=0;n<i.mipmaps.length;n++)me(s.__webglFramebuffer[n],t,i,e.COLOR_ATTACHMENT0,r,n);else me(s.__webglFramebuffer,t,i,e.COLOR_ATTACHMENT0,r,0);E(i)&&D(r),n.unbindTexture()}t.depthBuffer&&_e(t)}function be(e){let t=e.textures;for(let i=0,a=t.length;i<a;i++){let a=t[i];if(E(a)){let t=O(e),i=r.get(a).__webglTexture;n.bindTexture(t,i),D(t),n.unbindTexture()}}}let xe=[],Se=[];function Ce(t){if(t.samples>0){if(Te(t)===!1){let i=t.textures,a=t.width,o=t.height,s=e.COLOR_BUFFER_BIT,l=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT,u=r.get(t),d=i.length>1;if(d)for(let t=0;t<i.length;t++)n.bindFramebuffer(e.FRAMEBUFFER,u.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.RENDERBUFFER,null),n.bindFramebuffer(e.FRAMEBUFFER,u.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.TEXTURE_2D,null,0);n.bindFramebuffer(e.READ_FRAMEBUFFER,u.__webglMultisampledFramebuffer);let f=t.texture.mipmaps;f&&f.length>0?n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglFramebuffer[0]):n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglFramebuffer);for(let n=0;n<i.length;n++){if(t.resolveDepthBuffer&&(t.depthBuffer&&(s|=e.DEPTH_BUFFER_BIT),t.stencilBuffer&&t.resolveStencilBuffer&&(s|=e.STENCIL_BUFFER_BIT)),d){e.framebufferRenderbuffer(e.READ_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.RENDERBUFFER,u.__webglColorRenderbuffer[n]);let t=r.get(i[n]).__webglTexture;e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,t,0)}e.blitFramebuffer(0,0,a,o,0,0,a,o,s,e.NEAREST),c===!0&&(xe.length=0,Se.length=0,xe.push(e.COLOR_ATTACHMENT0+n),t.depthBuffer&&t.storeMultisampledDepthBuffer===!1&&(xe.push(l),Se.push(l),e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,Se)),e.invalidateFramebuffer(e.READ_FRAMEBUFFER,xe))}if(n.bindFramebuffer(e.READ_FRAMEBUFFER,null),n.bindFramebuffer(e.DRAW_FRAMEBUFFER,null),d)for(let t=0;t<i.length;t++){n.bindFramebuffer(e.FRAMEBUFFER,u.__webglMultisampledFramebuffer),e.framebufferRenderbuffer(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.RENDERBUFFER,u.__webglColorRenderbuffer[t]);let a=r.get(i[t]).__webglTexture;n.bindFramebuffer(e.FRAMEBUFFER,u.__webglFramebuffer),e.framebufferTexture2D(e.DRAW_FRAMEBUFFER,e.COLOR_ATTACHMENT0+t,e.TEXTURE_2D,a,0)}n.bindFramebuffer(e.DRAW_FRAMEBUFFER,u.__webglMultisampledFramebuffer)}else if(t.depthBuffer&&t.storeMultisampledDepthBuffer===!1&&c){let n=t.stencilBuffer?e.DEPTH_STENCIL_ATTACHMENT:e.DEPTH_ATTACHMENT;e.invalidateFramebuffer(e.DRAW_FRAMEBUFFER,[n])}}}function we(e){return Math.min(i.maxSamples,e.samples)}function Te(e){let n=r.get(e);return e.samples>0&&t.has(`WEBGL_multisampled_render_to_texture`)===!0&&n.__useRenderToTexture!==!1}function U(e){let t=o.render.frame;u.get(e)!==t&&(u.set(e,t),e.update())}function Ee(e,t){let n=e.colorSpace,r=e.format,i=e.type;return e.isCompressedTexture===!0||e.isVideoTexture===!0||n!==`srgb-linear`&&n!==``&&(Ct.getTransfer(n)===`srgb`?(r!==1023||i!==1009)&&K(`WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType.`):q(`WebGLTextures: Unsupported texture color space:`,n)),t}function De(e){return typeof HTMLImageElement<`u`&&e instanceof HTMLImageElement?(l.width=e.naturalWidth||e.width,l.height=e.naturalHeight||e.height):typeof VideoFrame<`u`&&e instanceof VideoFrame?(l.width=e.displayWidth,l.height=e.displayHeight):(l.width=e.width,l.height=e.height),l}this.allocateTextureUnit=R,this.resetTextureUnits=ee,this.getTextureUnits=ne,this.setTextureUnits=re,this.setTexture2D=z,this.setTexture2DArray=B,this.setTexture3D=ae,this.setTextureCube=oe,this.rebindTextures=ve,this.setupRenderTarget=ye,this.updateRenderTargetMipmap=be,this.updateMultisampleRenderTarget=Ce,this.setupDepthRenderbuffer=_e,this.setupFrameBufferTexture=me,this.useMultisampledRTT=Te,this.isReversedDepthBuffer=function(){return n.buffers.depth.getReversed()}}function cl(e,t){function n(n,r=``){let i,a=Ct.getTransfer(r);if(n===1009)return e.UNSIGNED_BYTE;if(n===1017)return e.UNSIGNED_SHORT_4_4_4_4;if(n===1018)return e.UNSIGNED_SHORT_5_5_5_1;if(n===35902)return e.UNSIGNED_INT_5_9_9_9_REV;if(n===35899)return e.UNSIGNED_INT_10F_11F_11F_REV;if(n===1010)return e.BYTE;if(n===1011)return e.SHORT;if(n===1012)return e.UNSIGNED_SHORT;if(n===1013)return e.INT;if(n===1014)return e.UNSIGNED_INT;if(n===1015)return e.FLOAT;if(n===1016)return e.HALF_FLOAT;if(n===1021)return e.ALPHA;if(n===1022)return e.RGB;if(n===1023)return e.RGBA;if(n===1026)return e.DEPTH_COMPONENT;if(n===1027)return e.DEPTH_STENCIL;if(n===1028)return e.RED;if(n===1029)return e.RED_INTEGER;if(n===1030)return e.RG;if(n===1031)return e.RG_INTEGER;if(n===1033)return e.RGBA_INTEGER;if(n===33776||n===33777||n===33778||n===33779){if(a===`srgb`){if(i=t.get(`WEBGL_compressed_texture_s3tc_srgb`),i!==null){if(n===33776)return i.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===33777)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===33778)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===33779)return i.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null}else if(i=t.get(`WEBGL_compressed_texture_s3tc`),i!==null){if(n===33776)return i.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===33777)return i.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===33778)return i.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===33779)return i.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null}if(n===35840||n===35841||n===35842||n===35843){if(i=t.get(`WEBGL_compressed_texture_pvrtc`),i!==null){if(n===35840)return i.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===35841)return i.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===35842)return i.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===35843)return i.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null}if(n===36196||n===37492||n===37496||n===37488||n===37489||n===37490||n===37491){if(i=t.get(`WEBGL_compressed_texture_etc`),i!==null){if(n===36196||n===37492)return a===`srgb`?i.COMPRESSED_SRGB8_ETC2:i.COMPRESSED_RGB8_ETC2;if(n===37496)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:i.COMPRESSED_RGBA8_ETC2_EAC;if(n===37488)return i.COMPRESSED_R11_EAC;if(n===37489)return i.COMPRESSED_SIGNED_R11_EAC;if(n===37490)return i.COMPRESSED_RG11_EAC;if(n===37491)return i.COMPRESSED_SIGNED_RG11_EAC}else return null}if(n===37808||n===37809||n===37810||n===37811||n===37812||n===37813||n===37814||n===37815||n===37816||n===37817||n===37818||n===37819||n===37820||n===37821){if(i=t.get(`WEBGL_compressed_texture_astc`),i!==null){if(n===37808)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:i.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===37809)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:i.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===37810)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:i.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===37811)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:i.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===37812)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:i.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===37813)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:i.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===37814)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:i.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===37815)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:i.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===37816)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:i.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===37817)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:i.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===37818)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:i.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===37819)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:i.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===37820)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:i.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===37821)return a===`srgb`?i.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:i.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null}if(n===36492||n===36494||n===36495){if(i=t.get(`EXT_texture_compression_bptc`),i!==null){if(n===36492)return a===`srgb`?i.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:i.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===36494)return i.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===36495)return i.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null}if(n===36283||n===36284||n===36285||n===36286){if(i=t.get(`EXT_texture_compression_rgtc`),i!==null){if(n===36283)return i.COMPRESSED_RED_RGTC1_EXT;if(n===36284)return i.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===36285)return i.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===36286)return i.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null}return n===1020?e.UNSIGNED_INT_24_8:e[n]===void 0?null:e[n]}return{convert:n}}var ll=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,ul=`
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

}`,dl=class{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){let n=new Mi(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=n}}getMesh(e){if(this.texture!==null&&this.mesh===null){let t=e.cameras[0].viewport,n=new qi({vertexShader:ll,fragmentShader:ul,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new ai(new Ii(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}},fl=class extends st{constructor(e,t){super();let n=this,r=null,i=1,a=null,o=`local-floor`,s=1,c=null,l=null,u=null,d=null,f=null,p=null,m=typeof XRWebGLBinding<`u`,h=new dl,g={},_=t.getContextAttributes(),v=null,y=null,b=[],x=[],C=new Y,w=null,T=null,E=new ja;E.viewport=new Pt;let O=new ja;O.viewport=new Pt;let k=[E,O],A=new Va,j=null,N=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(e){let t=b[e];return t===void 0&&(t=new gn,b[e]=t),t.getTargetRaySpace()},this.getControllerGrip=function(e){let t=b[e];return t===void 0&&(t=new gn,b[e]=t),t.getGripSpace()},this.getHand=function(e){let t=b[e];return t===void 0&&(t=new gn,b[e]=t),t.getHandSpace()};function P(e){let t=x.indexOf(e.inputSource);if(t===-1)return;let n=b[t];n!==void 0&&(n.update(e.inputSource,e.frame,c||a),n.dispatchEvent({type:e.type,data:e.inputSource}))}function F(){r.removeEventListener(`select`,P),r.removeEventListener(`selectstart`,P),r.removeEventListener(`selectend`,P),r.removeEventListener(`squeeze`,P),r.removeEventListener(`squeezestart`,P),r.removeEventListener(`squeezeend`,P),r.removeEventListener(`end`,F),r.removeEventListener(`inputsourceschange`,I);for(let e=0;e<b.length;e++){let t=x[e];t!==null&&(x[e]=null,b[e].disconnect(t))}j=null,N=null,h.reset();for(let e in g)delete g[e];if(e.setRenderTarget(v),f=null,d=null,u=null,r=null,y=null,oe.stop(),n.isPresenting=!1,e.setPixelRatio(w),e.setSize(C.width,C.height,!1),T!==null){let e=T.camera;e.fov=T.fov,e.zoom=T.zoom,e.updateProjectionMatrix(),T=null}n.dispatchEvent({type:`sessionend`})}this.setFramebufferScaleFactor=function(e){i=e,n.isPresenting===!0&&K(`WebXRManager: Cannot change framebuffer scale while presenting.`)},this.setReferenceSpaceType=function(e){o=e,n.isPresenting===!0&&K(`WebXRManager: Cannot change reference space type while presenting.`)},this.getReferenceSpace=function(){return c||a},this.setReferenceSpace=function(e){c=e},this.getBaseLayer=function(){return d===null?f:d},this.getBinding=function(){return u===null&&m&&(u=new XRWebGLBinding(r,t)),u},this.getFrame=function(){return p},this.getSession=function(){return r},this.setSession=async function(l){if(r=l,r!==null){if(v=e.getRenderTarget(),r.addEventListener(`select`,P),r.addEventListener(`selectstart`,P),r.addEventListener(`selectend`,P),r.addEventListener(`squeeze`,P),r.addEventListener(`squeezestart`,P),r.addEventListener(`squeezeend`,P),r.addEventListener(`end`,F),r.addEventListener(`inputsourceschange`,I),_.xrCompatible!==!0&&await t.makeXRCompatible(),w=e.getPixelRatio(),e.getSize(C),m&&`createProjectionLayer`in XRWebGLBinding.prototype){let n=null,a=null,o=null;_.depth&&(o=_.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,n=_.stencil?te:ee,a=_.stencil?M:D);let s={colorFormat:t.RGBA8,depthFormat:o,scaleFactor:i};u=this.getBinding(),d=u.createProjectionLayer(s),r.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),y=new It(d.textureWidth,d.textureHeight,{format:L,type:S,depthTexture:new Ai(d.textureWidth,d.textureHeight,a,void 0,void 0,void 0,void 0,void 0,void 0,n),stencilBuffer:_.stencil,colorSpace:e.outputColorSpace,samples:_.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1,storeMultisampledDepthBuffer:d.ignoreDepthValues===!1,storeMultisampledStencilBuffer:d.ignoreDepthValues===!1})}else{let n={antialias:_.antialias,alpha:!0,depth:_.depth,stencil:_.stencil,framebufferScaleFactor:i};f=new XRWebGLLayer(r,t,n),r.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),y=new It(f.framebufferWidth,f.framebufferHeight,{format:L,type:S,colorSpace:e.outputColorSpace,stencilBuffer:_.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1,storeMultisampledDepthBuffer:f.ignoreDepthValues===!1,storeMultisampledStencilBuffer:f.ignoreDepthValues===!1})}y.isXRRenderTarget=!0,this.setFoveation(s),c=null,a=await r.requestReferenceSpace(o),oe.setContext(r),oe.start(),n.isPresenting=!0,n.dispatchEvent({type:`sessionstart`})}},this.getEnvironmentBlendMode=function(){if(r!==null)return r.environmentBlendMode},this.getDepthTexture=function(){return h.getDepthTexture()};function I(e){for(let t=0;t<e.removed.length;t++){let n=e.removed[t],r=x.indexOf(n);r>=0&&(x[r]=null,b[r].disconnect(n))}for(let t=0;t<e.added.length;t++){let n=e.added[t],r=x.indexOf(n);if(r===-1){for(let e=0;e<b.length;e++)if(e>=x.length){x.push(n),r=e;break}else if(x[e]===null){x[e]=n,r=e;break}if(r===-1)break}let i=b[r];i&&i.connect(n)}}let ne=new X,re=new X;function R(e,t,n){ne.setFromMatrixPosition(t.matrixWorld),re.setFromMatrixPosition(n.matrixWorld);let r=ne.distanceTo(re),i=t.projectionMatrix.elements,a=n.projectionMatrix.elements,o=i[14]/(i[10]-1),s=i[14]/(i[10]+1),c=(i[9]+1)/i[5],l=(i[9]-1)/i[5],u=(i[8]-1)/i[0],d=(a[8]+1)/a[0],f=o*u,p=o*d,m=r/(-u+d),h=m*-u;if(t.matrixWorld.decompose(e.position,e.quaternion,e.scale),e.translateX(h),e.translateZ(m),e.matrixWorld.compose(e.position,e.quaternion,e.scale),e.matrixWorldInverse.copy(e.matrixWorld).invert(),i[10]===-1)e.projectionMatrix.copy(t.projectionMatrix),e.projectionMatrixInverse.copy(t.projectionMatrixInverse);else{let t=o+m,n=s+m,i=f-h,a=p+(r-h),u=c*s/n*t,d=l*s/n*t;e.projectionMatrix.makePerspective(i,a,u,d,t,n),e.projectionMatrixInverse.copy(e.projectionMatrix).invert()}}function ie(e,t){t===null?e.matrixWorld.copy(e.matrix):e.matrixWorld.multiplyMatrices(t.matrixWorld,e.matrix),e.matrixWorldInverse.copy(e.matrixWorld).invert()}this.updateCamera=function(e){if(r===null)return;let t=e.near,n=e.far;h.texture!==null&&(h.depthNear>0&&(t=h.depthNear),h.depthFar>0&&(n=h.depthFar)),A.near=O.near=E.near=t,A.far=O.far=E.far=n,(j!==A.near||N!==A.far)&&(r.updateRenderState({depthNear:A.near,depthFar:A.far}),j=A.near,N=A.far),A.layers.mask=e.layers.mask|6,E.layers.mask=A.layers.mask&-5,O.layers.mask=A.layers.mask&-3;let i=e.parent,a=A.cameras;ie(A,i);for(let e=0;e<a.length;e++)ie(a[e],i);a.length===2?R(A,E,O):A.projectionMatrix.copy(E.projectionMatrix),T===null&&e.isPerspectiveCamera&&(T={camera:e,fov:e.fov,zoom:e.zoom}),z(e,A,i)};function z(e,t,n){n===null?e.matrix.copy(t.matrixWorld):(e.matrix.copy(n.matrixWorld),e.matrix.invert(),e.matrix.multiply(t.matrixWorld)),e.matrix.decompose(e.position,e.quaternion,e.scale),e.updateMatrixWorld(!0),e.projectionMatrix.copy(t.projectionMatrix),e.projectionMatrixInverse.copy(t.projectionMatrixInverse),e.isPerspectiveCamera&&(e.fov=ut*2*Math.atan(1/e.projectionMatrix.elements[5]),e.zoom=1)}this.getCamera=function(){return A},this.getFoveation=function(){if(d!==null||f!==null)return s},this.setFoveation=function(e){s=e,d!==null&&(d.fixedFoveation=e),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=e)},this.hasDepthSensing=function(){return h.texture!==null},this.getDepthSensingMesh=function(){return h.getMesh(A)},this.getCameraTexture=function(e){return g[e]};let B=null;function ae(t,i){if(l=i.getViewerPose(c||a),p=i,l!==null){let t=l.views;f!==null&&(e.setRenderTargetFramebuffer(y,f.framebuffer),e.setRenderTarget(y));let i=!1;t.length!==A.cameras.length&&(A.cameras.length=0,i=!0);for(let n=0;n<t.length;n++){let r=t[n],a=null;if(f!==null)a=f.getViewport(r);else{let t=u.getViewSubImage(d,r);a=t.viewport,n===0&&(e.setRenderTargetTextures(y,t.colorTexture,t.depthStencilTexture),e.setRenderTarget(y))}let o=k[n];o===void 0&&(o=new ja,o.layers.enable(n),o.viewport=new Pt,k[n]=o),o.matrix.fromArray(r.transform.matrix),o.matrix.decompose(o.position,o.quaternion,o.scale),o.projectionMatrix.fromArray(r.projectionMatrix),o.projectionMatrixInverse.copy(o.projectionMatrix).invert(),o.viewport.set(a.x,a.y,a.width,a.height),n===0&&(A.matrix.copy(o.matrix),A.matrix.decompose(A.position,A.quaternion,A.scale)),i===!0&&A.cameras.push(o)}let a=r.enabledFeatures;if(a&&a.includes(`depth-sensing`)&&r.depthUsage==`gpu-optimized`&&m){u=n.getBinding();let e=u.getDepthInformation(t[0]);e&&e.isValid&&e.texture&&h.init(e,r.renderState)}if(a&&a.includes(`camera-access`)&&m){e.state.unbindTexture(),u=n.getBinding();for(let e=0;e<t.length;e++){let n=t[e].camera;if(n){let e=g[n];e||(e=new Mi,g[n]=e);let t=u.getCameraImage(n);e.sourceTexture=t}}}}for(let e=0;e<b.length;e++){let t=x[e],n=b[e];t!==null&&n!==void 0&&n.update(t,i,c||a)}B&&B(t,i),i.detectedPlanes&&n.dispatchEvent({type:`planesdetected`,data:i}),p=null}let oe=new no;oe.setAnimationLoop(ae),this.setAnimationLoop=function(e){B=e},this.dispose=function(){}}},pl=new zt,ml=new Z;ml.set(-1,0,0,0,1,0,0,0,1);function hl(e,t){function n(e,t){e.matrixAutoUpdate===!0&&e.updateMatrix(),t.value.copy(e.matrix)}function r(t,n){n.color.getRGB(t.fogColor.value,Ui(e)),n.isFog?(t.fogNear.value=n.near,t.fogFar.value=n.far):n.isFogExp2&&(t.fogDensity.value=n.density)}function i(e,t,n,r,i){t.isNodeMaterial?t.uniformsNeedUpdate=!1:t.isMeshBasicMaterial?a(e,t):t.isMeshLambertMaterial?(a(e,t),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)):t.isMeshToonMaterial?(a(e,t),d(e,t)):t.isMeshPhongMaterial?(a(e,t),u(e,t),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)):t.isMeshStandardMaterial?(a(e,t),f(e,t),t.isMeshPhysicalMaterial&&p(e,t,i)):t.isMeshMatcapMaterial?(a(e,t),m(e,t)):t.isMeshDepthMaterial?a(e,t):t.isMeshDistanceMaterial?(a(e,t),h(e,t)):t.isMeshNormalMaterial?a(e,t):t.isLineBasicMaterial?(o(e,t),t.isLineDashedMaterial&&s(e,t)):t.isPointsMaterial?c(e,t,n,r):t.isSpriteMaterial?l(e,t):t.isShadowMaterial?(e.color.value.copy(t.color),e.opacity.value=t.opacity):t.isShaderMaterial&&(t.uniformsNeedUpdate=!1)}function a(e,r){e.opacity.value=r.opacity,r.color&&e.diffuse.value.copy(r.color),r.emissive&&e.emissive.value.copy(r.emissive).multiplyScalar(r.emissiveIntensity),r.map&&(e.map.value=r.map,n(r.map,e.mapTransform)),r.alphaMap&&(e.alphaMap.value=r.alphaMap,n(r.alphaMap,e.alphaMapTransform)),r.bumpMap&&(e.bumpMap.value=r.bumpMap,n(r.bumpMap,e.bumpMapTransform),e.bumpScale.value=r.bumpScale,r.side===1&&(e.bumpScale.value*=-1)),r.normalMap&&(e.normalMap.value=r.normalMap,n(r.normalMap,e.normalMapTransform),e.normalScale.value.copy(r.normalScale),r.side===1&&e.normalScale.value.negate()),r.displacementMap&&(e.displacementMap.value=r.displacementMap,n(r.displacementMap,e.displacementMapTransform),e.displacementScale.value=r.displacementScale,e.displacementBias.value=r.displacementBias),r.emissiveMap&&(e.emissiveMap.value=r.emissiveMap,n(r.emissiveMap,e.emissiveMapTransform)),r.specularMap&&(e.specularMap.value=r.specularMap,n(r.specularMap,e.specularMapTransform)),r.alphaTest>0&&(e.alphaTest.value=r.alphaTest);let i=t.get(r),a=i.envMap,o=i.envMapRotation;a&&(e.envMap.value=a,e.envMapRotation.value.setFromMatrix4(pl.makeRotationFromEuler(o)).transpose(),a.isCubeTexture&&a.isRenderTargetTexture===!1&&e.envMapRotation.value.premultiply(ml),e.reflectivity.value=r.reflectivity,e.ior.value=r.ior,e.refractionRatio.value=r.refractionRatio),r.lightMap&&(e.lightMap.value=r.lightMap,e.lightMapIntensity.value=r.lightMapIntensity,n(r.lightMap,e.lightMapTransform)),r.aoMap&&(e.aoMap.value=r.aoMap,e.aoMapIntensity.value=r.aoMapIntensity,n(r.aoMap,e.aoMapTransform))}function o(e,t){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,t.map&&(e.map.value=t.map,n(t.map,e.mapTransform))}function s(e,t){e.dashSize.value=t.dashSize,e.totalSize.value=t.dashSize+t.gapSize,e.scale.value=t.scale}function c(e,t,r,i){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,e.size.value=t.size*r,e.scale.value=i*.5,t.map&&(e.map.value=t.map,n(t.map,e.uvTransform)),t.alphaMap&&(e.alphaMap.value=t.alphaMap,n(t.alphaMap,e.alphaMapTransform)),t.alphaTest>0&&(e.alphaTest.value=t.alphaTest)}function l(e,t){e.diffuse.value.copy(t.color),e.opacity.value=t.opacity,e.rotation.value=t.rotation,t.map&&(e.map.value=t.map,n(t.map,e.mapTransform)),t.alphaMap&&(e.alphaMap.value=t.alphaMap,n(t.alphaMap,e.alphaMapTransform)),t.alphaTest>0&&(e.alphaTest.value=t.alphaTest)}function u(e,t){e.specular.value.copy(t.specular),e.shininess.value=Math.max(t.shininess,1e-4)}function d(e,t){t.gradientMap&&(e.gradientMap.value=t.gradientMap)}function f(e,t){e.metalness.value=t.metalness,t.metalnessMap&&(e.metalnessMap.value=t.metalnessMap,n(t.metalnessMap,e.metalnessMapTransform)),e.roughness.value=t.roughness,t.roughnessMap&&(e.roughnessMap.value=t.roughnessMap,n(t.roughnessMap,e.roughnessMapTransform)),t.envMap&&(e.envMapIntensity.value=t.envMapIntensity)}function p(e,t,r){e.ior.value=t.ior,t.sheen>0&&(e.sheenColor.value.copy(t.sheenColor).multiplyScalar(t.sheen),e.sheenRoughness.value=t.sheenRoughness,t.sheenColorMap&&(e.sheenColorMap.value=t.sheenColorMap,n(t.sheenColorMap,e.sheenColorMapTransform)),t.sheenRoughnessMap&&(e.sheenRoughnessMap.value=t.sheenRoughnessMap,n(t.sheenRoughnessMap,e.sheenRoughnessMapTransform))),t.clearcoat>0&&(e.clearcoat.value=t.clearcoat,e.clearcoatRoughness.value=t.clearcoatRoughness,t.clearcoatMap&&(e.clearcoatMap.value=t.clearcoatMap,n(t.clearcoatMap,e.clearcoatMapTransform)),t.clearcoatRoughnessMap&&(e.clearcoatRoughnessMap.value=t.clearcoatRoughnessMap,n(t.clearcoatRoughnessMap,e.clearcoatRoughnessMapTransform)),t.clearcoatNormalMap&&(e.clearcoatNormalMap.value=t.clearcoatNormalMap,n(t.clearcoatNormalMap,e.clearcoatNormalMapTransform),e.clearcoatNormalScale.value.copy(t.clearcoatNormalScale),t.side===1&&e.clearcoatNormalScale.value.negate())),t.dispersion>0&&(e.dispersion.value=t.dispersion),t.retroreflectivity>0&&(e.retroreflectivity.value=t.retroreflectivity),t.iridescence>0&&(e.iridescence.value=t.iridescence,e.iridescenceIOR.value=t.iridescenceIOR,e.iridescenceThicknessMinimum.value=t.iridescenceThicknessRange[0],e.iridescenceThicknessMaximum.value=t.iridescenceThicknessRange[1],t.iridescenceMap&&(e.iridescenceMap.value=t.iridescenceMap,n(t.iridescenceMap,e.iridescenceMapTransform)),t.iridescenceThicknessMap&&(e.iridescenceThicknessMap.value=t.iridescenceThicknessMap,n(t.iridescenceThicknessMap,e.iridescenceThicknessMapTransform))),t.transmission>0&&(e.transmission.value=t.transmission,e.transmissionSamplerMap.value=r.texture,e.transmissionSamplerSize.value.set(r.width,r.height),t.transmissionMap&&(e.transmissionMap.value=t.transmissionMap,n(t.transmissionMap,e.transmissionMapTransform)),e.thickness.value=t.thickness,t.thicknessMap&&(e.thicknessMap.value=t.thicknessMap,n(t.thicknessMap,e.thicknessMapTransform)),e.attenuationDistance.value=t.attenuationDistance,e.attenuationColor.value.copy(t.attenuationColor)),t.anisotropy>0&&(e.anisotropyVector.value.set(t.anisotropy*Math.cos(t.anisotropyRotation),t.anisotropy*Math.sin(t.anisotropyRotation)),t.anisotropyMap&&(e.anisotropyMap.value=t.anisotropyMap,n(t.anisotropyMap,e.anisotropyMapTransform))),e.specularIntensity.value=t.specularIntensity,e.specularColor.value.copy(t.specularColor),t.specularColorMap&&(e.specularColorMap.value=t.specularColorMap,n(t.specularColorMap,e.specularColorMapTransform)),t.specularIntensityMap&&(e.specularIntensityMap.value=t.specularIntensityMap,n(t.specularIntensityMap,e.specularIntensityMapTransform))}function m(e,t){t.matcap&&(e.matcap.value=t.matcap)}function h(e,n){let r=t.get(n).light;e.referencePosition.value.setFromMatrixPosition(r.matrixWorld),e.nearDistance.value=r.shadow.camera.near,e.farDistance.value=r.shadow.camera.far}return{refreshFogUniforms:r,refreshMaterialUniforms:i}}function gl(e,t,n,r){let i={},a={},o=[],s=e.getParameter(e.MAX_UNIFORM_BUFFER_BINDINGS);function c(e,t){let n=t.program;r.uniformBlockBinding(e,n)}function l(e,n){let o=i[e.id];o===void 0&&(g(e),o=u(e),i[e.id]=o,e.addEventListener(`dispose`,v));let s=n.program;r.updateUBOMapping(e,s);let c=t.render.frame;a[e.id]!==c&&(f(e),a[e.id]=c)}function u(t){let n=d();t.__bindingPointIndex=n;let r=e.createBuffer(),i=t.__size,a=t.usage;return e.bindBuffer(e.UNIFORM_BUFFER,r),e.bufferData(e.UNIFORM_BUFFER,i,a),e.bindBuffer(e.UNIFORM_BUFFER,null),e.bindBufferBase(e.UNIFORM_BUFFER,n,r),r}function d(){for(let e=0;e<s;e++)if(o.indexOf(e)===-1)return o.push(e),e;return q(`WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached.`),0}function f(t){let n=i[t.id],r=t.uniforms,a=t.__cache;e.bindBuffer(e.UNIFORM_BUFFER,n);for(let e=0,t=r.length;e<t;e++){let t=r[e];if(Array.isArray(t))for(let n=0,r=t.length;n<r;n++)p(t[n],e,n,a);else p(t,e,0,a)}e.bindBuffer(e.UNIFORM_BUFFER,null)}function p(t,n,r,i){if(h(t,n,r,i)===!0){let n=t.__offset,r=t.value;if(Array.isArray(r)){let e=0;for(let n=0;n<r.length;n++){let i=r[n],a=_(i);m(i,t.__data,e),typeof i!=`number`&&typeof i!=`boolean`&&!i.isMatrix3&&!ArrayBuffer.isView(i)&&(e+=a.storage/Float32Array.BYTES_PER_ELEMENT)}}else m(r,t.__data,0);e.bufferSubData(e.UNIFORM_BUFFER,n,t.__data)}}function m(e,t,n){typeof e==`number`||typeof e==`boolean`?t[0]=e:e.isMatrix3?(t[0]=e.elements[0],t[1]=e.elements[1],t[2]=e.elements[2],t[3]=0,t[4]=e.elements[3],t[5]=e.elements[4],t[6]=e.elements[5],t[7]=0,t[8]=e.elements[6],t[9]=e.elements[7],t[10]=e.elements[8],t[11]=0):ArrayBuffer.isView(e)?t.set(new e.constructor(e.buffer,e.byteOffset,t.length)):e.toArray(t,n)}function h(e,t,n,r){let i=e.value,a=t+`_`+n;if(r[a]===void 0)return r[a]=typeof i==`number`||typeof i==`boolean`?i:ArrayBuffer.isView(i)?i.slice():i.clone(),!0;{let e=r[a];if(typeof i==`number`||typeof i==`boolean`){if(e!==i)return r[a]=i,!0}else if(ArrayBuffer.isView(i))return!0;else if(e.equals(i)===!1)return e.copy(i),!0}return!1}function g(e){let t=e.uniforms,n=0;for(let e=0,r=t.length;e<r;e++){let r=Array.isArray(t[e])?t[e]:[t[e]];for(let e=0,t=r.length;e<t;e++){let t=r[e],i=Array.isArray(t.value)?t.value:[t.value];for(let e=0,r=i.length;e<r;e++){let r=i[e],a=_(r),o=n%16,s=o%a.boundary,c=o+s;n+=s,c!==0&&16-c<a.storage&&(n+=16-c),t.__data=new Float32Array(a.storage/Float32Array.BYTES_PER_ELEMENT),t.__offset=n,n+=a.storage}}}let r=n%16;return r>0&&(n+=16-r),e.__size=n,e.__cache={},this}function _(e){let t={boundary:0,storage:0};return typeof e==`number`||typeof e==`boolean`?(t.boundary=4,t.storage=4):e.isVector2?(t.boundary=8,t.storage=8):e.isVector3||e.isColor?(t.boundary=16,t.storage=12):e.isVector4?(t.boundary=16,t.storage=16):e.isMatrix3?(t.boundary=48,t.storage=48):e.isMatrix4?(t.boundary=64,t.storage=64):e.isTexture?K(`WebGLRenderer: Texture samplers can not be part of an uniforms group.`):ArrayBuffer.isView(e)?(t.boundary=16,t.storage=e.byteLength):K(`WebGLRenderer: Unsupported uniform value type.`,e),t}function v(t){let n=t.target;n.removeEventListener(`dispose`,v);let r=o.indexOf(n.__bindingPointIndex);o.splice(r,1),e.deleteBuffer(i[n.id]),delete i[n.id],delete a[n.id]}function y(){for(let t in i)e.deleteBuffer(i[t]);o=[],i={},a={}}return{bind:c,update:l,dispose:y}}var _l=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),vl=null;function yl(){return vl===null&&(vl=new ci(_l,16,16,R,k),vl.name=`DFG_LUT`,vl.minFilter=y,vl.magFilter=y,vl.wrapS=m,vl.wrapT=m,vl.generateMipmaps=!1,vl.needsUpdate=!0),vl}var bl=class{constructor(e={}){let{canvas:t=et(),context:n=null,depth:r=!0,stencil:i=!1,alpha:a=!1,antialias:o=!1,premultipliedAlpha:s=!0,preserveDrawingBuffer:c=!1,powerPreference:l=`default`,failIfMajorPerformanceCaveat:u=!1,reversedDepthBuffer:d=!1,outputBufferType:f=S}=e;this.isWebGLRenderer=!0;let p;if(n!==null){if(typeof WebGLRenderingContext<`u`&&n instanceof WebGLRenderingContext)throw Error(`THREE.WebGLRenderer: WebGL 1 is not supported since r163.`);p=n.getContextAttributes().alpha}else p=a;let m=f,h=new Set([z,ie,re]),g=new Set([S,D,T,M,A,j]),_=new Uint32Array(4),v=new Int32Array(4),y=new X,b=null,C=null,w=[],E=[],O=null;this.domElement=t,this.debug={checkShaderErrors:!0,diagnostics:{keywords:!1},onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=0,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let N=this,P=!1,F=null,I=null,L=null,ee=null;this._outputColorSpace=Ue;let te=0,ne=0,R=null,B=-1,ae=null,oe=new Pt,V=new Pt,se=null,ce=new Q(0),le=0,ue=t.width,de=t.height,H=1,fe=null,pe=null,me=new Pt(0,0,ue,de),he=new Pt(0,0,ue,de),ge=!1,_e=new pi,ve=!1,ye=!1,be=new zt,xe=new X,Se=new Pt,Ce={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},we=!1;function Te(){return R===null?H:1}let U=n;function Ee(e,n){return t.getContext(e,n)}let De,Oe,W,ke,G,Ae,je,Me,Ne,Pe,Fe,Ie,Le,Re,ze,Be,Ve,He,We,Ge,Ke,qe,Je;try{let e={alpha:!0,depth:r,stencil:i,antialias:o,premultipliedAlpha:s,preserveDrawingBuffer:c,powerPreference:l,failIfMajorPerformanceCaveat:u};if(`setAttribute`in t&&t.setAttribute(`data-engine`,`three.js r186`),t.addEventListener(`webglcontextlost`,Qe,!1),t.addEventListener(`webglcontextrestored`,$e,!1),t.addEventListener(`webglcontextcreationerror`,tt,!1),U===null){let t=`webgl2`;if(U=Ee(t,e),U===null)throw Ee(t)?Error(`THREE.WebGLRenderer: Error creating WebGL context with your selected attributes.`):Error(`THREE.WebGLRenderer: Error creating WebGL context.`)}Ye()}catch(e){throw t.removeEventListener(`webglcontextlost`,Qe,!1),t.removeEventListener(`webglcontextrestored`,$e,!1),t.removeEventListener(`webglcontextcreationerror`,tt,!1),q(`WebGLRenderer: `+e.message),e}function Ye(){De=new Ro(U),De.init(),Ke=new cl(U,De),Oe=new po(U,De,e,Ke),W=new ol(U,De),Oe.reversedDepthBuffer&&d&&W.buffers.depth.setReversed(!0),I=U.createFramebuffer(),L=U.createFramebuffer(),ee=U.createFramebuffer(),ke=new Vo(U),G=new Bc,Ae=new sl(U,De,W,G,Oe,Ke,ke),je=new Lo(N),Me=new ro(U),qe=new uo(U,Me),Ne=new zo(U,Me,ke,qe),Pe=new Uo(U,Ne,Me,qe,ke),He=new Ho(U,Oe,Ae),ze=new mo(G),Fe=new zc(N,je,De,Oe,qe,ze),Ie=new hl(N,G),Le=new Wc,Re=new Zc(De),Ve=new lo(N,je,W,Pe,p,s),Be=new al(N,Pe,Oe),Je=new gl(U,ke,Oe,W),We=new fo(U,De,ke),Ge=new Bo(U,De,ke),ke.programs=Fe.programs,N.capabilities=Oe,N.extensions=De,N.properties=G,N.renderLists=Le,N.shadowMap=Be,N.state=W,N.info=ke}m!==1009&&(O=new Go(m,t.width,t.height,o,r,i));let Ze=new fl(N,U);this.xr=Ze,this.getContext=function(){return U},this.getContextAttributes=function(){return U.getContextAttributes()},this.forceContextLoss=function(){let e=De.get(`WEBGL_lose_context`);e&&e.loseContext()},this.forceContextRestore=function(){let e=De.get(`WEBGL_lose_context`);e&&e.restoreContext()},this.getPixelRatio=function(){return H},this.setPixelRatio=function(e){e!==void 0&&(H=e,this.setSize(ue,de,!1))},this.getSize=function(e){return e.set(ue,de)},this.setSize=function(e,n,r=!0){if(Ze.isPresenting){K(`WebGLRenderer: Can't change size while VR device is presenting.`);return}ue=e,de=n,t.width=Math.floor(e*H),t.height=Math.floor(n*H),r===!0&&(t.style.width=e+`px`,t.style.height=n+`px`),O!==null&&O.setSize(t.width,t.height),this.setViewport(0,0,e,n)},this.getDrawingBufferSize=function(e){return e.set(ue*H,de*H).floor()},this.setDrawingBufferSize=function(e,n,r){ue=e,de=n,H=r,t.width=Math.floor(e*r),t.height=Math.floor(n*r),this.setViewport(0,0,e,n)},this.setEffects=function(e){if(m===1009){q(`WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.`);return}if(e){for(let t=0;t<e.length;t++)if(e[t].isOutputPass===!0){K(`WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.`);break}}O.setEffects(e||[])},this.getCurrentViewport=function(e){return e.copy(oe)},this.getViewport=function(e){return e.copy(me)},this.setViewport=function(e,t,n,r){e.isVector4?me.set(e.x,e.y,e.z,e.w):me.set(e,t,n,r),W.viewport(oe.copy(me).multiplyScalar(H).round())},this.getScissor=function(e){return e.copy(he)},this.setScissor=function(e,t,n,r){e.isVector4?he.set(e.x,e.y,e.z,e.w):he.set(e,t,n,r),W.scissor(V.copy(he).multiplyScalar(H).round())},this.getScissorTest=function(){return ge},this.setScissorTest=function(e){W.setScissorTest(ge=e)},this.setOpaqueSort=function(e){fe=e},this.setTransparentSort=function(e){pe=e},this.getClearColor=function(e){return e.copy(Ve.getClearColor())},this.setClearColor=function(){Ve.setClearColor(...arguments)},this.getClearAlpha=function(){return Ve.getClearAlpha()},this.setClearAlpha=function(){Ve.setClearAlpha(...arguments)},this.clear=function(e=!0,t=!0,n=!0){let r=0;if(e){let e=!1;if(R!==null){let t=R.texture.format;e=h.has(t)}if(e){let e=R.texture.type,t=g.has(e),n=Ve.getClearColor(),r=Ve.getClearAlpha(),i=n.r,a=n.g,o=n.b;t?(_[0]=i,_[1]=a,_[2]=o,_[3]=r,U.clearBufferuiv(U.COLOR,0,_)):(v[0]=i,v[1]=a,v[2]=o,v[3]=r,U.clearBufferiv(U.COLOR,0,v))}else r|=U.COLOR_BUFFER_BIT}t&&(r|=U.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0)),n&&(r|=U.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),r!==0&&U.clear(r)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(e){e.setRenderer(this),F=e},this.dispose=function(){t.removeEventListener(`webglcontextlost`,Qe,!1),t.removeEventListener(`webglcontextrestored`,$e,!1),t.removeEventListener(`webglcontextcreationerror`,tt,!1),Ve.dispose(),Le.dispose(),Re.dispose(),G.dispose(),je.dispose(),Pe.dispose(),qe.dispose(),Je.dispose(),Fe.dispose(),Ze.dispose(),Ze.removeEventListener(`sessionstart`,ut),Ze.removeEventListener(`sessionend`,dt),J.stop()};function Qe(e){e.preventDefault(),nt(`WebGLRenderer: Context Lost.`),P=!0}function $e(){nt(`WebGLRenderer: Context Restored.`),P=!1;let e=ke.autoReset,t=Be.enabled,n=Be.autoUpdate,r=Be.needsUpdate,i=Be.type;Ye(),ke.autoReset=e,Be.enabled=t,Be.autoUpdate=n,Be.needsUpdate=r,Be.type=i}function tt(e){q(`WebGLRenderer: A WebGL context could not be created. Reason: `,e.statusMessage)}function rt(e){let t=e.target;t.removeEventListener(`dispose`,rt),it(t)}function it(e){ot(e),G.remove(e)}function ot(e){let t=G.get(e).programs;t!==void 0&&(t.forEach(function(e){Fe.releaseProgram(e)}),e.isShaderMaterial&&Fe.releaseShaderCache(e))}this.renderBufferDirect=function(e,t,n,r,i,a){t===null&&(t=Ce);let o=i.isMesh&&i.matrixWorld.determinantAffine()<0,s=yt(e,t,n,r,i);W.setMaterial(r,o);let c=n.index,l=1;if(r.wireframe===!0){if(c=Ne.getWireframeAttribute(n),c===void 0)return;l=2}let u=n.drawRange,d=n.attributes.position,f=u.start*l,p=(u.start+u.count)*l;a!==null&&(f=Math.max(f,a.start*l),p=Math.min(p,(a.start+a.count)*l)),c===null?d!=null&&(f=Math.max(f,0),p=Math.min(p,d.count)):(f=Math.max(f,0),p=Math.min(p,c.count));let m=p-f;if(m<0||m===1/0)return;qe.setup(i,r,s,n,c);let h,g=We;if(c!==null&&(h=Me.get(c),g=Ge,g.setIndex(h)),i.isMesh)r.wireframe===!0?(W.setLineWidth(r.wireframeLinewidth*Te()),g.setMode(U.LINES)):g.setMode(U.TRIANGLES);else if(i.isLine){let e=r.linewidth;e===void 0&&(e=1),W.setLineWidth(e*Te()),i.isLineSegments?g.setMode(U.LINES):i.isLineLoop?g.setMode(U.LINE_LOOP):g.setMode(U.LINE_STRIP)}else i.isPoints?g.setMode(U.POINTS):i.isSprite&&g.setMode(U.TRIANGLES);if(i.isBatchedMesh){if(De.get(`WEBGL_multi_draw`))g.renderMultiDraw(i._multiDrawStarts,i._multiDrawCounts,i._multiDrawCount);else{let e=i._multiDrawStarts,t=i._multiDrawCounts,n=i._multiDrawCount,a=c?Me.get(c).bytesPerElement:1,o=G.get(r).currentProgram.getUniforms();for(let r=0;r<n;r++)o.setValue(U,`_gl_DrawID`,r),g.render(e[r]/a,t[r])}}else if(i.isInstancedMesh)g.renderInstances(f,m,i.count);else if(n.isInstancedBufferGeometry){let e=n._maxInstanceCount===void 0?1/0:n._maxInstanceCount,t=Math.min(n.instanceCount,e);g.renderInstances(f,m,t)}else g.render(f,m)};function st(e,t,n,r){F!==null&&e.isNodeMaterial&&F.setObject(r,e),ve===!0&&ze.setState(e,n,!1),e.transparent===!0&&e.side===2&&e.forceSinglePass===!1?(e.side=1,e.needsUpdate=!0,gt(e,t,r),e.side=0,e.needsUpdate=!0,gt(e,t,r),e.side=2):gt(e,t,r)}this.compile=function(e,t,n=null){n===null&&(n=e),F!==null&&F.renderStart(e,t,n),C=Re.get(n),C.init(t),E.push(C),n.traverseVisible(function(e){e.isLight&&e.layers.test(t.layers)&&(C.pushLight(e),e.castShadow&&C.pushShadow(e))}),e!==n&&e.traverseVisible(function(e){e.isLight&&e.layers.test(t.layers)&&(C.pushLight(e),e.castShadow&&C.pushShadow(e))}),C.setupLights(),F!==null&&F.updateLights(C.state.lightsArray),ye=this.localClippingEnabled,ve=ze.init(this.clippingPlanes,ye),ve===!0&&ze.setGlobalState(this.clippingPlanes,t),F!==null&&Be.render(C.state.shadowsArray,n,t);let r=new Set;return e.traverse(function(e){if(!(e.isMesh||e.isPoints||e.isLine||e.isSprite))return;let i=e.material;if(i){if(Array.isArray(i))for(let a=0;a<i.length;a++){let o=i[a];st(o,n,t,e),r.add(o)}else st(i,n,t,e),r.add(i)}}),C=E.pop(),F!==null&&F.renderEnd(),r},this.compileAsync=function(e,t,n=null){let r=this.compile(e,t,n);return new Promise(t=>{function n(){if(r.forEach(function(e){let t=G.get(e).currentProgram;(t===void 0||t.isReady())&&r.delete(e)}),r.size===0){t(e);return}setTimeout(n,10)}De.get(`KHR_parallel_shader_compile`)===null?setTimeout(n,10):n()})};let ct=null;function lt(e){ct&&ct(e)}function ut(){J.stop()}function dt(){J.start()}let J=new no;J.setAnimationLoop(lt),typeof self<`u`&&J.setContext(self),this.setAnimationLoop=function(e){ct=e,Ze.setAnimationLoop(e),e===null?J.stop():J.start()},Ze.addEventListener(`sessionstart`,ut),Ze.addEventListener(`sessionend`,dt),this.render=function(e,t){if(t!==void 0&&t.isCamera!==!0){q(`WebGLRenderer.render: camera is not an instance of THREE.Camera.`);return}if(P===!0)return;F!==null&&F.renderStart(e,t);let n=Ze.enabled===!0&&Ze.isPresenting===!0,r=O!==null&&(R===null||n)&&O.begin(N,R);if(e.matrixWorldAutoUpdate===!0&&e.updateMatrixWorld(),t.parent===null&&t.matrixWorldAutoUpdate===!0&&t.updateMatrixWorld(),Ze.enabled===!0&&Ze.isPresenting===!0&&(O===null||O.isCompositing()===!1)&&(Ze.cameraAutoUpdate===!0&&Ze.updateCamera(t),t=Ze.getCamera()),e.isScene===!0&&e.onBeforeRender(N,e,t,R),C=Re.get(e,E.length),C.init(t),C.state.textureUnits=Ae.getTextureUnits(),E.push(C),be.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),_e.setFromProjectionMatrix(be,Xe,t.reversedDepth),ye=this.localClippingEnabled,ve=ze.init(this.clippingPlanes,ye),b=Le.get(e,w.length),b.init(),w.push(b),Ze.enabled===!0&&Ze.isPresenting===!0){let e=N.xr.getDepthSensingMesh();e!==null&&ft(e,t,-1/0,N.sortObjects)}ft(e,t,0,N.sortObjects),b.finish(),F!==null&&F.updateLights(C.state.lightsArray),N.sortObjects===!0&&b.sort(fe,pe),we=Ze.enabled===!1||Ze.isPresenting===!1||Ze.hasDepthSensing()===!1,we&&Ve.addToRenderList(b,e),this.info.render.frame++,this.info.autoReset===!0&&this.info.reset(),ve===!0&&ze.beginShadows();let i=C.state.shadowsArray;if(Be.render(i,e,t),ve===!0&&ze.endShadows(),(r&&O.hasRenderPass())===!1){let n=b.opaque,r=b.transmissive;if(C.setupLights(),t.isArrayCamera){let i=t.cameras;if(r.length>0)for(let t=0,a=i.length;t<a;t++){let a=i[t];mt(n,r,e,a)}we&&Ve.render(e);for(let t=0,n=i.length;t<n;t++){let n=i[t];pt(b,e,n,n.viewport)}}else r.length>0&&mt(n,r,e,t),we&&Ve.render(e),pt(b,e,t)}R!==null&&ne===0&&(Ae.updateMultisampleRenderTarget(R),Ae.updateRenderTargetMipmap(R)),r&&O.end(N),e.isScene===!0&&e.onAfterRender(N,e,t),qe.resetDefaultState(),B=-1,ae=null,E.pop(),E.length>0?(C=E[E.length-1],Ae.setTextureUnits(C.state.textureUnits),ve===!0&&ze.setGlobalState(N.clippingPlanes,C.state.camera)):C=null,w.pop(),b=w.length>0?w[w.length-1]:null,F!==null&&F.renderEnd()};function ft(e,t,n,r){if(e.visible===!1)return;if(e.layers.test(t.layers)){if(e.isGroup)n=e.renderOrder;else if(e.isLOD)e.autoUpdate===!0&&e.update(t);else if(e.isLightProbeGrid)C.pushLightProbeGrid(e);else if(e.isLight)C.pushLight(e),e.castShadow&&C.pushShadow(e);else if(e.isSprite){if(!e.frustumCulled||e.intersectsFrustum(_e)){r&&Se.setFromMatrixPosition(e.matrixWorld).applyMatrix4(be);let i=Pe.update(e),a=e.material;a.visible&&b.push(e,i,a,n,Se.z,null,t)}}else if((e.isMesh||e.isLine||e.isPoints)&&(!e.frustumCulled||e.intersectsFrustum(_e))){let i=Pe.update(e),a=e.material;if(r&&(e.boundingSphere===void 0?(i.boundingSphere===null&&i.computeBoundingSphere(),Se.copy(i.boundingSphere.center)):(e.boundingSphere===null&&e.computeBoundingSphere(),Se.copy(e.boundingSphere.center)),Se.applyMatrix4(e.matrixWorld).applyMatrix4(be)),Array.isArray(a)){let r=i.groups;for(let o=0,s=r.length;o<s;o++){let s=r[o],c=a[s.materialIndex];c&&c.visible&&b.push(e,i,c,n,Se.z,s,t)}}else a.visible&&b.push(e,i,a,n,Se.z,null,t)}}let i=e.children;for(let e=0,a=i.length;e<a;e++)ft(i[e],t,n,r)}function pt(e,t,n,r){let{opaque:i,transmissive:a,transparent:o}=e;C.setupLightsView(n),ve===!0&&ze.setGlobalState(N.clippingPlanes,n),r&&W.viewport(oe.copy(r)),i.length>0&&ht(i,t,n),a.length>0&&ht(a,t,n),o.length>0&&ht(o,t,n),W.buffers.depth.setTest(!0),W.buffers.depth.setMask(!0),W.buffers.color.setMask(!0),W.setPolygonOffset(!1)}function mt(e,t,n,r){if((n.isScene===!0?n.overrideMaterial:null)!==null)return;if(C.state.transmissionRenderTarget[r.id]===void 0){let e=De.has(`EXT_color_buffer_half_float`)||De.has(`EXT_color_buffer_float`);C.state.transmissionRenderTarget[r.id]=new It(1,1,{generateMipmaps:!0,type:e?k:S,minFilter:x,samples:Math.max(4,Oe.samples),stencilBuffer:i,resolveDepthBuffer:!1,resolveStencilBuffer:!1,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,colorSpace:Ct.workingColorSpace})}let a=C.state.transmissionRenderTarget[r.id],o=r.viewport||oe;a.setSize(o.z*N.transmissionResolutionScale,o.w*N.transmissionResolutionScale);let s=N.getRenderTarget(),c=N.getActiveCubeFace(),l=N.getActiveMipmapLevel();N.setRenderTarget(a),N.getClearColor(ce),le=N.getClearAlpha(),le<1&&N.setClearColor(16777215,.5),N.clear(),we&&Ve.render(n);let u=N.toneMapping;N.toneMapping=0;let d=r.viewport;if(r.viewport!==void 0&&(r.viewport=void 0),C.setupLightsView(r),ve===!0&&ze.setGlobalState(N.clippingPlanes,r),ht(e,n,r),Ae.updateMultisampleRenderTarget(a),Ae.updateRenderTargetMipmap(a),De.has(`WEBGL_multisampled_render_to_texture`)===!1){let e=!1;for(let i=0,a=t.length;i<a;i++){let{object:a,geometry:o,material:s,group:c}=t[i];if(s.side===2&&a.layers.test(r.layers)){let t=s.side;s.side=1,s.needsUpdate=!0,Y(a,n,r,o,s,c),s.side=t,s.needsUpdate=!0,e=!0}}e===!0&&(Ae.updateMultisampleRenderTarget(a),Ae.updateRenderTargetMipmap(a))}N.setRenderTarget(s,c,l),N.setClearColor(ce,le),d!==void 0&&(r.viewport=d),N.toneMapping=u}function ht(e,t,n){let r=t.isScene===!0?t.overrideMaterial:null;for(let i=0,a=e.length;i<a;i++){let a=e[i],{object:o,geometry:s,group:c}=a,l=a.material;l.allowOverride===!0&&r!==null&&(l=r),o.layers.test(n.layers)&&Y(o,t,n,s,l,c)}}function Y(e,t,n,r,i,a){F!==null&&i.isNodeMaterial&&F.setObject(e,i),e.onBeforeRender(N,t,n,r,i,a),e.modelViewMatrix.multiplyMatrices(n.matrixWorldInverse,e.matrixWorld),e.normalMatrix.getNormalMatrix(e.modelViewMatrix),i.onBeforeRender(N,t,n,r,e,a),i.transparent===!0&&i.side===2&&i.forceSinglePass===!1?(i.side=1,i.needsUpdate=!0,N.renderBufferDirect(n,t,r,i,e,a),i.side=0,i.needsUpdate=!0,N.renderBufferDirect(n,t,r,i,e,a),i.side=2):N.renderBufferDirect(n,t,r,i,e,a),e.onAfterRender(N,t,n,r,i,a)}function gt(e,t,n){t.isScene!==!0&&(t=Ce);let r=G.get(e),i=C.state.lights,a=C.state.shadowsArray,o=i.state.version,s=Fe.getParameters(e,i.state,a,t,n,C.state.lightProbeGridArray),c=Fe.getProgramCacheKey(s),l=r.programs;r.environment=e.isMeshStandardMaterial||e.isMeshLambertMaterial||e.isMeshPhongMaterial?t.environment:null,r.fog=t.fog;let u=e.isMeshStandardMaterial||e.isMeshLambertMaterial&&!e.envMap||e.isMeshPhongMaterial&&!e.envMap;r.envMap=je.get(e.envMap||r.environment,u),r.envMapRotation=r.environment!==null&&e.envMap===null?t.environmentRotation:e.envMapRotation,l===void 0&&(e.addEventListener(`dispose`,rt),l=new Map,r.programs=l);let d=l.get(c);if(d!==void 0){if(r.currentProgram===d&&r.lightsStateVersion===o)return vt(e,s),d}else s.uniforms=Fe.getUniforms(e),F!==null&&e.isNodeMaterial&&F.build(e,n,s),e.onBeforeCompile(s,N),d=Fe.acquireProgram(s,c),l.set(c,d),r.uniforms=s.uniforms;let f=r.uniforms;return(!e.isShaderMaterial&&!e.isRawShaderMaterial||e.clipping===!0)&&(f.clippingPlanes=ze.uniform),vt(e,s),r.needsLights=xt(e),r.lightsStateVersion=o,r.needsLights&&(f.ambientLightColor.value=i.state.ambient,f.lightProbe.value=i.state.probe,f.sunLights.value=i.state.sun,f.sunLightShadows.value=i.state.sunShadow,f.directionalLights.value=i.state.directional,f.directionalLightShadows.value=i.state.directionalShadow,f.spotLights.value=i.state.spot,f.spotLightShadows.value=i.state.spotShadow,f.rectAreaLights.value=i.state.rectArea,f.ltc_1.value=i.state.rectAreaLTC1,f.ltc_2.value=i.state.rectAreaLTC2,f.pointLights.value=i.state.point,f.pointLightShadows.value=i.state.pointShadow,f.hemisphereLights.value=i.state.hemi,f.sunShadowMatrix.value=i.state.sunShadowMatrix,f.sunShadowCascade.value=i.state.sunShadowCascade,f.directionalShadowMatrix.value=i.state.directionalShadowMatrix,f.spotLightMatrix.value=i.state.spotLightMatrix,f.spotLightMap.value=i.state.spotLightMap,f.pointShadowMatrix.value=i.state.pointShadowMatrix),r.lightProbeGrid=C.state.lightProbeGridArray.length>0,r.currentProgram=d,r.uniformsList=null,d}function _t(e){if(e.uniformsList===null){let t=e.currentProgram.getUniforms();e.uniformsList=Qs.seqWithValue(t.seq,e.uniforms)}return e.uniformsList}function vt(e,t){let n=G.get(e);n.outputColorSpace=t.outputColorSpace,n.batching=t.batching,n.batchingColor=t.batchingColor,n.instancing=t.instancing,n.instancingColor=t.instancingColor,n.instancingMorph=t.instancingMorph,n.skinning=t.skinning,n.morphTargets=t.morphTargets,n.morphNormals=t.morphNormals,n.morphColors=t.morphColors,n.morphTargetsCount=t.morphTargetsCount,n.numClippingPlanes=t.numClippingPlanes,n.numIntersection=t.numClipIntersection,n.vertexAlphas=t.vertexAlphas,n.vertexTangents=t.vertexTangents,n.toneMapping=t.toneMapping}function Z(e,t){if(e.length===0)return null;if(e.length===1)return e[0].texture===null?null:e[0];y.setFromMatrixPosition(t.matrixWorld);for(let t=0,n=e.length;t<n;t++){let n=e[t];if(n.texture!==null&&n.boundingBox.containsPoint(y))return n}return null}function yt(e,t,n,r,i){t.isScene!==!0&&(t=Ce),Ae.resetTextureUnits();let a=t.fog,o=r.isMeshStandardMaterial||r.isMeshLambertMaterial||r.isMeshPhongMaterial?t.environment:null,s=R===null?N.outputColorSpace:R.isXRRenderTarget===!0?R.texture.colorSpace:Ct.workingColorSpace,c=r.isMeshStandardMaterial||r.isMeshLambertMaterial&&!r.envMap||r.isMeshPhongMaterial&&!r.envMap,l=je.get(r.envMap||o,c),u=r.vertexColors===!0&&!!n.attributes.color&&n.attributes.color.itemSize===4,d=!!n.attributes.tangent&&(!!r.normalMap||r.anisotropy>0),f=!!n.morphAttributes.position,p=!!n.morphAttributes.normal,m=!!n.morphAttributes.color,h=0;r.toneMapped&&(R===null||R.isXRRenderTarget===!0)&&(h=N.toneMapping);let g=n.morphAttributes.position||n.morphAttributes.normal||n.morphAttributes.color,_=g===void 0?0:g.length,v=G.get(r),y=C.state.lights;if(ve===!0&&(ye===!0||e!==ae)){let t=e===ae&&r.id===B;ze.setState(r,e,t)}let b=!1;r.version===v.__version?v.needsLights&&v.lightsStateVersion!==y.state.version?b=!0:v.outputColorSpace===s?i.isBatchedMesh&&v.batching===!1||!i.isBatchedMesh&&v.batching===!0||i.isBatchedMesh&&v.batchingColor===!0&&i._colorsTexture===null||i.isBatchedMesh&&v.batchingColor===!1&&i._colorsTexture!==null||i.isInstancedMesh&&v.instancing===!1||!i.isInstancedMesh&&v.instancing===!0||i.isSkinnedMesh&&v.skinning===!1||!i.isSkinnedMesh&&v.skinning===!0||i.isInstancedMesh&&v.instancingColor===!0&&i.instanceColor===null||i.isInstancedMesh&&v.instancingColor===!1&&i.instanceColor!==null||i.isInstancedMesh&&v.instancingMorph===!0&&i.morphTexture===null||i.isInstancedMesh&&v.instancingMorph===!1&&i.morphTexture!==null?b=!0:v.envMap===l?r.fog===!0&&v.fog!==a||v.numClippingPlanes!==void 0&&(v.numClippingPlanes!==ze.numPlanes||v.numIntersection!==ze.numIntersection)?b=!0:v.vertexAlphas===u&&v.vertexTangents===d&&v.morphTargets===f&&v.morphNormals===p&&v.morphColors===m&&v.toneMapping===h&&v.morphTargetsCount===_?!!v.lightProbeGrid!=C.state.lightProbeGridArray.length>0&&(b=!0):b=!0:b=!0:b=!0:(b=!0,v.__version=r.version);let x=v.currentProgram;b===!0&&(x=gt(r,t,i),F&&r.isNodeMaterial&&F.onUpdateProgram(r,x,v));let S=!1,w=!1,T=!1,E=x.getUniforms(),D=v.uniforms;if(W.useProgram(x.program)&&(S=!0,w=!0,T=!0),r.id!==B&&(B=r.id,w=!0),v.needsLights){let e=Z(C.state.lightProbeGridArray,i);v.lightProbeGrid!==e&&(v.lightProbeGrid=e,w=!0)}if(S||ae!==e){W.buffers.depth.getReversed()&&e.reversedDepth!==!0&&(e._reversedDepth=!0,e.updateProjectionMatrix()),E.setValue(U,`projectionMatrix`,e.projectionMatrix),E.setValue(U,`viewMatrix`,e.matrixWorldInverse);let t=E.map.cameraPosition;t!==void 0&&t.setValue(U,xe.setFromMatrixPosition(e.matrixWorld)),Oe.logarithmicDepthBuffer&&E.setValue(U,`logDepthBufFC`,2/(Math.log(e.far+1)/Math.LN2)),(r.isMeshPhongMaterial||r.isMeshToonMaterial||r.isMeshLambertMaterial||r.isMeshBasicMaterial||r.isMeshStandardMaterial||r.isShaderMaterial)&&E.setValue(U,`isOrthographic`,e.isOrthographicCamera===!0),ae!==e&&(ae=e,w=!0,T=!0)}if(v.needsLights&&(y.state.sunShadowMap.length>0&&E.setValue(U,`sunShadowMap`,y.state.sunShadowMap,Ae),y.state.directionalShadowMap.length>0&&E.setValue(U,`directionalShadowMap`,y.state.directionalShadowMap,Ae),y.state.spotShadowMap.length>0&&E.setValue(U,`spotShadowMap`,y.state.spotShadowMap,Ae),y.state.pointShadowMap.length>0&&E.setValue(U,`pointShadowMap`,y.state.pointShadowMap,Ae)),i.isSkinnedMesh){E.setOptional(U,i,`bindMatrix`),E.setOptional(U,i,`bindMatrixInverse`);let e=i.skeleton;e&&(e.boneTexture===null&&e.computeBoneTexture(),E.setValue(U,`boneTexture`,e.boneTexture,Ae))}i.isBatchedMesh&&(E.setOptional(U,i,`batchingTexture`),E.setValue(U,`batchingTexture`,i._matricesTexture,Ae),E.setOptional(U,i,`batchingIdTexture`),E.setValue(U,`batchingIdTexture`,i._indirectTexture,Ae),E.setOptional(U,i,`batchingColorTexture`),i._colorsTexture!==null&&E.setValue(U,`batchingColorTexture`,i._colorsTexture,Ae));let O=n.morphAttributes;if((O.position!==void 0||O.normal!==void 0||O.color!==void 0)&&He.update(i,n,x),(w||v.receiveShadow!==i.receiveShadow)&&(v.receiveShadow=i.receiveShadow,E.setValue(U,`receiveShadow`,i.receiveShadow)),(r.isMeshStandardMaterial||r.isMeshLambertMaterial||r.isMeshPhongMaterial)&&r.envMap===null&&t.environment!==null&&(D.envMapIntensity.value=t.environmentIntensity),D.dfgLUT!==void 0&&(D.dfgLUT.value=yl()),w){if(E.setValue(U,`toneMappingExposure`,N.toneMappingExposure),v.needsLights&&bt(D,T),a&&r.fog===!0&&Ie.refreshFogUniforms(D,a),Ie.refreshMaterialUniforms(D,r,H,de,C.state.transmissionRenderTarget[e.id]),v.needsLights&&v.lightProbeGrid){let e=v.lightProbeGrid;D.probesSH.value=e.texture,D.probesMin.value.copy(e.boundingBox.min),D.probesMax.value.copy(e.boundingBox.max),D.probesResolution.value.copy(e.resolution)}Qs.upload(U,_t(v),D,Ae)}if(r.isShaderMaterial&&r.uniformsNeedUpdate===!0&&(Qs.upload(U,_t(v),D,Ae),r.uniformsNeedUpdate=!1),r.isSpriteMaterial&&E.setValue(U,`center`,i.center),E.setValue(U,`modelViewMatrix`,i.modelViewMatrix),E.setValue(U,`normalMatrix`,i.normalMatrix),E.setValue(U,`modelMatrix`,i.matrixWorld),r.uniformsGroups!==void 0){let e=r.uniformsGroups;for(let t=0,n=e.length;t<n;t++){let n=e[t];Je.update(n,x),Je.bind(n,x)}}return x}function bt(e,t){e.ambientLightColor.needsUpdate=t,e.lightProbe.needsUpdate=t,e.sunLights.needsUpdate=t,e.sunLightShadows.needsUpdate=t,e.directionalLights.needsUpdate=t,e.directionalLightShadows.needsUpdate=t,e.pointLights.needsUpdate=t,e.pointLightShadows.needsUpdate=t,e.spotLights.needsUpdate=t,e.spotLightShadows.needsUpdate=t,e.rectAreaLights.needsUpdate=t,e.hemisphereLights.needsUpdate=t}function xt(e){return e.isMeshLambertMaterial||e.isMeshToonMaterial||e.isMeshPhongMaterial||e.isMeshStandardMaterial||e.isShadowMaterial||e.isShaderMaterial&&e.lights===!0}this.getActiveCubeFace=function(){return te},this.getActiveMipmapLevel=function(){return ne},this.getRenderTarget=function(){return R},this.setRenderTargetTextures=function(e,t,n){let r=G.get(e);r.__autoAllocateDepthBuffer=e.resolveDepthBuffer===!1,r.__autoAllocateDepthBuffer===!1&&(r.__useRenderToTexture=!1),G.get(e.texture).__webglTexture=t,G.get(e.depthTexture).__webglTexture=r.__autoAllocateDepthBuffer?void 0:n,r.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(e,t){let n=G.get(e);n.__webglFramebuffer=t,n.__useDefaultFramebuffer=t===void 0},this.setRenderTarget=function(e,t=0,n=0){R=e,te=t,ne=n;let r=null,i=!1,a=!1;if(e){let o=G.get(e);if(o.__useDefaultFramebuffer!==void 0){W.bindFramebuffer(U.FRAMEBUFFER,o.__webglFramebuffer),oe.copy(e.viewport),V.copy(e.scissor),se=e.scissorTest,W.viewport(oe),W.scissor(V),W.setScissorTest(se),B=-1;return}if(o.__webglFramebuffer===void 0)Ae.setupRenderTarget(e);else if(o.__hasExternalTextures)Ae.rebindTextures(e,G.get(e.texture).__webglTexture,G.get(e.depthTexture).__webglTexture);else if(e.depthBuffer){let t=e.depthTexture;if(o.__boundDepthTexture!==t){if(t!==null&&G.has(t)&&(e.width!==t.image.width||e.height!==t.image.height))throw Error(`THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.`);Ae.setupDepthRenderbuffer(e)}}let s=e.texture;(s.isData3DTexture||s.isDataArrayTexture||s.isCompressedArrayTexture)&&(a=!0);let c=G.get(e).__webglFramebuffer;e.isWebGLCubeRenderTarget?(r=Array.isArray(c[t])?c[t][n]:c[t],i=!0):r=e.samples>0&&Ae.useMultisampledRTT(e)===!1?G.get(e).__webglMultisampledFramebuffer:Array.isArray(c)?c[n]:c,oe.copy(e.viewport),V.copy(e.scissor),se=e.scissorTest}else oe.copy(me).multiplyScalar(H).floor(),V.copy(he).multiplyScalar(H).floor(),se=ge;if(n!==0&&(r=I),W.bindFramebuffer(U.FRAMEBUFFER,r)&&W.drawBuffers(e,r),W.viewport(oe),W.scissor(V),W.setScissorTest(se),i){let r=G.get(e.texture);U.framebufferTexture2D(U.FRAMEBUFFER,U.COLOR_ATTACHMENT0,U.TEXTURE_CUBE_MAP_POSITIVE_X+t,r.__webglTexture,n)}else if(a){let r=t;for(let t=0;t<e.textures.length;t++){let i=G.get(e.textures[t]);U.framebufferTextureLayer(U.FRAMEBUFFER,U.COLOR_ATTACHMENT0+t,i.__webglTexture,n,r)}}else if(e!==null&&n!==0){let t=G.get(e.texture);U.framebufferTexture2D(U.FRAMEBUFFER,U.COLOR_ATTACHMENT0,U.TEXTURE_2D,t.__webglTexture,n)}B=-1};function St(e){let t=G.get(e);return(t.__readFormat!==e.format||t.__readType!==e.type)&&(t.__readFormat=e.format,t.__readType=e.type,t.__formatReadable=Oe.textureFormatReadable(e.format),t.__typeReadable=Oe.textureTypeReadable(e.type)),t}this.readRenderTargetPixels=function(e,t,n,r,i,a,o,s=0){if(!(e&&e.isWebGLRenderTarget)){q(`WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.`);return}let c=G.get(e).__webglFramebuffer;if(e.isWebGLCubeRenderTarget&&o!==void 0&&(c=c[o]),c){W.bindFramebuffer(U.FRAMEBUFFER,c);try{let o=e.textures[s],c=o.format,l=o.type;e.textures.length>1&&U.readBuffer(U.COLOR_ATTACHMENT0+s);let u=St(o);if(u.__formatReadable===!1){q(`WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.`);return}if(u.__typeReadable===!1){q(`WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.`);return}t>=0&&t<=e.width-r&&n>=0&&n<=e.height-i&&U.readPixels(t,n,r,i,Ke.convert(c),Ke.convert(l),a)}finally{let e=R===null?null:G.get(R).__webglFramebuffer;W.bindFramebuffer(U.FRAMEBUFFER,e)}}},this.readRenderTargetPixelsAsync=async function(e,t,n,r,i,a,o,s=0){if(!(e&&e.isWebGLRenderTarget))throw Error(`THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.`);let c=G.get(e).__webglFramebuffer;if(e.isWebGLCubeRenderTarget&&o!==void 0&&(c=c[o]),c){if(t>=0&&t<=e.width-r&&n>=0&&n<=e.height-i){W.bindFramebuffer(U.FRAMEBUFFER,c);let o=e.textures[s],l=o.format,u=o.type;e.textures.length>1&&U.readBuffer(U.COLOR_ATTACHMENT0+s);let d=St(o);if(d.__formatReadable===!1)throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.`);if(d.__typeReadable===!1)throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.`);let f=U.createBuffer();U.bindBuffer(U.PIXEL_PACK_BUFFER,f),U.bufferData(U.PIXEL_PACK_BUFFER,a.byteLength,U.STREAM_READ),U.readPixels(t,n,r,i,Ke.convert(l),Ke.convert(u),0),U.bindBuffer(U.PIXEL_PACK_BUFFER,null);let p=R===null?null:G.get(R).__webglFramebuffer;W.bindFramebuffer(U.FRAMEBUFFER,p);let m=U.fenceSync(U.SYNC_GPU_COMMANDS_COMPLETE,0);return U.flush(),await at(U,m,4),U.bindBuffer(U.PIXEL_PACK_BUFFER,f),U.getBufferSubData(U.PIXEL_PACK_BUFFER,0,a),U.bindBuffer(U.PIXEL_PACK_BUFFER,null),U.deleteBuffer(f),U.deleteSync(m),a}throw Error(`THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.`)}},this.copyFramebufferToTexture=function(e,t=null,n=0){let r=2**-n,i=Math.floor(e.image.width*r),a=Math.floor(e.image.height*r),o=t===null?0:t.x,s=t===null?0:t.y;Ae.setTexture2D(e,0),U.copyTexSubImage2D(U.TEXTURE_2D,n,0,0,o,s,i,a),W.unbindTexture()},this.copyTextureToTexture=function(e,t,n=null,r=null,i=0,a=0){let o,s,c,l,u,d,f,p,m,h=e.isCompressedTexture?e.mipmaps[a]:e.image;if(n!==null)o=n.max.x-n.min.x,s=n.max.y-n.min.y,c=n.isBox3?n.max.z-n.min.z:1,l=n.min.x,u=n.min.y,d=n.isBox3?n.min.z:0;else{let t=2**-i;o=Math.floor(h.width*t),s=Math.floor(h.height*t),c=e.isDataArrayTexture?h.depth:e.isData3DTexture?Math.floor(h.depth*t):1,l=0,u=0,d=0}r===null?(f=0,p=0,m=0):(f=r.x,p=r.y,m=r.z);let g=Ke.convert(t.format),_=Ke.convert(t.type),v;t.isData3DTexture?(Ae.setTexture3D(t,0),v=U.TEXTURE_3D):t.isDataArrayTexture||t.isCompressedArrayTexture?(Ae.setTexture2DArray(t,0),v=U.TEXTURE_2D_ARRAY):(Ae.setTexture2D(t,0),v=U.TEXTURE_2D),W.activeTexture(U.TEXTURE0),W.pixelStorei(U.UNPACK_FLIP_Y_WEBGL,t.flipY),W.pixelStorei(U.UNPACK_PREMULTIPLY_ALPHA_WEBGL,t.premultiplyAlpha),W.pixelStorei(U.UNPACK_ALIGNMENT,t.unpackAlignment);let y=W.getParameter(U.UNPACK_ROW_LENGTH),b=W.getParameter(U.UNPACK_IMAGE_HEIGHT),x=W.getParameter(U.UNPACK_SKIP_PIXELS),S=W.getParameter(U.UNPACK_SKIP_ROWS),C=W.getParameter(U.UNPACK_SKIP_IMAGES);W.pixelStorei(U.UNPACK_ROW_LENGTH,h.width),W.pixelStorei(U.UNPACK_IMAGE_HEIGHT,h.height),W.pixelStorei(U.UNPACK_SKIP_PIXELS,l),W.pixelStorei(U.UNPACK_SKIP_ROWS,u),W.pixelStorei(U.UNPACK_SKIP_IMAGES,d);let w=e.isDataArrayTexture||e.isData3DTexture,T=t.isDataArrayTexture||t.isData3DTexture;if(e.isDepthTexture){let n=G.get(e),r=G.get(t),h=G.get(n.__renderTarget),g=G.get(r.__renderTarget);W.bindFramebuffer(U.READ_FRAMEBUFFER,h.__webglFramebuffer),W.bindFramebuffer(U.DRAW_FRAMEBUFFER,g.__webglFramebuffer);for(let n=0;n<c;n++)w&&(U.framebufferTextureLayer(U.READ_FRAMEBUFFER,U.COLOR_ATTACHMENT0,G.get(e).__webglTexture,i,d+n),U.framebufferTextureLayer(U.DRAW_FRAMEBUFFER,U.COLOR_ATTACHMENT0,G.get(t).__webglTexture,a,m+n)),U.blitFramebuffer(l,u,o,s,f,p,o,s,U.DEPTH_BUFFER_BIT,U.NEAREST);W.bindFramebuffer(U.READ_FRAMEBUFFER,null),W.bindFramebuffer(U.DRAW_FRAMEBUFFER,null)}else if(i!==0||e.isRenderTargetTexture||G.has(e)){let n=G.get(e),r=G.get(t);W.bindFramebuffer(U.READ_FRAMEBUFFER,L),W.bindFramebuffer(U.DRAW_FRAMEBUFFER,ee);for(let e=0;e<c;e++)w?U.framebufferTextureLayer(U.READ_FRAMEBUFFER,U.COLOR_ATTACHMENT0,n.__webglTexture,i,d+e):U.framebufferTexture2D(U.READ_FRAMEBUFFER,U.COLOR_ATTACHMENT0,U.TEXTURE_2D,n.__webglTexture,i),T?U.framebufferTextureLayer(U.DRAW_FRAMEBUFFER,U.COLOR_ATTACHMENT0,r.__webglTexture,a,m+e):U.framebufferTexture2D(U.DRAW_FRAMEBUFFER,U.COLOR_ATTACHMENT0,U.TEXTURE_2D,r.__webglTexture,a),i===0?T?U.copyTexSubImage3D(v,a,f,p,m+e,l,u,o,s):U.copyTexSubImage2D(v,a,f,p,l,u,o,s):U.blitFramebuffer(l,u,o,s,f,p,o,s,U.COLOR_BUFFER_BIT,U.NEAREST);W.bindFramebuffer(U.READ_FRAMEBUFFER,null),W.bindFramebuffer(U.DRAW_FRAMEBUFFER,null)}else T?e.isDataTexture||e.isData3DTexture?U.texSubImage3D(v,a,f,p,m,o,s,c,g,_,h.data):t.isCompressedArrayTexture?U.compressedTexSubImage3D(v,a,f,p,m,o,s,c,g,h.data):U.texSubImage3D(v,a,f,p,m,o,s,c,g,_,h):e.isDataTexture?U.texSubImage2D(U.TEXTURE_2D,a,f,p,o,s,g,_,h.data):e.isCompressedTexture?U.compressedTexSubImage2D(U.TEXTURE_2D,a,f,p,h.width,h.height,g,h.data):U.texSubImage2D(U.TEXTURE_2D,a,f,p,o,s,g,_,h);W.pixelStorei(U.UNPACK_ROW_LENGTH,y),W.pixelStorei(U.UNPACK_IMAGE_HEIGHT,b),W.pixelStorei(U.UNPACK_SKIP_PIXELS,x),W.pixelStorei(U.UNPACK_SKIP_ROWS,S),W.pixelStorei(U.UNPACK_SKIP_IMAGES,C),a===0&&t.generateMipmaps&&U.generateMipmap(v),W.unbindTexture()},this.initRenderTarget=function(e){G.get(e).__webglFramebuffer===void 0&&Ae.setupRenderTarget(e)},this.initTexture=function(e){e.isCubeTexture?Ae.setTextureCube(e,0):e.isData3DTexture?Ae.setTexture3D(e,0):e.isDataArrayTexture||e.isCompressedArrayTexture?Ae.setTexture2DArray(e,0):Ae.setTexture2D(e,0),W.unbindTexture()},this.resetState=function(){te=0,ne=0,R=null,W.reset(),qe.reset()},typeof __THREE_DEVTOOLS__<`u`&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent(`observe`,{detail:this}))}get coordinateSystem(){return Xe}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;let t=this.getContext();t.drawingBufferColorSpace=Ct._getDrawingBufferColorSpace(e),t.unpackColorSpace=Ct._getUnpackColorSpace()}},xl=class{inner;vertexCount;positions;restLocal;indices;strain;center={x:0,y:0,z:0};frame;metrics;restRadius;native;offset={x:0,y:0,z:0};scale=1;squashAx=1;squashAz=0;squashAmt=0;squashPlane=1e9;squashTwoSided=!1;charge=0;fold=0;foldGoal=0;trembleAmp=0;burstX=0;burstV=0;moveGoal=null;moveK=1;time=0;foldRadius;constructor(e){this.inner=e,this.vertexCount=e.vertexCount,this.restLocal=e.restLocal,this.indices=e.indices,this.frame=e.frame,this.restRadius=e.restRadius,this.positions=new Float32Array(e.positions.length),this.strain=new Float32Array(e.strain.length),this.metrics={...e.metrics},this.native={fold:typeof e.setFold==`function`,moveTo:typeof e.moveTo==`function`,tremble:typeof e.tremble==`function`,burst:typeof e.burstOpen==`function`},this.foldRadius=e.restRadius*.8,this.sync(0,0)}get piece(){return this.inner.piece}get morphT(){return this.inner.morphT??0}get meanEdge(){return this.inner.meanEdge}get frac(){return this.inner.frac}get gravity(){return this.inner.gravity}set gravity(e){this.inner.gravity=e}setOffset(e,t,n){this.offset.x=e,this.offset.y=t,this.offset.z=n}setFold(e){this.foldGoal=Math.min(1,Math.max(0,e)),this.native.fold&&this.inner.setFold?.(this.foldGoal)}moveTo(e,t=1){if(this.native.moveTo){this.inner.moveTo?.(e,t);return}this.moveGoal=e?{x:e.x,y:0,z:e.z}:null,this.moveK=Math.max(.1,t)}tremble(e){this.trembleAmp=Math.min(1,Math.max(0,e)),this.native.tremble&&this.inner.tremble?.(this.trembleAmp)}burstOpen(e){let t=Math.min(1,Math.max(0,e));this.native.burst?this.inner.burstOpen?.(t):this.burstV+=5.6*t}popFrom(e,t){this.burstX=e,this.burstV=t}get foldAmount(){return this.native.fold?this.foldGoal:this.fold}sync(e,t){let n=this.inner,r=n.positions,i=this.positions,a=this.vertexCount,o=n.center;if(this.time=t,!this.native.fold){let t=1-Math.exp(-e*7);this.fold+=(this.foldGoal-this.fold)*t}if(!this.native.burst&&e>0&&(this.burstV+=(-260*this.burstX-7*this.burstV)*e,this.burstX+=this.burstV*e,this.burstX>.6&&(this.burstX=.6),this.burstX<-.8&&(this.burstX=-.8)),!this.native.moveTo&&this.moveGoal&&e>0){let t=1-Math.exp(-e*9*this.moveK);this.offset.x+=(this.moveGoal.x-this.offset.x)*t,this.offset.z+=(this.moveGoal.z-this.offset.z)*t}let s=this.native.fold?0:this.fold,c=this.native.burst?0:this.burstX,l=this.native.tremble?0:this.trembleAmp,u=this.scale*(1+c),d=this.offset.x,f=this.offset.y,p=this.offset.z,m=this.foldRadius,h=o.x,g=o.y,_=o.z,v=this.squashAmt,y=this.squashAx,b=this.squashAz,x=this.squashPlane,S=this.squashTwoSided,C=this.restRadius*.012*l,w=this.restRadius,T=s>.001||c!==0||l>0||u!==1||v>.001,E=0,D=0;if(T){let e=t;for(let t=0,n=0;t<a*3;t+=3,n++){let a=r[t]-h,o=r[t+1]-g,c=r[t+2]-_;if(s>.001){let e=s*(m/(Math.sqrt(a*a+o*o+c*c)+1e-6)-1);a+=a*e,o+=o*e,c+=c*e}if(v>.001){let e=a*y+c*b,t=-x-e,n=1;if(S&&e-x>t&&(t=e-x,n=-1),t>0){t>D&&(D=t);let r=v*t,i=e+n*r*.92,s=1+v*.55*Math.min(1.5,t/w),l=(a-y*e)*s,u=(c-b*e)*s;a=y*i+l,c=b*i+u,o=o*(1+v*.25*Math.min(1.5,t/w))+v*.12*t}else{let n=1+v*.06*Math.max(0,1- -t/w),r=(a-y*e)*n,i=(c-b*e)*n;a=y*e+r,c=b*e+i}}l>0&&(a+=Math.sin(e*61+n*1.7)*C,o+=Math.sin(e*53+n*2.3)*C,c+=Math.sin(e*47+n*.9)*C),i[t]=h+a*u+d,i[t+1]=g+o*u+f,i[t+2]=_+c*u+p}if(n.metrics.grounded||n.gravity){let e=1e9;for(let t=1;t<a*3;t+=3)i[t]<e&&(e=i[t]);E=f-e;for(let e=1;e<a*3;e+=3)i[e]+=E}}else for(let e=0;e<a*3;e+=3)i[e]=r[e]+d,i[e+1]=r[e+1]+f,i[e+2]=r[e+2]+p;this.center.x=h+d,this.center.y=g+f+E,this.center.z=_+p;let O=n.strain,k=this.strain,A=v*Math.min(1,D/(.3*w)),j=Math.min(1,s*.35+this.charge*.45+A*.7),M=1-.1*j;for(let e=0;e<a;e++)k[e]=O[e]*M;let N=this.metrics,P=n.metrics;for(let e in P)N[e]=P[e];let F=this.metrics,I=n.metrics;F.compression=Math.max(I.compression,j),F.kinetic=Math.min(1,I.kinetic+l*.5)}tip(e){let t=typeof this.inner.tip==`function`?this.inner.tip(e):null;return t?(t.x+=this.offset.x,t.y+=this.offset.y,t.z+=this.offset.z,t):null}step(e){this.inner.step(e)}raycast(e,t){if(this.offset.x===0&&this.offset.y===0&&this.offset.z===0)return this.inner.raycast(e,t);let n=this.inner.raycast({x:e.x-this.offset.x,y:e.y-this.offset.y,z:e.z-this.offset.z},t);return n?{point:{x:n.point.x+this.offset.x,y:n.point.y+this.offset.y,z:n.point.z+this.offset.z},normal:n.normal,vertex:n.vertex,t:n.t}:null}fingerDown(e,t){this.inner.fingerDown(e,t)}fingerPressure(e,t){this.inner.fingerPressure(e,t)}fingerMove(e,t){this.inner.fingerMove(e,t)}fingerUp(e){this.inner.fingerUp(e)}grab(e,t,n){this.inner.grab(e,t,n)}grabMove(e,t){this.inner.grabMove(e,t)}grabRelease(e){this.inner.grabRelease(e)}nudge(e){this.inner.nudge(e)}reset(){this.inner.reset()}drainEvents(e){this.inner.drainEvents(e)}stateHash(){return this.inner.stateHash()}},Sl={enabled:!0,fullViews:8,minFreq:4,minShare:.002,regrow:1.25};function Cl(e,t,n){if(!Sl.enabled)return e;let r=n!==void 0&&Number.isFinite(n)&&n>0?Math.min(1,Math.max(Sl.minShare,n)):1,i=Math.min(1,r**(2/3),Math.max(0,t/642)),a=Math.round(e*Math.sqrt(i));return Math.max(Math.min(Sl.minFreq,Math.floor(e)),Math.min(Math.floor(e),a))}function wl(e,t,n){n.fill(0);for(let r=0;r<t.length;r+=3){let i=t[r]*3,a=t[r+1]*3,o=t[r+2]*3,s=e[a]-e[i],c=e[a+1]-e[i+1],l=e[a+2]-e[i+2],u=e[o]-e[i],d=e[o+1]-e[i+1],f=e[o+2]-e[i+2],p=c*f-l*d,m=l*u-s*f,h=s*d-c*u;n[i]+=p,n[i+1]+=m,n[i+2]+=h,n[a]+=p,n[a+1]+=m,n[a+2]+=h,n[o]+=p,n[o+1]+=m,n[o+2]+=h}for(let e=0;e<n.length;e+=3){let t=Math.sqrt(n[e]*n[e]+n[e+1]*n[e+1]+n[e+2]*n[e+2]);if(t>1e-20){let r=1/t;n[e]*=r,n[e+1]*=r,n[e+2]*=r}else n[e]=0,n[e+1]=1,n[e+2]=0}}function Tl(e,t,n,r){n.fill(0);for(let r=0;r<t.length;r+=3){let i=t[r]*3,a=t[r+1]*3,o=t[r+2]*3;n[i]+=e[a]+e[o],n[i+1]+=e[a+1]+e[o+1],n[i+2]+=e[a+2]+e[o+2],n[a]+=e[i]+e[o],n[a+1]+=e[i+1]+e[o+1],n[a+2]+=e[i+2]+e[o+2],n[o]+=e[i]+e[a],n[o+1]+=e[i+1]+e[a+1],n[o+2]+=e[i+2]+e[a+2]}for(let t=0;t<e.length;t+=3){let i=Math.sqrt(n[t]*n[t]+n[t+1]*n[t+1]+n[t+2]*n[t+2])||1,a=e[t]*(1-r)+n[t]/i*r,o=e[t+1]*(1-r)+n[t+1]/i*r,s=e[t+2]*(1-r)+n[t+2]/i*r,c=Math.sqrt(a*a+o*o+s*s)||1;e[t]=a/c,e[t+1]=o/c,e[t+2]=s/c}}function El(e,t,n,r){r.fill(0);for(let i=0;i<n.length;i++){let a=n[i]*3,o=t[a]*3,s=t[a+1]*3,c=t[a+2]*3,l=e[s]-e[o],u=e[s+1]-e[o+1],d=e[s+2]-e[o+2],f=e[c]-e[o],p=e[c+1]-e[o+1],m=e[c+2]-e[o+2],h=u*m-d*p,g=d*f-l*m,_=l*p-u*f;r[o]+=h,r[o+1]+=g,r[o+2]+=_,r[s]+=h,r[s+1]+=g,r[s+2]+=_,r[c]+=h,r[c+1]+=g,r[c+2]+=_}for(let e=0;e<r.length;e+=3){let t=Math.sqrt(r[e]*r[e]+r[e+1]*r[e+1]+r[e+2]*r[e+2]);if(t>1e-20){let n=1/t;r[e]*=n,r[e+1]*=n,r[e+2]*=n}else r[e]=0,r[e+1]=1,r[e+2]=0}}function Dl(e,t,n,r,i){r.fill(0);for(let i=0;i<n.length;i++){let a=n[i]*3,o=t[a]*3,s=t[a+1]*3,c=t[a+2]*3;r[o]+=e[s]+e[c],r[o+1]+=e[s+1]+e[c+1],r[o+2]+=e[s+2]+e[c+2],r[s]+=e[o]+e[c],r[s+1]+=e[o+1]+e[c+1],r[s+2]+=e[o+2]+e[c+2],r[c]+=e[o]+e[s],r[c+1]+=e[o+1]+e[s+1],r[c+2]+=e[o+2]+e[s+2]}for(let t=0;t<e.length;t+=3){let n=Math.sqrt(r[t]*r[t]+r[t+1]*r[t+1]+r[t+2]*r[t+2]);if(n<1e-20)continue;let a=e[t]*(1-i)+r[t]/n*i,o=e[t+1]*(1-i)+r[t+1]/n*i,s=e[t+2]*(1-i)+r[t+2]/n*i,c=Math.sqrt(a*a+o*o+s*s)||1;e[t]=a/c,e[t+1]=o/c,e[t+2]=s/c}}var Ol={nExtra:0};function kl(e,t,n){let r=10*e*e+2,i=Math.max(Sl.enabled?.002:.02,Math.min(1,Number.isFinite(t)?t:.5)),a=Sl.enabled?n<200?3:i<.04?1:2:2;return Math.max(a,Math.min(8,Math.floor(Math.sqrt(2*r*i**(2/3)/Math.max(1,n))+.35)+Ol.nExtra))}function Al(e){return!!e&&Array.isArray(e.cells)&&e.cells.length>0&&Array.isArray(e.cells[0])&&e.cells[0].length>0}var jl=e=>{let t=0;for(;!(e&1);)e>>=1,t++;return t},Ml=new WeakMap;function Nl(e){let t=Ml.get(e.restLocal);if(!t){let n=e.restLocal.length/3|0,r=e.indices,i=new Uint32Array(n+1);for(let e=0;e<r.length;e++)i[r[e]+1]++;for(let e=0;e<n;e++)i[e+1]+=i[e];let a=new Uint32Array(r.length),o=new Uint32Array(n);for(let e=0;e<r.length/3;e++)for(let t=0;t<3;t++){let n=r[e*3+t];a[i[n]+o[n]++]=e}let s=new Float32Array(n*3),c=new Float32Array(n*3),l=e.restLocal instanceof Float32Array?e.restLocal:Float32Array.from(e.restLocal),u=e.indices instanceof Uint32Array?e.indices:Uint32Array.from(e.indices);wl(l,u,s),Tl(s,u,c,.7),Tl(s,u,c,.5),t={vtStart:i,vtList:a,wN:s},Ml.set(e.restLocal,t)}return t}function Pl(e,t,n,r,i,a,o,s){let c=e[t],l=e[t+1],u=e[t+2],d=e[n]-c,f=e[n+1]-l,p=e[n+2]-u,m=e[r]-c,h=e[r+1]-l,g=e[r+2]-u,_=i-c,v=a-l,y=o-u,b=d*_+f*v+p*y,x=m*_+h*v+g*y,S,C,w;if(b<=0&&x<=0)S=c,C=l,w=u;else{let t=i-e[n],s=a-e[n+1],_=o-e[n+2],v=d*t+f*s+p*_,y=m*t+h*s+g*_;if(v>=0&&y<=v)S=e[n],C=e[n+1],w=e[n+2];else{let t=b*y-v*x;if(t<=0&&b>=0&&v<=0){let e=b/(b-v);S=c+e*d,C=l+e*f,w=u+e*p}else{let s=i-e[r],_=a-e[r+1],T=o-e[r+2],E=d*s+f*_+p*T,D=m*s+h*_+g*T;if(D>=0&&E<=D)S=e[r],C=e[r+1],w=e[r+2];else{let i=E*x-b*D;if(i<=0&&x>=0&&D<=0){let e=x/(x-D);S=c+e*m,C=l+e*h,w=u+e*g}else{let a=v*D-E*y;if(a<=0&&y-v>=0&&E-D>=0){let t=(y-v)/(y-v+(E-D));S=e[n]+t*(e[r]-e[n]),C=e[n+1]+t*(e[r+1]-e[n+1]),w=e[n+2]+t*(e[r+2]-e[n+2])}else{let e=1/(a+i+t),n=i*e,r=t*e;S=c+d*n+m*r,C=l+f*n+h*r,w=u+p*n+g*r}}}}}}return s[0]=S,s[1]=C,s[2]=w,(S-i)*(S-i)+(C-a)*(C-a)+(w-o)*(w-o)}function Fl(e,t,n,r){let i=performance.now(),a=e.length/3|0,o=t.length/3|0,s=(n.cells[0]??[]).slice(0,8),c=s.length,l=n.whole.radius>0?n.whole.radius:.5,u=1e-6*l,d=n.offset.x,f=n.offset.y,p=n.offset.z,m=new Float64Array(a*3),h=new Uint8Array(a);for(let t=0;t<a;t++){let n=e[t*3]+d,r=e[t*3+1]+f,i=e[t*3+2]+p;m[t*3]=n,m[t*3+1]=r,m[t*3+2]=i;for(let e=0;e<c;e++){let a=s[e];Math.abs(a.n.x*n+a.n.y*r+a.n.z*i-a.d)<u&&(h[t]|=1<<e)}}let g=new Uint8Array(o);for(let e=0;e<o;e++){let n=h[t[e*3]]&h[t[e*3+1]]&h[t[e*3+2]];n&&(g[e]=1+jl(n))}let _=0;{let e=new Uint8Array(a);for(let n=0;n<o;n++){let r=g[n];if(r)for(let i=0;i<3;i++)e[t[n*3+i]]|=1<<r-1}for(let t=0;t<a;t++)h[t]&~e[t]&&_++;let n=new Map,r=new Map,i=(e,t)=>e<t?e*a+t:t*a+e;for(let e=0;e<o;e++)for(let a=0;a<3;a++){let o=i(t[e*3+a],t[e*3+(a+1)%3]);n.has(o)?r.set(o,e):n.set(o,e)}let s=new Int32Array(a*8);for(let e=0;e<o;e++){let a=g[e];for(let o=0;o<3;o++){let l=t[e*3+o],u=t[e*3+(o+1)%3],d=i(l,u),f=n.get(d),p=r.get(d),m=f===e?p:f,v=h[l]&h[u];if(a){let e=a-1;(m===void 0||g[m]!==a)&&(s[l*8+e]++,s[u*8+e]++)}else if(v)for(let e=0;e<c;e++)v>>e&1&&(m===void 0||g[m]!==e+1)&&_++}}for(let e=0;e<a;e++)for(let t=0;t<c;t++){let n=s[e*8+t];n!==0&&n!==2&&_++}}let v=!1;if(_>0){v=!0;for(let e=0;e<o;e++){let n=[0,0,0];for(let r=0;r<3;r++){let i=h[t[e*3+r]];n[r]=i?1+jl(i):0}let r=0,i=1;for(let e=0;e<3;e++){let t=0;for(let r=0;r<3;r++)n[r]===n[e]&&t++;t>i&&(i=t,r=n[e])}g[e]=i>=2?r:0}}let y=c+1,b=new Uint32Array(y);for(let e=0;e<o;e++)b[g[e]===0?c:g[e]-1]++;let x=[];for(let e=0;e<y;e++)x.push(new Uint32Array(b[e]));let S=new Uint32Array(y);for(let e=0;e<o;e++){let t=g[e]===0?c:g[e]-1;x[t][S[t]++]=e}let C=new Uint8Array(a).fill(255);for(let e=0;e<o;e++)for(let n=0;n<3;n++){let r=t[e*3+n],i=g[e];i===0?C[r]=0:C[r]===255&&(C[r]=i)}for(let e=0;e<a;e++)C[e]===255&&(C[e]=0);let w=performance.now(),T=[],E=[],D=.09*l;for(let e=0;e<c;e++){let n=x[e],r=new Float64Array;if(n.length){let i=new Uint8Array(a),o=new Map,c=(e,t)=>e<t?e*a+t:t*a+e;for(let e=0;e<n.length;e++)for(let r=0;r<3;r++){let a=t[n[e]*3+r],s=t[n[e]*3+(r+1)%3];i[a]=1,i[s]=1;let l=c(a,s);o.set(l,(o.get(l)??0)+1)}{let e=[];for(let[t,n]of o)if(n===1){let n=Math.floor(t/a),r=t%a;e.push(m[n*3],m[n*3+1],m[n*3+2],m[r*3],m[r*3+1],m[r*3+2])}r=Float64Array.from(e)}let l=s[e],u=Math.abs(l.n.y)<.9?[0,1,0]:[1,0,0],d=l.n.y*u[2]-l.n.z*u[1],f=l.n.z*u[0]-l.n.x*u[2],p=l.n.x*u[1]-l.n.y*u[0],g=Math.hypot(d,f,p)||1;d/=g,f/=g,p/=g;let _=l.n.y*p-l.n.z*f,v=l.n.z*d-l.n.x*p,y=l.n.x*f-l.n.y*d,b=1/0,x=-1/0,S=1/0,C=-1/0;for(let e=0;e<a;e++)if(i[e]){let t=m[e*3]*d+m[e*3+1]*f+m[e*3+2]*p,n=m[e*3]*_+m[e*3+1]*v+m[e*3+2]*y;t<b&&(b=t),t>x&&(x=t),n<S&&(S=n),n>C&&(C=n)}let w=Math.max(1e-6,(x-b)/8),T=Math.max(1e-6,(C-S)/8),D=new Float32Array(64);for(let t=0;t<a;t++){if(h[t]&1<<e)continue;let n=l.d-(l.n.x*m[t*3]+l.n.y*m[t*3+1]+l.n.z*m[t*3+2]);if(!(n>0))continue;let r=m[t*3]*d+m[t*3+1]*f+m[t*3+2]*p,i=m[t*3]*_+m[t*3+1]*v+m[t*3+2]*y,a=Math.max(0,Math.min(7,Math.floor((r-b)/w))),o=Math.max(0,Math.min(7,Math.floor((i-S)/T)));n>D[o*8+a]&&(D[o*8+a]=n)}for(let e=0;e<2;e++){let e=D.slice();for(let t=0;t<8;t++)for(let n=0;n<8;n++)if(e[t*8+n]===0){let r=0,i=0;for(let a=-1;a<=1;a++)for(let o=-1;o<=1;o++){let s=n+o,c=t+a;s>=0&&s<8&&c>=0&&c<8&&e[c*8+s]>0&&(r+=e[c*8+s],i++)}i&&(D[t*8+n]=r/i)}}{let e=D.slice();for(let t=0;t<8;t++)for(let n=0;n<8;n++){let r=0,i=0;for(let a=-1;a<=1;a++)for(let o=-1;o<=1;o++){let s=n+o,c=t+a;s>=0&&s<8&&c>=0&&c<8&&(r+=e[c*8+s],i++)}D[t*8+n]=r/i}}E.push({u0:b,v0:S,du:w,dv:T,e1:[d,f,p],e2:[_,v,y],g:D})}else E.push({u0:0,v0:0,du:1,dv:1,e1:[1,0,0],e2:[0,0,1],g:new Float32Array(64)});T.push(r)}let O=(e,t,n,r)=>{let i=T[e],a=1/0;for(let e=0;e<i.length;e+=6){let o=i[e],s=i[e+1],c=i[e+2],l=i[e+3]-o,u=i[e+4]-s,d=i[e+5]-c,f=t-o,p=n-s,m=r-c,h=l*l+u*u+d*d,g=h>0?(f*l+p*u+m*d)/h:0;g=g<0?0:g>1?1:g;let _=f-l*g,v=p-u*g,y=m-d*g,b=_*_+v*v+y*y;b<a&&(a=b)}return a},k=(e,t,n,r)=>{let i=Math.sqrt(O(e,t,n,r))/D;return i>=1?0:1-i*i*(3-2*i)},A=[];for(let e=0;e<c;e++){let n=new Float32Array(a).fill(1e9);if(T[e].length)for(let r=0;r<x[e].length;r++)for(let i=0;i<3;i++){let a=t[x[e][r]*3+i];n[a]===1e9&&(n[a]=Math.sqrt(O(e,m[a*3],m[a*3+1],m[a*3+2])))}A.push(n)}let j=(e,t,n,r)=>{let i=E[e],a=Math.max(0,Math.min(7,(t*i.e1[0]+n*i.e1[1]+r*i.e1[2]-i.u0)/i.du-.5)),o=Math.max(0,Math.min(7,(t*i.e2[0]+n*i.e2[1]+r*i.e2[2]-i.v0)/i.dv-.5)),s=Math.floor(a),c=Math.floor(o),l=Math.min(7,s+1),u=Math.min(7,c+1),d=a-s,f=o-c;return(i.g[c*8+s]*(1-d)+i.g[c*8+l]*d)*(1-f)+(i.g[u*8+s]*(1-d)+i.g[u*8+l]*d)*f},M=performance.now(),N=0,P=0,F=0;{let e=n.whole.restLocal,t=e.length/3|0;for(let n=0;n<t;n++)N+=e[n*3],P+=e[n*3+1],F+=e[n*3+2];N/=t||1,P/=t||1,F/=t||1}let I=new Float64Array(a*3),L=new Float32Array(a*3);{let e=n.whole.restLocal,r=n.whole.indices,i=e.length/3|0,o=Nl(n.whole),s=new Float64Array(3),l=new Float64Array(3),u=x[c],d=new Uint32Array(a+1);for(let e=0;e<u.length;e++)for(let n=0;n<3;n++)d[t[u[e]*3+n]+1]+=2;for(let e=0;e<a;e++)d[e+1]+=d[e];let f=new Uint32Array(d[a]),p=new Uint32Array(a);for(let e=0;e<u.length;e++){let n=u[e];for(let e=0;e<3;e++){let r=t[n*3+e],i=t[n*3+(e+1)%3];f[d[r]+p[r]++]=i,f[d[i]+p[i]++]=r}}let h=new Int32Array(a).fill(-2),g=new Uint32Array(a),_=new Int32Array(a).fill(-1),v=0,y=0;for(let e=0;e<a;e++)if(h[e]===-2&&C[e]===0)for(h[e]=-1,g[y++]=e;v<y;){let e=g[v++];for(let t=d[e];t<d[e+1];t++){let n=f[t];h[n]===-2&&(h[n]=e,g[y++]=n)}}for(let t=0;t<y;t++){let n=g[t],a=m[n*3],c=m[n*3+1],u=m[n*3+2],d=0,f=1/0;if(h[n]<0)for(let t=0;t<i;t++){let n=e[t*3]-a,r=e[t*3+1]-c,i=e[t*3+2]-u,o=n*n+r*r+i*i;o<f&&(f=o,d=t)}else d=_[h[n]],f=(e[d*3]-a)**2+(e[d*3+1]-c)**2+(e[d*3+2]-u)**2;for(let t=0;t<64;t++){let t=d;for(let n=o.vtStart[d];n<o.vtStart[d+1];n++){let i=o.vtList[n];for(let n=0;n<3;n++){let o=r[i*3+n],s=(e[o*3]-a)**2+(e[o*3+1]-c)**2+(e[o*3+2]-u)**2;s<f&&(f=s,t=o)}}if(t===d)break;d=t}if(_[n]=d,C[n]!==0)continue;let p=1/0,v=-1;for(let t=o.vtStart[d];t<o.vtStart[d+1];t++){let n=o.vtList[t],i=Pl(e,r[n*3]*3,r[n*3+1]*3,r[n*3+2]*3,a,c,u,l);i<p&&(p=i,v=n,s[0]=l[0],s[1]=l[1],s[2]=l[2])}if(p<1/0){I[n*3]=s[0]-a,I[n*3+1]=s[1]-c,I[n*3+2]=s[2]-u;let t=r[v*3]*3,i=r[v*3+1]*3,l=r[v*3+2]*3,d=e[i]-e[t],f=e[i+1]-e[t+1],p=e[i+2]-e[t+2],m=e[l]-e[t],h=e[l+1]-e[t+1],g=e[l+2]-e[t+2],_=s[0]-e[t],y=s[1]-e[t+1],b=s[2]-e[t+2],x=d*d+f*f+p*p,S=d*m+f*h+p*g,C=m*m+h*h+g*g,w=_*d+y*f+b*p,T=_*m+y*h+b*g,E=x*C-S*S,D=E>1e-30?(C*w-S*T)/E:0,O=E>1e-30?(x*T-S*w)/E:0,k=1-D-O,A=o.wN,j=k*A[t]+D*A[i]+O*A[l],M=k*A[t+1]+D*A[i+1]+O*A[l+1],N=k*A[t+2]+D*A[i+2]+O*A[l+2],P=Math.sqrt(j*j+M*M+N*N)||1;j/=P,M/=P,N/=P,L[n*3]=j,L[n*3+1]=M,L[n*3+2]=N}}}let ee=new Float32Array(a*3);{let n=e instanceof Float32Array?e:Float32Array.from(e),r=t instanceof Uint32Array?t:Uint32Array.from(t),i=new Float32Array(a*3),o=new Float32Array(a*3);El(n,r,x[c],i),Dl(i,r,x[c],o,.7),Dl(i,r,x[c],o,.5);for(let e=0;e<a;e++)C[e]!==0||L[e*3]===0&&L[e*3+1]===0&&L[e*3+2]===0||(ee[e*3]=L[e*3]-i[e*3],ee[e*3+1]=L[e*3+1]-i[e*3+1],ee[e*3+2]=L[e*3+2]-i[e*3+2])}let te=performance.now(),ne=o*((r+1)*(r+2)/2),re=o*r*r*3,R=new Uint32Array(ne),ie=new Uint32Array(ne),z=new Uint32Array(ne),B=new Float32Array(ne*3),ae=new Float32Array(ne*2),oe=new Float32Array(ne*3),V=new Float32Array(ne),se=new Float32Array(ne*3),ce=new Int32Array(ne).fill(-1),le=new Uint32Array(re),ue=new Uint32Array(y+1),de=[],H=new Int32Array((r+1)*(r+1)),fe=0,pe=0,me=1/l;for(let e=0;e<y;e++){ue[e]=fe;let n=e===c,i=x[e],o=new Map;for(let s=0;s<i.length;s++){let l=i[s],u=t[l*3],d=t[l*3+1],f=t[l*3+2],p=n?0:Math.max(Math.hypot(m[u*3]-m[d*3],m[u*3+1]-m[d*3+1],m[u*3+2]-m[d*3+2]),Math.hypot(m[d*3]-m[f*3],m[d*3+1]-m[f*3+1],m[d*3+2]-m[f*3+2]),Math.hypot(m[f*3]-m[u*3],m[f*3+1]-m[u*3+1],m[f*3+2]-m[u*3+2]));for(let t=0;t<=r;t++)for(let i=0;i<=r-t;i++){let s=r-t-i,l=-1;if(s===r)l=u;else if(t===r)l=d;else if(i===r)l=f;else if(i===0||s===0||t===0){let e,n,o;i===0?(e=u,n=d,o=t):s===0?(e=d,n=f,o=i):(e=f,n=u,o=s);let c=e<n?e:n,p=e<n?n:e,m=e<n?o:r-o;l=a+(c*a+p)*(r+1)+m}let h=l>=0?o.get(l):void 0;if(h===void 0){h=fe++,l>=0&&o.set(l,h);let a=s/r,g=t/r,_=i/r;R[h]=u*3,ie[h]=d*3,z[h]=f*3,B[h*3]=a,B[h*3+1]=g,B[h*3+2]=_;let v=a*m[u*3]+g*m[d*3]+_*m[f*3],y=a*m[u*3+1]+g*m[d*3+1]+_*m[f*3+1],b=a*m[u*3+2]+g*m[d*3+2]+_*m[f*3+2];oe[h*3]=v*me,oe[h*3+1]=y*me,oe[h*3+2]=b*me;let x=n?a*I[u*3]+g*I[d*3]+_*I[f*3]:0,S=n?a*I[u*3+1]+g*I[d*3+1]+_*I[f*3+1]:0,C=n?a*I[u*3+2]+g*I[d*3+2]+_*I[f*3+2]:0,w=v+x-N,T=y+S-P,E=b+C-F,O=Math.sqrt(w*w+T*T+E*E)||1;if(se[h*3]=w/O,se[h*3+1]=T/O,se[h*3+2]=E/O,!n){ae[h*2]=e+1;{let t=A[e],n=Math.min(t[u],t[d],t[f]);ae[h*2+1]=n-p>=D?0:k(e,v,y,b)}V[h]=j(e,v,y,b)*me}else if(l>=0)for(let e=0;e<c;e++){let t=de[e]?.get(l);if(t!==void 0){ce[h]=t;break}}}H[t*(r+1)+i]=h}for(let e=0;e<r;e++)for(let t=0;t<r-e;t++)le[pe++]=H[e*(r+1)+t],le[pe++]=H[(e+1)*(r+1)+t],le[pe++]=H[e*(r+1)+t+1],t<r-e-1&&(le[pe++]=H[(e+1)*(r+1)+t],le[pe++]=H[(e+1)*(r+1)+t+1],le[pe++]=H[e*(r+1)+t+1])}n||de.push(o)}ue[y]=fe;{let e=performance.now();w-i,M-w,te-M,e-te}let he=[];for(let e=0;e<c;e++)he.push(x[e]);return{n:r,count:fe,vA:R.slice(0,fe),vB:ie.slice(0,fe),vC:z.slice(0,fe),bw:B.slice(0,fe*3),indices:le.slice(0,pe),normDelta:ee,aCap:ae.slice(0,fe*2),aCapP:oe.slice(0,fe*3),aCapD:V.slice(0,fe),aRest:se.slice(0,fe*3),twin:ce.slice(0,fe),classStart:ue,planes:s,capTris:he,skinTris:x[c],vSrc:C,simCls:g,rimClean:_===0,degraded:v,unclean:_}}var Il={blending:5,blendEquation:100,blendSrc:201,blendDst:201,blendEquationAlpha:100,blendSrcAlpha:200,blendDstAlpha:201},Ll=`
varying vec2 vP;
varying float vWY;
uniform vec3 uCenter;
uniform float uSize;
void main() {
  vP = position.xy;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = uCenter + (right * position.x + up * position.y) * uSize;
  vWY = wp.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`,Rl=`
varying vec2 vP;
varying float vWY;
uniform vec3 uColor;
uniform float uStrength;
uniform float uRing;       // 0 = solid glow, 1 = a soft ring hugging the silhouette
uniform float uFadeH;      // height above the table over which the sprite fades in
void main() {
  float r = length(vP);
  float solid = exp(-r * r * 5.0) * (1.0 - smoothstep(0.55, 1.0, r));
  float ring = exp(-pow((r - 0.62) * 8.0, 2.0)) * (1.0 - smoothstep(0.72, 0.9, r));
  float a = mix(solid, ring, uRing) * uStrength * smoothstep(0.0, uFadeH, vWY);
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,zl=class{mesh;center=new X;geo=new Ii(2,2);mat;constructor(e={}){this.mat=new qi({vertexShader:Ll,fragmentShader:Rl,fog:!1,uniforms:{uCenter:{value:this.center},uSize:{value:1},uColor:{value:new Q(1,.6,.3)},uStrength:{value:0},uRing:{value:e.ring??0},uFadeH:{value:e.fadeH??.2}},transparent:!1,depthWrite:!1,depthTest:!0,...Il}),this.mesh=new ai(this.geo,this.mat),this.mesh.frustumCulled=!1,this.mesh.renderOrder=e.renderOrder??-19}set(e,t,n,r,i){this.center.set(e,t,n),this.mat.uniforms.uSize.value=r,this.mat.uniforms.uStrength.value=i,this.mesh.visible=i>.002}setColor(e,t,n){this.mat.uniforms.uColor.value.setRGB(e,t,n,We)}setRing(e){this.mat.uniforms.uRing.value=e}dispose(){this.geo.dispose(),this.mat.dispose()}},Bl=`
float whHash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float whHash31(vec3 p) {
  vec3 p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 whHash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float whNoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(whHash21(i), whHash21(i + vec2(1.0, 0.0)), f.x),
             mix(whHash21(i + vec2(0.0, 1.0)), whHash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float whNoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(whHash31(i), whHash31(i + vec3(1, 0, 0)), f.x), mix(whHash31(i + vec3(0, 1, 0)), whHash31(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(whHash31(i + vec3(0, 0, 1)), whHash31(i + vec3(1, 0, 1)), f.x), mix(whHash31(i + vec3(0, 1, 1)), whHash31(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
`,Vl=[1,.45,.12],Hl=`
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
#include <clipping_planes_pars_vertex>
void main() {
  vL = position;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}
`,Ul=`
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uIntensity;
uniform float uTime;
uniform float uPrism;
#include <clipping_planes_pars_fragment>
${Bl}
void main() {
  #include <clipping_planes_fragment>
  float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float hot = pow(ndv, 2.4);
  float mott = 0.84 + 0.3 * whNoise3(vL * 2.6 + vec3(0.0, uTime * 0.35, uTime * 0.2));
  float soft = smoothstep(0.0, 0.8, ndv);   // additive and fading to nothing at its rim: a glow seen through the jelly, never a disc
  vec3 base = mix(uColor, uHot, 0.3 * hot * hot);
  vec3 spec = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + (1.0 - ndv) * 1.3 + uTime * 0.05));
  base = mix(base, spec * (0.6 + 0.8 * hot), uPrism);
  // soft knee: a bright core gets brighter (and brighter still when squeezed) but saturates in its own hue, never into a white blob
  float e = (0.5 + 0.7 * hot) * mott * uIntensity * soft * 0.7;
  vec3 c = base * (1.8 * e / (1.8 + e));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,Wl={pieceFloor:.35},Gl=()=>new Cr(new X(0,0,0),1e6),Kl=class{group=new mn;center=new X;amount=1;boost=0;offset=new X;kept=1;minKept=.002;hidden=!1;manyFaces=!1;setHidden(e){e!==this.hidden&&(this.hidden=e,e||(this.blob.visible=!this.lite))}cut=!1;cells=[];clipCaps=[];clipPlanes=[Gl(),Gl()];vOff=new X;qOff=new gt;amtK=1;blob;halo;blobMat;blobGeo=new Li(1,28,18);radius;glow;style;palette;comp=0;lite=!1;calm=!1;sizeMul=1;baseCol=new Q;baseHot=new Q;baseHalo=new Q;tintTmp=new Q;constructor(e,t,n,r){this.radius=.17*n,this.glow=e.coreGlow,this.style=r,this.palette=t;let i=new Q,a=new Q;this.blobMat=new qi({vertexShader:Hl,fragmentShader:Ul,fog:!1,...Il,depthWrite:!1,transparent:!1,clipping:!0,uniforms:{uColor:{value:i},uHot:{value:a},uIntensity:{value:2},uTime:{value:0},uPrism:{value:r.corePrism}}}),this.halo=new zl({renderOrder:-19,fadeH:.2*n}),this.halo.setColor(t.core[0],t.core[1],t.core[2]),this.blobMat.clippingPlanes=this.clipPlanes,this.blob=new ai(this.blobGeo,this.blobMat),this.blob.renderOrder=-20,this.blob.frustumCulled=!1,this.group.add(this.blob,this.halo.mesh),this.setStyle(r)}setPiece(e){this.cut=Al(e),this.cells=this.cut?e.cells[0].slice(0,8):[],this.cut?this.offset.set(e.offset.x,e.offset.y,e.offset.z):this.offset.set(0,0,0),this.recomputeKept()}recomputeKept(){if(this.clipCaps=[],this.kept=1,this.manyFaces=!1,!this.cut)return;let e=this.radius*this.style.coreSize,t=[];for(let n=0;n<this.cells.length;n++){let r=this.cells[n].d;r>=e||(this.kept*=r<=-e?0:1-(e-r)*(e-r)*(2*e+r)/(4*e*e*e),t.push({k:n,s:r}))}t.sort((e,t)=>e.s-t.s),this.clipCaps=t.slice(0,2).map(e=>e.k),this.manyFaces=t.length>2}setStyle(e){this.style=e;let t=this.palette,n=this.blobMat.uniforms.uColor.value,r=this.blobMat.uniforms.uHot.value;n.setRGB(t.core[0],t.core[1],t.core[2],We),r.setRGB(t.coreHot[0],t.coreHot[1],t.coreHot[2],We);let i=e.coreWarm*s(Vl,t);i>0&&(n.lerp(new Q(1,.45,.12),i),r.lerp(new Q(1,.8,.5),i));let a=e.tell,o=e.coreTint*s(a,t);if(o>0){let e=new Q().setRGB(a[0],a[1],a[2],We);n.lerp(e,o),r.lerp(e.clone().lerp(new Q(1,1,1),.35),o)}let c=e.corePrism>0?.4:0,l=t.core[0]+(a[0]-t.core[0])*o,u=t.core[1]+(a[1]-t.core[1])*o,d=t.core[2]+(a[2]-t.core[2])*o;this.halo.setColor(l*(1-c)+c*.9,u*(1-c)+c*.9,d*(1-c)+c),this.baseHalo.setRGB(l*(1-c)+c*.9,u*(1-c)+c*.9,d*(1-c)+c,We),this.baseCol.copy(n),this.baseHot.copy(r),this.blobMat.uniforms.uPrism.value=e.corePrism,this.recomputeKept()}tint(e,t,n,r){let i=this.blobMat.uniforms.uColor.value,a=this.blobMat.uniforms.uHot.value,o=this.tintTmp;o.setRGB(e,t,n,We),i.copy(this.baseCol).lerp(o,r),a.copy(this.baseHot).lerp(o,r*.8);let s=this.baseHalo;this.halo.setColor(s.r+(e-s.r)*r,s.g+(t-s.g)*r,s.b+(n-s.b)*r)}setLite(e){this.lite=e,this.blob.visible=!e}update(e,t,n,r,i){let a=e.center,o=e.frame,s=this.style,c=a;if(this.cut){this.vOff.set(-this.offset.x,-this.offset.y,-this.offset.z).applyQuaternion(this.qOff.set(o.x,o.y,o.z,o.w)),c={x:a.x+this.vOff.x,y:a.y+this.vOff.y,z:a.z+this.vOff.z};for(let e=0;e<2;e++){let t=this.clipPlanes[e],n=e<this.clipCaps.length?this.clipCaps[e]:-1,r=n>=0&&i?i[n]:void 0;r&&r.live?(t.normal.set(-r.nx,-r.ny,-r.nz),t.constant=r.d):(t.normal.set(0,0,0),t.constant=1e6)}this.blob.visible=!this.lite&&this.kept>this.minKept&&!this.manyFaces,this.amtK+=(Math.max(this.kept,Wl.pieceFloor)-this.amtK)*(1-Math.exp(-t/.25))}this.center.set(c.x,c.y,c.z),this.comp+=(r-this.comp)*(1-Math.exp(-t*12));let l=this.comp,u=1-.42*l,d=1+.2*l,f=this.radius*s.coreSize*this.sizeMul;this.blob.position.set(c.x,c.y,c.z),this.blob.quaternion.set(o.x,o.y,o.z,o.w),this.blob.scale.set(f*d,f*u,f*d);let p=this.calm?1:1+s.corePulseAmp*Math.sin(n*Math.PI*2*s.corePulseHz),m=1+this.boost;this.amount=(1.2+.9*this.glow)*s.coreMul*(1+1.5*l)*p*m*(this.cut?this.amtK:1),this.blobMat.uniforms.uIntensity.value=(1+1.2*this.glow)*s.coreMul*(1+1.4*l)*p*m,this.blobMat.uniforms.uTime.value=n;let h=(.28+.4*this.glow)*s.haloMul*(1+.7*l)*(this.lite?.85:1)*p*m*(this.cut?this.kept:1);this.halo.set(c.x,c.y,c.z,f*(3.4+.3*l)*s.haloSize,h<.5?h:.5+(h-.5)/(1+(h-.5)/.4)),this.hidden&&(this.blob.visible=!1,this.halo.mesh.visible=!1)}dispose(){this.blobGeo.dispose(),this.blobMat.dispose(),this.halo.dispose()}},ql=`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`,Jl=`
varying vec2 vUv;
uniform float uStrength;
uniform float uSoft;   // 1 = tight contact shadow, 0 = very soft
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  float rr = sqrt(r2);
  float tight = exp(-pow(rr / mix(0.55, 0.8, uSoft), 4.0)) * 0.85;     // dense contact shadow that ends just outside the body
  float wide = exp(-r2 * mix(1.6, 3.2, uSoft)) * 0.3;
  float edge = 1.0 - smoothstep(0.7, 1.0, rr);
  float a = clamp((tight + wide) * uStrength * edge, 0.0, 0.92);
  gl_FragColor = vec4(0.012, 0.004, 0.035, a);
}
`,Yl=`
varying vec2 vUv;
uniform vec3 uColor;
uniform vec3 uRingCol;     // the caustic ring takes the TIER colour (it is part of the tell), not the body's pool colour
uniform float uStrength;
uniform float uTime;
uniform float uRing;       // soft caustic fringe just outside the shadow edge
uniform float uRing2;      // thin bright caustic ring (Epic and up)
${Bl}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float body = exp(-r * r * 5.0);
  float fringe = exp(-pow((r - 0.62) * 4.2, 2.0)) * uRing;
  float cau = 0.8 + 0.4 * whNoise2(p * 7.0 + vec2(uTime * 0.25, -uTime * 0.18));
  float edge = 1.0 - smoothstep(0.78, 1.0, r);
  // caustic ring (Epic and up): a broken, beaded band of focused light, two thin crossing filaments that slowly crawl, not a neon hoop
  float ring2 = 0.0;
  if (uRing2 > 0.001) {
    // the beads' noise runs around the ring on a CIRCLE in noise space (the unit direction, turned a little by the time), not on the polar angle: atan() jumps by 2 pi
    // where it wraps (the -x axis), and noise of a non-multiple of that jump is a hard straight line across the ring there (VERIFY_RENDER_A R-A6)
    vec2 dir = p / max(r, 1e-3);
    float a1 = uTime * 0.022, a2 = -uTime * 0.0078;
    vec2 d1 = vec2(cos(a1) * dir.x - sin(a1) * dir.y, sin(a1) * dir.x + cos(a1) * dir.y);
    vec2 d2 = vec2(cos(a2) * dir.x - sin(a2) * dir.y, sin(a2) * dir.x + cos(a2) * dir.y);
    float n1 = whNoise2(d1 * 5.0 + vec2(r * 4.0, 0.0));
    float n2 = whNoise2(d2 * 9.0 + vec2(r * 6.0 + 3.7, 11.0));
    float beads = pow(clamp(n1 * 0.6 + n2 * 0.6 - 0.15, 0.0, 1.0), 2.0) * 2.2;
    float f1 = exp(-pow((r - 0.79 - 0.025 * (n2 - 0.5)) * 30.0, 2.0));
    float f2 = exp(-pow((r - 0.83 + 0.03 * (n1 - 0.5)) * 38.0, 2.0));
    float glow = exp(-pow((r - 0.81) * 9.0, 2.0)) * 0.22;
    ring2 = ((f1 + 0.7 * f2) * (0.25 + beads) + glow) * uRing2 * (1.0 - smoothstep(0.9, 1.0, r));
  }
  float a = (body * 0.8 + fringe * 0.28) * cau * edge * uStrength;
  gl_FragColor = vec4(uColor * a + uRingCol * ring2 * 0.42, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;function Xl(){let e=new Ii(2,2);return e.rotateX(-Math.PI/2),e}var Zl=class{shadow;pool;shadowMat;poolMat;poolK=1;poolFresh=!0;alphaMul=1;wanted=!0;lodK=1;constructor(e){this.shadowMat=new qi({vertexShader:ql,fragmentShader:Jl,uniforms:{uStrength:{value:1},uSoft:{value:1}},transparent:!1,depthWrite:!1,depthTest:!0,toneMapped:!1,fog:!1,blending:5,blendEquation:100,blendSrc:204,blendDst:205,blendEquationAlpha:100,blendSrcAlpha:200,blendDstAlpha:201,polygonOffset:!0,polygonOffsetFactor:-1,polygonOffsetUnits:-1}),this.shadow=new ai(e,this.shadowMat),this.shadow.renderOrder=-40,this.shadow.position.y=.002,this.shadow.frustumCulled=!1,this.poolMat=new qi({vertexShader:ql,fragmentShader:Yl,uniforms:{uColor:{value:new Q(1,.6,.3)},uRingCol:{value:new Q(1,.6,.3)},uStrength:{value:1},uTime:{value:0},uRing:{value:1},uRing2:{value:0}},transparent:!1,depthWrite:!1,depthTest:!0,...Il,fog:!1,polygonOffset:!0,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),this.pool=new ai(e,this.poolMat),this.pool.renderOrder=-39,this.pool.position.y=.003,this.pool.frustumCulled=!1}setColor(e){this.setColorRGB(e[0],e[1],e[2])}setColorRGB(e,t,n){this.poolMat.uniforms.uColor.value.setRGB(e,t,n,We)}setRingColor(e){this.poolMat.uniforms.uRingCol.value.setRGB(e[0],e[1],e[2],We)}setVisible(e){this.shadow.visible=e,this.pool.visible=e}update(e,t,n,r,i,a,o=0){if(this.wanted?this.lodK+=(1-this.lodK)*(1-Math.exp(-e*8)):this.lodK-=this.lodK*(1-Math.exp(-e*8)),this.lodK<.01&&!this.wanted){this.lodK=0,this.setVisible(!1);return}this.setVisible(!0),this.poolMat.uniforms.uTime.value=t;let s=Math.max(0,n.lowY),c=1/(1+s*1.6),l=r,u=1.3+.5*l+.45*s;this.shadow.position.set(n.cx,.002,n.cz);let d=Math.max(n.rx,n.rz)>=.2?1:Math.max(.2,Math.max(n.rx,n.rz)/.2);this.shadow.scale.set(n.rx*u+.05*d,1,n.rz*u+.05*d);let f=this.alphaMul*this.lodK;this.shadowMat.uniforms.uStrength.value=(.95-.38*l)*c*f,this.shadowMat.uniforms.uSoft.value=Math.max(0,1-.75*l-.5*Math.min(1,s*1.5));let p=Math.min(1,n.compression*1.2+n.stretch*.15),m=(1.2+.4*p+.2*s)*(1-.1*l)*(1+.12*(i?.ring??0)),h=.3+.55*p;this.poolFresh?(this.poolK=h,this.poolFresh=!1):this.poolK+=(h-this.poolK)*(1-Math.exp(-e*10)),this.pool.position.set(n.cx,.003,n.cz);let g=n.room===void 0?1/0:Math.max(.2,n.room*.85);this.pool.scale.set(Math.min(n.rx*m+.1*d,g),1,Math.min(n.rz*m+.1*d,g));let _=i?i.poolMul:1;this.poolMat.uniforms.uStrength.value=(this.poolK*_+o)*(1-.5*l)*(.85/(1+s*.9))*f,this.poolMat.uniforms.uRing.value=(1-.55*l)*(i?.5+.5*Math.min(1,i.index/2):1);let v=i?i.ring:0;v>0&&i&&i.ringPulseHz>0&&!a&&(v*=.72+.28*Math.sin(t*Math.PI*2*i.ringPulseHz)),this.poolMat.uniforms.uRing2.value=v*(1-.6*l)/(1+s*1.2)}dispose(){this.shadowMat.dispose(),this.poolMat.dispose()}},Ql=(1+Math.sqrt(5))/2,$l=[[-1,Ql,0],[1,Ql,0],[-1,-Ql,0],[1,-Ql,0],[0,-1,Ql],[0,1,Ql],[0,-1,-Ql],[0,1,-Ql],[Ql,0,-1],[Ql,0,1],[-Ql,0,-1],[-Ql,0,1]],eu=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];function tu(e){let t=Math.max(1,Math.min(48,Math.floor(e))),n=[],r=new Map,i=2e4,a=(e,t,n)=>{let r=Math.round(e*i)+i,a=Math.round(t*i)+i,o=Math.round(n*i)+i;return(r*40001+a)*40001+o},o=(e,t,i)=>{let o=Math.hypot(e,t,i);e/=o,t/=o,i/=o;let s=a(e,t,i),c=r.get(s);if(c!==void 0)return c;let l=n.length/3;return n.push(e,t,i),r.set(s,l),l},s=[],c=new Int32Array((t+1)*(t+1));for(let e of eu){let n=$l[e[0]],r=$l[e[1]],i=$l[e[2]],a=r[0]-n[0],l=r[1]-n[1],u=r[2]-n[2],d=i[0]-n[0],f=i[1]-n[1],p=i[2]-n[2],m=l*p-u*f,h=u*d-a*p,g=a*f-l*d;if(m*(n[0]+r[0]+i[0])+h*(n[1]+r[1]+i[1])+g*(n[2]+r[2]+i[2])<0){let e=r;r=i,i=e}for(let e=0;e<=t;e++)for(let a=0;e+a<=t;a++){let s=t-e-a;c[e*(t+1)+a]=o((n[0]*s+r[0]*e+i[0]*a)/t,(n[1]*s+r[1]*e+i[1]*a)/t,(n[2]*s+r[2]*e+i[2]*a)/t)}for(let e=0;e<t;e++)for(let n=0;e+n<t;n++){let r=c[e*(t+1)+n],i=c[(e+1)*(t+1)+n],a=c[e*(t+1)+n+1];if(s.push(r,i,a),e+n<t-1){let r=c[(e+1)*(t+1)+n+1];s.push(i,r,a)}}}let l=n.length/3,u=l<65536?Uint16Array.from(s):Uint32Array.from(s);return{vertexCount:l,dirs:Float32Array.from(n),indices:u}}var nu=class{n;idx;rest;dirs;cx;cy;cz;vtStart;vtList;seen;stamp=0;cand;constructor(e){this.n=e.vertexCount,this.idx=e.indices,this.rest=e.restLocal;let t=this.n,n=this.idx.length/3,r=0,i=0,a=0;for(let e=0;e<t;e++)r+=this.rest[e*3],i+=this.rest[e*3+1],a+=this.rest[e*3+2];this.cx=r/t,this.cy=i/t,this.cz=a/t,this.dirs=new Float32Array(t*3);for(let e=0;e<t;e++){let t=this.rest[e*3]-this.cx,n=this.rest[e*3+1]-this.cy,r=this.rest[e*3+2]-this.cz,i=Math.hypot(t,n,r)||1;this.dirs[e*3]=t/i,this.dirs[e*3+1]=n/i,this.dirs[e*3+2]=r/i}this.vtStart=new Uint32Array(t+1);for(let e=0;e<n*3;e++)this.vtStart[this.idx[e]+1]++;for(let e=0;e<t;e++)this.vtStart[e+1]+=this.vtStart[e];this.vtList=new Uint32Array(n*3);let o=new Uint32Array(t);for(let e=0;e<n;e++)for(let t=0;t<3;t++){let n=this.idx[e*3+t];this.vtList[this.vtStart[n]+o[n]++]=e}this.seen=new Int32Array(n),this.cand=new Int32Array(Math.min(n,256))}locate(e,t,n,r){let i=Math.hypot(e,t,n)||1;e/=i,t/=i,n/=i;let a=this.dirs,o=this.n,s=0,c=-2;for(let r=0;r<o;r++){let i=a[r*3]*e+a[r*3+1]*t+a[r*3+2]*n;i>c&&(c=i,s=r)}let l=++this.stamp,u=this.seen,d=this.cand,f=this.vtStart,p=this.vtList,m=this.idx,h=0;for(let e=f[s];e<f[s+1];e++){let t=p[e];for(let e=0;e<3;e++){let n=m[t*3+e];for(let e=f[n];e<f[n+1];e++){let t=p[e];u[t]!==l&&h<d.length&&(u[t]=l,d[h++]=t)}}}let g=this.rest,_=this.cx,v=this.cy,y=this.cz,b=-1,x=1e9,S=0,C=0;for(let r=0;r<h;r++){let i=d[r],a=m[i*3]*3,o=m[i*3+1]*3,s=m[i*3+2]*3,c=g[a],l=g[a+1],u=g[a+2],f=g[o]-c,p=g[o+1]-l,h=g[o+2]-u,w=g[s]-c,T=g[s+1]-l,E=g[s+2]-u,D=t*E-n*T,O=n*w-e*E,k=e*T-t*w,A=f*D+p*O+h*k;if(Math.abs(A)<1e-14)continue;let j=1/A,M=_-c,N=v-l,P=y-u,F=(M*D+N*O+P*k)*j,I=N*h-P*p,L=P*f-M*h,ee=M*p-N*f,te=(e*I+t*L+n*ee)*j;if((w*I+T*L+E*ee)*j<=0)continue;let ne=1-F-te,re=Math.max(0,-ne,-F,-te);if(re<x&&(x=re,b=i,S=F,C=te,re<=1e-6))break}b<0&&(b=p[f[s]],S=1/3,C=1/3);let w=Math.max(0,1-S-C),T=Math.max(0,S),E=Math.max(0,C),D=w+T+E||1;return r.tri=b,r.u=w/D,r.v=T/D,r.w=E/D,r}};function ru(e,t,n,r,i,a,o,s,c,l,u,d,f){let p=e[n],m=e[n+1],h=e[n+2],g=e[r],_=e[r+1],v=e[r+2],y=e[i],b=e[i+1],x=e[i+2],S=t[n],C=t[n+1],w=t[n+2],T=t[r],E=t[r+1],D=t[r+2],O=t[i],k=t[i+1],A=t[i+2],j=a*p+o*g+s*y,M=a*m+o*_+s*b,N=a*h+o*v+s*x,P=(j-p)*S+(M-m)*C+(N-h)*w,F=(j-g)*T+(M-_)*E+(N-v)*D,I=(j-y)*O+(M-b)*k+(N-x)*A,L=a*P,ee=o*F,te=s*I;l[u]=j-c*(L*S+ee*T+te*O),l[u+1]=M-c*(L*C+ee*E+te*k),l[u+2]=N-c*(L*w+ee*D+te*A);let ne=a*S+o*T+s*O,re=a*C+o*E+s*k,R=a*w+o*D+s*A,ie=1/(Math.sqrt(ne*ne+re*re+R*R)||1);d[f]=ne*ie,d[f+1]=re*ie,d[f+2]=R*ie}function iu(e,t,n,r,i,a,o,s,c,l,u){let d=a[o],f=a[o+1],p=a[o+2],m=e[n],h=e[n+1],g=e[n+2],_=e[r],v=e[r+1],y=e[r+2],b=e[i],x=e[i+1],S=e[i+2],C=t[n],w=t[n+1],T=t[n+2],E=t[r],D=t[r+1],O=t[r+2],k=t[i],A=t[i+1],j=t[i+2],M=d*m+f*_+p*b,N=d*h+f*v+p*x,P=d*g+f*y+p*S,F=(M-m)*C+(N-h)*w+(P-g)*T,I=(M-_)*E+(N-v)*D+(P-y)*O,L=(M-b)*k+(N-x)*A+(P-S)*j,ee=d*F,te=f*I,ne=p*L;s[c]=M-au*(ee*C+te*E+ne*k),s[c+1]=N-au*(ee*w+te*D+ne*A),s[c+2]=P-au*(ee*T+te*O+ne*j);let re=d*C+f*E+p*k,R=d*w+f*D+p*A,ie=d*T+f*O+p*j,z=1/(Math.sqrt(re*re+R*R+ie*ie)||1);l[u]=re*z,l[u+1]=R*z,l[u+2]=ie*z}var au=.7,ou=new Float32Array;function su(e){return ou.length<e&&(ou=new Float32Array(e)),ou}var cu=class{mesh;mapper;pb=null;pieceRef;caps=[];rimClean=!0;degraded=!1;capN=[];pieceRadius=.5;simN;nAcc;simD;press=0;pull=0;minX=0;maxX=0;minY=0;maxY=0;minZ=0;maxZ=0;fineCount=0;freq=0;effFreq=0;builtFrac=1;body;geo;vA=new Uint32Array;vB=new Uint32Array;vC=new Uint32Array;bw=new Float32Array;pos=new Float32Array;nrm=new Float32Array;strain=new Float32Array;disp=new Float32Array;posAttr;nrmAttr;strAttr;dispAttr;constructor(e,t,n){this.body=e,this.mapper=new nu(e),this.simN=new Float32Array(e.vertexCount*3),this.nAcc=new Float32Array(e.vertexCount*3),this.simD=new Float32Array(e.vertexCount*2),this.geo=new gr,this.mesh=new ai(this.geo,t),this.mesh.frustumCulled=!1,this.rebuild(n)}rebuild(e){let t=this.body.piece;if(Al(t)){this.rebuildPiece(e,t);return}this.pb=null,this.pieceRef=t,this.caps.length=0,this.rimClean=!0,this.degraded=!1;let n=this.body.frac;this.builtFrac=typeof n==`number`&&Number.isFinite(n)&&n>0?n:1,this.effFreq=Cl(e,this.body.vertexCount,this.builtFrac);let r=tu(this.effFreq),i=r.vertexCount,a={tri:0,u:0,v:0,w:0},o=this.body.indices;this.vA=new Uint32Array(i),this.vB=new Uint32Array(i),this.vC=new Uint32Array(i),this.bw=new Float32Array(i*3);for(let e=0;e<i;e++)this.mapper.locate(r.dirs[e*3],r.dirs[e*3+1],r.dirs[e*3+2],a),this.vA[e]=o[a.tri*3]*3,this.vB[e]=o[a.tri*3+1]*3,this.vC[e]=o[a.tri*3+2]*3,this.bw[e*3]=a.u,this.bw[e*3+1]=a.v,this.bw[e*3+2]=a.w;this.pos=new Float32Array(i*3),this.nrm=new Float32Array(i*3),this.strain=new Float32Array(i),this.disp=new Float32Array(i*2);let s=this.geo,c=new gr;this.posAttr=new tr(this.pos,3).setUsage(Ye),this.nrmAttr=new tr(this.nrm,3).setUsage(Ye),this.strAttr=new tr(this.strain,1).setUsage(Ye),c.setAttribute(`position`,this.posAttr),c.setAttribute(`normal`,this.nrmAttr),this.dispAttr=new tr(this.disp,2).setUsage(Ye),c.setAttribute(`aStrain`,this.strAttr),c.setAttribute(`aDisp`,this.dispAttr),c.setAttribute(`aRest`,new tr(r.dirs,3)),c.setAttribute(`aCap`,new tr(su(i*2),2)),c.setAttribute(`aCapP`,new tr(su(i*3),3)),c.setAttribute(`aCapD`,new tr(su(i),1)),c.setIndex(new tr(r.indices,1)),c.boundingSphere=new cr(new X,1e4),this.geo=c,this.mesh.geometry=c,s.dispose(),this.fineCount=i,this.freq=Math.floor(e),this.update()}rebuildPiece(e,t){let n=this.body,r=n.indices.length/3|0,i=typeof n.frac==`number`&&Number.isFinite(n.frac)&&n.frac>0?n.frac:.5,a=Fl(n.restLocal,n.indices,t,kl(e,i,r));this.pb=a,this.pieceRef=t,this.rimClean=a.rimClean,this.degraded=a.degraded,this.pieceRadius=t.whole.radius>0?t.whole.radius:.5;let o=a.count,s=a.planes.length,c=n.vertexCount;this.vA=a.vA,this.vB=a.vB,this.vC=a.vC,this.bw=a.bw,this.pos=new Float32Array(o*3),this.nrm=new Float32Array(o*3),this.strain=new Float32Array(o),this.disp=new Float32Array(o*2),this.capN=[];for(let e=0;e<s;e++)this.capN.push(new Float32Array(c*3));this.caps.length=0;for(let e=0;e<s;e++)this.caps.push({id:a.planes[e].id,live:!1,cx:0,cy:0,cz:0,nx:0,ny:1,nz:0,d:0,area:0});let l=this.geo,u=new gr;this.posAttr=new tr(this.pos,3).setUsage(Ye),this.nrmAttr=new tr(this.nrm,3).setUsage(Ye),this.strAttr=new tr(this.strain,1).setUsage(Ye),this.dispAttr=new tr(this.disp,2).setUsage(Ye),u.setAttribute(`position`,this.posAttr),u.setAttribute(`normal`,this.nrmAttr),u.setAttribute(`aStrain`,this.strAttr),u.setAttribute(`aDisp`,this.dispAttr),u.setAttribute(`aRest`,new tr(a.aRest,3)),u.setAttribute(`aCap`,new tr(a.aCap,2)),u.setAttribute(`aCapP`,new tr(a.aCapP,3)),u.setAttribute(`aCapD`,new tr(a.aCapD,1)),u.setIndex(new tr(a.indices,1)),u.boundingSphere=new cr(new X,1e4),this.geo=u,this.mesh.geometry=u,l.dispose(),this.fineCount=o,this.freq=Math.floor(e),this.update()}updatePiece(){let e=this.body,t=this.pb,n=e.positions,r=e.strain,i=e.indices,a=this.simN,o=t.planes.length;El(n,i,t.skinTris,a),Dl(a,i,t.skinTris,this.nAcc,.7),Dl(a,i,t.skinTris,this.nAcc,.5);{let n=e.frame,r=t.normDelta,i=t.vSrc,o=n.x,s=n.y,c=n.z,l=n.w,u=1-2*(s*s+c*c),d=2*(o*s-c*l),f=2*(o*c+s*l),p=2*(o*s+c*l),m=1-2*(o*o+c*c),h=2*(s*c-o*l),g=2*(o*c-s*l),_=2*(s*c+o*l),v=1-2*(o*o+s*s);for(let t=0,n=e.vertexCount;t<n;t++){let e=t*3,n=r[e],o=r[e+1],s=r[e+2];if(i[t]!==0||n===0&&o===0&&s===0)continue;let c=a[e]+u*n+d*o+f*s,l=a[e+1]+p*n+m*o+h*s,y=a[e+2]+g*n+_*o+v*s,b=Math.sqrt(c*c+l*l+y*y)||1;a[e]=c/b,a[e+1]=l/b,a[e+2]=y/b}}for(let e=0;e<o;e++){let r=this.capN[e],a=t.capTris[e];El(n,i,a,r),Dl(r,i,a,this.nAcc,.7),Dl(r,i,a,this.nAcc,.5)}let s=1e9,c=-1e9,l=1e9,u=-1e9,d=1e9,f=-1e9;for(let t=0,r=e.vertexCount*3;t<r;t+=3){let e=n[t],r=n[t+1],i=n[t+2];e<s&&(s=e),e>c&&(c=e),r<l&&(l=r),r>u&&(u=r),i<d&&(d=i),i>f&&(f=i)}this.minX=s,this.maxX=c,this.minY=l,this.maxY=u,this.minZ=d,this.maxZ=f;{let r=e.frame,i=e.center,o=e.restLocal,s=t.vSrc,c=r.x,l=r.y,u=r.z,d=r.w,f=1-2*(l*l+u*u),p=2*(c*l-u*d),m=2*(c*u+l*d),h=2*(c*l+u*d),g=1-2*(c*c+u*u),_=2*(l*u-c*d),v=2*(c*u-l*d),y=2*(l*u+c*d),b=1-2*(c*c+l*l),x=1/(.45*this.pieceRadius),S=this.simD,C=0,w=0;for(let t=0,r=e.vertexCount;t<r;t++){let e=t*3,r=s[t],c=r===0?a:this.capN[r-1],l=o[e],u=o[e+1],d=o[e+2],T=n[e]-(i.x+f*l+p*u+m*d),E=n[e+1]-(i.y+h*l+g*u+_*d),D=n[e+2]-(i.z+v*l+y*u+b*d),O=(T*c[e]+E*c[e+1]+D*c[e+2])*x,k=O<0?Math.min(1,-O):0,A=O>0?Math.min(1,O):0;S[t*2]=k,S[t*2+1]=A,k>C&&(C=k),A>w&&(w=A)}this.press=C,this.pull=w}let p=this.pos,m=this.nrm,h=this.strain,g=this.disp,_=this.simD,v=this.vA,y=this.vB,b=this.vC,x=this.bw,S=t.classStart,C=t.twin;for(let e=0;e<=o;e++){let t=e<o?this.capN[e]:a,i=e===o;for(let a=S[e],o=S[e+1];a<o;a++){let e=v[a],o=y[a],s=b[a];if(iu(n,t,e,o,s,x,a*3,p,a*3,m,a*3),i){let e=C[a];e>=0&&(p[a*3]=p[e*3],p[a*3+1]=p[e*3+1],p[a*3+2]=p[e*3+2])}let c=x[a*3],l=x[a*3+1],u=x[a*3+2],d=e/3|0,f=o/3|0,S=s/3|0;h[a]=c*r[d]+l*r[f]+u*r[S],g[a*2]=c*_[d*2]+l*_[f*2]+u*_[S*2],g[a*2+1]=c*_[d*2+1]+l*_[f*2+1]+u*_[S*2+1]}}for(let e=0;e<o;e++){let r=t.capTris[e],a=this.caps[e],o=0,s=0,c=0,l=0,u=0,d=0,f=0;for(let e=0;e<r.length;e++){let t=r[e]*3,a=i[t]*3,p=i[t+1]*3,m=i[t+2]*3,h=n[p]-n[a],g=n[p+1]-n[a+1],_=n[p+2]-n[a+2],v=n[m]-n[a],y=n[m+1]-n[a+1],b=n[m+2]-n[a+2],x=g*b-_*y,S=_*v-h*b,C=h*y-g*v,w=Math.sqrt(x*x+S*S+C*C);o+=x,s+=S,c+=C,l+=(n[a]+n[p]+n[m])*w,u+=(n[a+1]+n[p+1]+n[m+1])*w,d+=(n[a+2]+n[p+2]+n[m+2])*w,f+=w}if(f>1e-20){let e=Math.sqrt(o*o+s*s+c*c)||1;a.live=!0,a.area=f*.5,a.cx=l/(3*f),a.cy=u/(3*f),a.cz=d/(3*f),a.nx=o/e,a.ny=s/e,a.nz=c/e,a.d=a.nx*a.cx+a.ny*a.cy+a.nz*a.cz}else a.live=!1}this.posAttr.needsUpdate=!0,this.nrmAttr.needsUpdate=!0,this.strAttr.needsUpdate=!0,this.dispAttr.needsUpdate=!0}update(){if(this.body.piece!==this.pieceRef){this.rebuild(this.freq);return}if(this.pb){this.updatePiece();return}{let e=this.body.frac;if(typeof e==`number`&&e>this.builtFrac*1.15&&Cl(this.freq,this.body.vertexCount,e)>=this.effFreq*Sl.regrow){this.rebuild(this.freq);return}}let e=this.body,t=e.positions,n=e.strain,r=this.simN;wl(t,e.indices,r),Tl(r,e.indices,this.nAcc,.7),Tl(r,e.indices,this.nAcc,.5);let i=1e9,a=-1e9,o=1e9,s=-1e9,c=1e9,l=-1e9;for(let n=0,r=e.vertexCount*3;n<r;n+=3){let e=t[n],r=t[n+1],u=t[n+2];e<i&&(i=e),e>a&&(a=e),r<o&&(o=r),r>s&&(s=r),u<c&&(c=u),u>l&&(l=u)}this.minX=i,this.maxX=a,this.minY=o,this.maxY=s,this.minZ=c,this.maxZ=l;{let n=e.frame,i=e.center,a=e.restLocal,o=n.x,s=n.y,c=n.z,l=n.w,u=1-2*(s*s+c*c),d=2*(o*s-c*l),f=2*(o*c+s*l),p=2*(o*s+c*l),m=1-2*(o*o+c*c),h=2*(s*c-o*l),g=2*(o*c-s*l),_=2*(s*c+o*l),v=1-2*(o*o+s*s),y=1/(.45*e.restRadius),b=this.simD,x=0,S=0;for(let n=0,o=e.vertexCount;n<o;n++){let e=n*3,o=a[e],s=a[e+1],c=a[e+2],l=t[e]-(i.x+u*o+d*s+f*c),C=t[e+1]-(i.y+p*o+m*s+h*c),w=t[e+2]-(i.z+g*o+_*s+v*c),T=(l*r[e]+C*r[e+1]+w*r[e+2])*y,E=T<0?Math.min(1,-T):0,D=T>0?Math.min(1,T):0;b[n*2]=E,b[n*2+1]=D,E>x&&(x=E),D>S&&(S=D)}this.press=x,this.pull=S}let u=this.pos,d=this.nrm,f=this.strain,p=this.disp,m=this.simD,h=this.vA,g=this.vB,_=this.vC,v=this.bw;for(let e=0,i=this.fineCount;e<i;e++){let i=h[e],a=g[e],o=_[e],s=v[e*3],c=v[e*3+1],l=v[e*3+2];iu(t,r,i,a,o,v,e*3,u,e*3,d,e*3);let y=i/3|0,b=a/3|0,x=o/3|0;f[e]=s*n[y]+c*n[b]+l*n[x],p[e*2]=s*m[y*2]+c*m[b*2]+l*m[x*2],p[e*2+1]=s*m[y*2+1]+c*m[b*2+1]+l*m[x*2+1]}this.posAttr.needsUpdate=!0,this.nrmAttr.needsUpdate=!0,this.strAttr.needsUpdate=!0,this.dispAttr.needsUpdate=!0}dispose(){this.geo.dispose()}},lu={dot:{sx:1,sy:1,sz:.5,iris:.62,glint:.19,lid:9,droop:0},oval:{sx:.78,sy:1.34,sz:.5,iris:.66,glint:.18,lid:9,droop:0},sleepy:{sx:1.16,sy:1,sz:.46,iris:.6,glint:.17,lid:.18,droop:.12},wide:{sx:1.28,sy:1.28,sz:.52,iris:.76,glint:.2,lid:9,droop:0}},uu=()=>({tri:0,u:0,v:0,w:0}),du=(e,t,n)=>Math.sqrt(e*e+t*t+n*n),fu=new WeakMap,pu=e=>`${e.eyeStyle}|${e.eyeSize}|${e.eyeSpacing}|${e.eyeHeight}`;function mu(e,t,n,r){let i=pu(n),a=fu.get(e.restLocal);a||(a=[],fu.set(e.restLocal,a));for(let e of a)if(e.key===i)return e.ref;let o=hu(e,t,n,r??new nu(e));return a.push({key:i,ref:o}),a.length>6&&a.shift(),o}function hu(e,t,n,i){let a=lu[n.eyeStyle]??lu.dot,o=e.restLocal,s=e.indices,c=e.vertexCount,l=t*(.095+.07*n.eyeSize),u=(3+26*n.eyeHeight)*Math.PI/180,d=Math.asin(r(l*Math.max(a.sx,1)*1.3/(t*Math.cos(u)),0,.9)),f=Math.max((9+17*n.eyeSpacing)*Math.PI/180,d),p=new Float32Array(c*3),m=new Float32Array(c*3);wl(o,s,p),Tl(p,s,m,.7),Tl(p,s,m,.5);let h=[],g=new Float32Array(3),_=new Float32Array(3),v=new Float32Array(12),y=new Float32Array(12);for(let e of[-1,1]){let n=Math.sin(f*e)*Math.cos(u),r=Math.sin(u),c=Math.cos(f*e)*Math.cos(u),d=uu();i.locate(n,r,c,d);let m=c,b=0,x=-n;{let e=du(m,b,x)||1;m/=e,b/=e,x/=e}let S=r*x-c*b,C=c*m-n*x,w=n*b-r*m;{let e=du(S,C,w)||1;S/=e,C/=e,w/=e}let T=l*Math.max(a.sx,.9)*.9,E=T/t,D=Math.cos(E),O=Math.sin(E),k=[[m,b,x,1],[m,b,x,-1],[S,C,w,1],[S,C,w,-1]],A=[],j=[];for(let[e,t,a,l]of k){let u=uu();i.locate(n*D+e*O*l,r*D+t*O*l,c*D+a*O*l,u),A.push(u);let d=s[u.tri*3]*3,f=s[u.tri*3+1]*3,p=s[u.tri*3+2]*3;j.push({x:u.u*o[d]+u.v*o[f]+u.w*o[p],y:u.u*o[d+1]+u.v*o[f+1]+u.w*o[p+1],z:u.u*o[d+2]+u.v*o[f+2]+u.w*o[p+2]})}let M=j[0].x-j[1].x,N=j[0].y-j[1].y,P=j[0].z-j[1].z,F=j[2].x-j[3].x,I=j[2].y-j[3].y,L=j[2].z-j[3].z,ee=Math.max(1e-4,du(M,N,P)),te=Math.max(1e-4,du(F,I,L)),ne=N*L-P*I,re=P*F-M*L,R=M*I-N*F;{let e=du(ne,re,R)||1;ne/=e,re/=e,R/=e}ne*n+re*r+R*c<0&&(ne=-ne,re=-re,R=-R),ru(o,p,s[d.tri*3]*3,s[d.tri*3+1]*3,s[d.tri*3+2]*3,d.u,d.v,d.w,.7,g,0,_,0);for(let e=0;e<4;e++){let t=A[e];ru(o,p,s[t.tri*3]*3,s[t.tri*3+1]*3,s[t.tri*3+2]*3,t.u,t.v,t.w,.7,v,e*3,y,e*3)}let ie=v[0]-v[3],z=v[1]-v[4],B=v[2]-v[5],ae=v[6]-v[9],oe=v[7]-v[10],V=v[8]-v[11],se=z*V-B*oe,ce=B*ae-ie*V,le=ie*oe-z*ae;{let e=du(se,ce,le)||1;se/=e,ce/=e,le/=e}se*_[0]+ce*_[1]+le*_[2]<0&&(se=-se,ce=-ce,le=-le);let ue=ie*se+z*ce+B*le;ie-=se*ue,z-=ce*ue,B-=le*ue;{let e=du(ie,z,B);e<1e-4?(ie=1,z=0,B=0):(ie/=e,z/=e,B/=e)}let de=ce*B-le*z,H=le*ie-se*B,fe=se*z-ce*ie,pe=l*a.sz*.12,me=g[0]+se*pe-(a.droop?de*l*a.droop:0),he=g[1]+ce*pe-(a.droop?H*l*a.droop:0),ge=g[2]+le*pe-(a.droop?fe*l*a.droop:0),_e=s[d.tri*3]*3,ve=s[d.tri*3+1]*3,ye=s[d.tri*3+2]*3,be={x:d.u*o[_e]+d.v*o[ve]+d.w*o[ye],y:d.u*o[_e+1]+d.v*o[ve+1]+d.w*o[ye+1],z:d.u*o[_e+2]+d.v*o[ve+2]+d.w*o[ye+2]};h.push({side:e,hit:d,foot:A,restLx:ee,restLy:te,restN:{x:ne,y:re,z:R},east:{x:m,y:b,z:x},north:{x:S,y:C,z:w},dist:T,q:{x:g[0],y:g[1],z:g[2]},qFlat:be,footFlat:j,centre:{x:me,y:he,z:ge},frame:[{x:ie,y:z,z:B},{x:de,y:H,z:fe},{x:se,y:ce,z:le}]})}return{restLocal:o,radius:t,r:l,rho:l*1.24*Math.max(a.sx,a.sy),style:a,eyes:[h[0],h[1]]}}var gu=lu,_u=`
varying vec3 vLocal;
uniform vec2 uLook;
uniform float uIris;
uniform float uGlint;
`,vu=`
#include <color_fragment>
{
  vec2 lp = vLocal.xy;
  float irisD = length(lp - uLook * 0.3 - vec2(0.0, -0.04));
  float iris = 1.0 - smoothstep(uIris - 0.09, uIris, irisD);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.02, 0.09), iris * 0.85);
  float pup = 1.0 - smoothstep(uIris * 0.4, uIris * 0.52, length(lp - uLook * 0.38 - vec2(0.0, -0.04)));
  diffuseColor.rgb *= 1.0 - pup * 0.85;
  float g1 = 1.0 - smoothstep(uGlint * 0.62, uGlint, length(lp - (vec2(-0.3, 0.34) + uLook * 0.3)));
  float g2 = 1.0 - smoothstep(uGlint * 0.3, uGlint * 0.46, length(lp - (vec2(0.27, -0.3) + uLook * 0.2)));
  totalEmissiveRadiance += vec3(1.0, 0.95, 0.88) * (g1 + 0.7 * g2) * 2.4;
}
`,yu=()=>new Cr(new X(0,0,0),1e6),bu=class{dome;arc;uLook;hit={tri:0,u:0,v:0,w:0};foot=[0,1,2,3].map(()=>({tri:0,u:0,v:0,w:0}));restLx=1;restLy=1;restN=new X(0,0,1);look={x:0,y:0};nSmooth=new X(0,0,1);hasN=!1;slot=0;east=new X(1,0,0);north=new X(0,1,0);off=new X;hasOff=!1;footOk=null;clipCaps=[];clipPlanes=[];share=1;restCentre=new X;restFrame=null;bias=null;constructor(e,t,n){this.dome=e,this.arc=t,this.uLook=n}},xu=class{group=new mn;eyes=[];geos=[];mats=[];lookOut=new Float32Array(4);centreOut=new Float32Array(6);shareOut=new Float32Array(2);get eyeCount(){return this.eyes.length}anchors;body;view;style;radius;rng;blinkAt;blinkStart=-10;blinkLen=.15;doubleBlink=!1;squint=0;squintHold=0;wide=0;prevComp=0;seed;sp=new Float32Array(3);sn=new Float32Array(3);fp=new Float32Array(12);fn=new Float32Array(12);qs=new gt;vR=new X;vA=new X;vX=new X;vY=new X;vZ=new X;mtx=new zt;ndc=new X;vS=new X;vO=new X;vXo=new X;vYo=new X;vZo=new X;wholeRef;hub;constructor(e,n,r,i,a,o){this.hub=i,this.body=e,this.view=r,this.style=gu[n.eyeStyle]??gu.dot;let s=a?a.ref:mu(e,e.restRadius,n,r.mapper);this.wholeRef=s,this.radius=s.r,this.seed=n.seed,this.rng=t(n.seed^15655397^(a?a.salt:0)),this.blinkAt=1.4+this.rng()*2.4;let c=e=>({x:s.eyes[e].centre.x,y:s.eyes[e].centre.y,z:s.eyes[e].centre.z});this.anchors=a?null:{left:c(0),right:c(1)};let l=a?a.eyes.map(e=>e):[null,null];if(l.length===0)return;let u=o?.domeQ??1,d=new Li(1,Math.max(10,Math.round(28*u)),Math.max(6,Math.round(18*u)),0,Math.PI*2,0,Math.PI/2);if(d.rotateX(Math.PI/2),this.style.lid<5){let e=d.getAttribute(`position`);for(let t=0;t<e.count;t++)e.getY(t)>this.style.lid&&e.setY(t,this.style.lid);e.needsUpdate=!0}this.geos.push(d);let f=new Ri(1,.2,8,24,Math.PI);this.geos.push(f);for(let e=0;e<l.length;e++){let t=l[e],n=t?t.slot:e,r=s.eyes[n],a=[yu(),yu()],c=new Xi({color:722968,roughness:.1,metalness:0,clearcoat:1,clearcoatRoughness:.04,ior:1.5,fog:!1,transparent:!0,opacity:1,side:2});o?.singlePass&&(c.forceSinglePass=!0),i.apply(c,2.2),c.clippingPlanes=a;let u={value:new Y},p=this.style.iris,m=this.style.glint;c.onBeforeCompile=e=>{e.uniforms.uLook=u,e.uniforms.uIris={value:p},e.uniforms.uGlint={value:m},e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
varying vec3 vLocal;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
vLocal = position;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
`+_u).replace(`#include <color_fragment>`,vu).replace(`#include <dithering_fragment>`,`#include <dithering_fragment>
  if (!gl_FrontFacing) gl_FragColor = vec4(0.043, 0.03, 0.094, 1.0);`)},c.customProgramCacheKey=()=>`wh-eye-v2`;let h=new Xi({color:722968,roughness:.14,metalness:0,clearcoat:1,clearcoatRoughness:.05,fog:!1,transparent:!0,opacity:1});i.apply(h,2),h.clippingPlanes=a,this.mats.push(c,h);let g=new ai(d,c),_=new ai(f,h);for(let e of[g,_])e.matrixAutoUpdate=!1,e.frustumCulled=!1,e.renderOrder=20;_.visible=!1;let v=new bu(g,_,u);v.slot=n,v.restLx=r.restLx,v.restLy=r.restLy,v.restN.set(r.restN.x,r.restN.y,r.restN.z),v.east.set(r.east.x,r.east.y,r.east.z),v.north.set(r.north.x,r.north.y,r.north.z);let y=t??r;Object.assign(v.hit,y.hit);for(let e=0;e<4;e++)Object.assign(v.foot[e],y.foot[e]);v.clipPlanes=a,t&&(v.share=t.f,v.off.set(t.off.x,t.off.y,t.off.z),v.hasOff=t.hasOff,v.footOk=t.footOk.every(e=>e)?null:t.footOk,v.clipCaps=t.clip,t.clip.length>0&&(v.restCentre.set(t.restCentre.x,t.restCentre.y,t.restCentre.z),v.restFrame=t.frame.map(e=>new X(e.x,e.y,e.z)))),this.shareOut[n]=v.share,this.eyes.push(v),this.group.add(g,_)}}update(t,n,i,a,o,s){let c=this.body,l=c.positions,u=this.view.simN,d=c.indices,f=this.radius,p=this.style;this.wide+=(e(.3,.8,o)-this.wide)*(1-Math.exp(-t*16)),s<-.5&&this.prevComp>.07&&(this.squintHold=.5),this.prevComp=o,this.squintHold=Math.max(0,this.squintHold-t);let m=+(this.squintHold>0||s<-.3&&o>.15);this.squint+=(m-this.squint)*(1-Math.exp(-t*(m>this.squint?26:8))),n>=this.blinkAt&&this.squint<.2&&(this.blinkStart=n,this.blinkLen=.13+this.rng()*.05,this.blinkAt=n+2.2+this.rng()*3.6,!this.doubleBlink&&this.rng()<.18?(this.blinkAt=n+.34,this.doubleBlink=!0):this.doubleBlink=!1);let h=(n-this.blinkStart)/this.blinkLen,g=h>=0&&h<1?Math.sin(h*Math.PI):0,_=1-.93*Math.max(g,e(0,.55,this.squint)),v=e(.3,.9,this.squint),y=n*.5+this.seed*1e-4;for(let e=0;e<this.eyes.length;e++){let n=this.eyes[e],o=n.slot,s=n.hit;ru(l,u,d[s.tri*3]*3,d[s.tri*3+1]*3,d[s.tri*3+2]*3,s.u,s.v,s.w,.7,this.sp,0,this.sn,0);for(let e=0;e<4;e++){let t=n.foot[e];ru(l,u,d[t.tri*3]*3,d[t.tri*3+1]*3,d[t.tri*3+2]*3,t.u,t.v,t.w,.7,this.fp,e*3,this.fn,e*3)}let m=this.fp,h=c.frame;this.qs.set(h.x,h.y,h.z,h.w),n.footOk===null?(this.vX.set(m[0]-m[3],m[1]-m[4],m[2]-m[5]),this.vY.set(m[6]-m[9],m[7]-m[10],m[8]-m[11])):(this.footAxis(this.vX,m,0,3,n.footOk[0],n.footOk[1],n.east,n.restLx),this.footAxis(this.vY,m,6,9,n.footOk[2],n.footOk[3],n.north,n.restLy));let g=this.vX.length(),b=this.vY.length();n.restFrame&&n.bias===null&&(n.restLx=g,n.restLy=b),this.vZ.crossVectors(this.vX,this.vY).normalize(),this.vZ.x*this.sn[0]+this.vZ.y*this.sn[1]+this.vZ.z*this.sn[2]<0&&this.vZ.negate(),this.vR.copy(n.restN).applyQuaternion(this.qs);let x=this.vZ.dot(this.vR);x<.72&&this.vZ.lerp(this.vR,.8*r((.72-x)/.5,0,1)).normalize(),n.hasN?n.nSmooth.lerp(this.vZ,1-Math.exp(-t*40)).normalize():(n.nSmooth.copy(this.vZ),n.hasN=!0),this.vZ.copy(n.nSmooth),this.vX.addScaledVector(this.vZ,-this.vX.dot(this.vZ)),this.vX.lengthSq()<1e-8&&this.vX.set(1,0,0),this.vX.normalize(),this.vY.crossVectors(this.vZ,this.vX);let S=1+(r(g/n.restLx,.8,1.35)-1)*.55,C=1+(r(b/n.restLy,.8,1.35)-1)*.55,w=f*(1+.24*this.wide),T=w*p.sx*S,E=w*p.sy*C,D=w*p.sz,O=D*.12;this.vA.set(this.sp[0]+this.vZ.x*O,this.sp[1]+this.vZ.y*O,this.sp[2]+this.vZ.z*O),n.hasOff&&(this.vO.copy(n.off).applyQuaternion(this.qs),this.vA.add(this.vO)),p.droop&&this.vA.addScaledVector(this.vY,-w*p.droop),n.restFrame&&this.calibrate(n),this.centreOut[o*3]=this.vA.x,this.centreOut[o*3+1]=this.vA.y,this.centreOut[o*3+2]=this.vA.z,n.clipCaps.length>0&&this.updateClip(n);let k=0,A=0;if(i&&a){this.ndc.copy(this.vA).project(a);let e=(i.x-this.ndc.x)*a.aspect,t=i.y-this.ndc.y,n=Math.sqrt(e*e+t*t);if(n>1e-4){let r=Math.min(1,n*1.8);k=e/n*r,A=t/n*r}let r=a.matrixWorldInverse.elements,o=this.vX.x*r[0]+this.vX.y*r[4]+this.vX.z*r[8],s=this.vX.x*r[1]+this.vX.y*r[5]+this.vX.z*r[9],c=this.vY.x*r[0]+this.vY.y*r[4]+this.vY.z*r[8],l=this.vY.x*r[1]+this.vY.y*r[5]+this.vY.z*r[9],u=k*o+A*s,d=k*c+A*l;k=u,A=d}else k=.32*Math.sin(y*1.7+o*.4)+.12*Math.sin(y*4.1),A=.18*Math.sin(y*1.3+1);n.look.x+=(k-n.look.x)*(1-Math.exp(-t*16)),n.look.y+=(A-n.look.y)*(1-Math.exp(-t*16));let j=Math.sqrt(n.look.x*n.look.x+n.look.y*n.look.y),M=j>1?1/j:1;n.uLook.value.set(n.look.x*M,n.look.y*M),this.lookOut[o*2]=n.look.x*M,this.lookOut[o*2+1]=n.look.y*M;let N=n.dome;v<.98?(N.visible=!0,this.mtx.makeBasis(this.vX,this.vY,this.vZ),this.mtx.scale(this.vS.set(T,E*Math.max(.07,_),D)),this.mtx.setPosition(this.vA),N.matrix.copy(this.mtx),N.matrixWorldNeedsUpdate=!0):N.visible=!1;let P=n.arc;if(v>.02){P.visible=!0;let e=v;this.mtx.makeBasis(this.vX,this.vY,this.vZ),this.mtx.scale(this.vS.set(w*.95*e,w*.8*e,w*.7)),this.vA.addScaledVector(this.vY,-w*.18*e).addScaledVector(this.vZ,w*.05),this.mtx.setPosition(this.vA),P.matrix.copy(this.mtx),P.matrixWorldNeedsUpdate=!0}else P.visible=!1}}calibrate(e){let t=e.restFrame,n=this.vX,r=this.vY,i=this.vZ;if(e.bias===null){let a=this.body.center,o=this.vO.copy(e.restCentre).applyQuaternion(this.qs),s=o.x+a.x-this.vA.x,c=o.y+a.y-this.vA.y,l=o.z+a.z-this.vA.z,u=new Float32Array(12);u[0]=s*n.x+c*n.y+l*n.z,u[1]=s*r.x+c*r.y+l*r.z,u[2]=s*i.x+c*i.y+l*i.z;for(let e=0;e<3;e++){let a=this.vR.copy(t[e]).applyQuaternion(this.qs);u[3+3*e]=a.dot(n),u[4+3*e]=a.dot(r),u[5+3*e]=a.dot(i)}e.bias=u}let a=e.bias;this.vA.addScaledVector(n,a[0]).addScaledVector(r,a[1]).addScaledVector(i,a[2]),this.vXo.copy(n),this.vYo.copy(r),this.vZo.copy(i),n.set(0,0,0).addScaledVector(this.vXo,a[3]).addScaledVector(this.vYo,a[4]).addScaledVector(this.vZo,a[5]),r.set(0,0,0).addScaledVector(this.vXo,a[6]).addScaledVector(this.vYo,a[7]).addScaledVector(this.vZo,a[8]),i.set(0,0,0).addScaledVector(this.vXo,a[9]).addScaledVector(this.vYo,a[10]).addScaledVector(this.vZo,a[11])}updateClip(e){let t=this.view.caps;for(let n=0;n<2;n++){let r=e.clipPlanes[n],i=n<e.clipCaps.length?e.clipCaps[n]:-1,a=i>=0?t[i]:void 0;a&&a.live?(r.normal.set(-a.nx,-a.ny,-a.nz),r.constant=a.d):(r.normal.set(0,0,0),r.constant=1e6)}}footAxis(e,t,n,r,i,a,o,s){let c=this.sp;i&&a?e.set(t[n]-t[r],t[n+1]-t[r+1],t[n+2]-t[r+2]):i?e.set(2*(t[n]-c[0]),2*(t[n+1]-c[1]),2*(t[n+2]-c[2])):a?e.set(2*(c[0]-t[r]),2*(c[1]-t[r+1]),2*(c[2]-t[r+2])):e.copy(o).multiplyScalar(s).applyQuaternion(this.qs)}dispose(){for(let e of this.geos)e.dispose();for(let e of this.mats)this.hub.release(e),e.dispose()}},Su={high:{tier:`high`,fineFreq:32,dprCap:2,transmission:!0,transmissionScale:1,glitterMax:150,bubbleMax:40},med:{tier:`med`,fineFreq:24,dprCap:1.5,transmission:!0,transmissionScale:.5,glitterMax:100,bubbleMax:32},low:{tier:`low`,fineFreq:16,dprCap:1,transmission:!1,transmissionScale:.5,glitterMax:48,bubbleMax:20}},Cu=[`high`,`med`,`low`],wu=e=>Cu[Math.min(Cu.length-1,Cu.indexOf(e)+1)],Tu=class{mode=`auto`;tier=`med`;frameMsEma=0;dropAboveMs=24;sum=0;count=0;windowT=0;hold=0;setMode(e){return this.mode=e,this.resetWindow(30),e===`auto`||e===this.tier?null:(this.tier=e,e)}resetWindow(e=20){this.sum=0,this.count=0,this.windowT=0,this.hold=e}sample(e){if(!(e>0)||e>2e3)return null;this.frameMsEma=this.frameMsEma===0?e:this.frameMsEma*.9+e*.1;let t=Math.min(e,100);if(this.hold>0)return this.hold--,null;if(this.sum+=t,this.count++,this.windowT+=t,this.windowT<1e3)return null;let n=this.sum/this.count;return this.sum=0,this.count=0,this.windowT=0,this.mode===`auto`&&n>this.dropAboveMs&&this.tier!==`low`?(this.tier=wu(this.tier),this.resetWindow(24),this.tier):null}};function Eu(){let e=new La;return e.setAttribute(`position`,new tr(new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0]),3)),e.setIndex(new tr(new Uint16Array([0,1,2,0,2,3]),1)),e.boundingSphere=new cr(new X,1e4),e.instanceCount=0,e}var Du=e=>new Q().setRGB(e[0],e[1],e[2],We),Ou=`
attribute vec4 aPos;
attribute vec4 aState;
varying vec2 vUv;
varying vec4 vState;
void main() {
  vUv = position.xy;
  vState = aState;
  vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
  mv.xy += position.xy * aPos.w * (1.0 + 0.8 * aState.x);
  gl_Position = projectionMatrix * mv;
}
`,ku=`
varying vec2 vUv;
varying vec4 vState;
uniform vec3 uTint;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float pop = vState.x;
  float shell = smoothstep(0.6, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
  float body = 0.07 * (1.0 - r);
  float hl = smoothstep(0.28, 0.0, length(vUv - vec2(-0.36, 0.4)));
  float cres = pow(max(0.0, dot(normalize(vUv + 1e-5), normalize(vec2(0.7, -0.7)))), 3.0) * smoothstep(0.5, 0.95, r);
  vec3 col = vec3(1.0, 0.94, 0.84) * (shell * 0.5 + hl * 1.7) + vec3(0.3, 0.85, 1.0) * cres * 0.8 + uTint * body;
  float spokes = pow(abs(sin(atan(vUv.y, vUv.x) * 4.5 + vState.y * 10.0)), 6.0) * smoothstep(0.25, 0.8, r) * (1.0 - smoothstep(0.85, 1.0, r));
  col = mix(col, vec3(1.0, 0.96, 0.88) * (spokes * 1.1 + shell * 0.6), pop);
  gl_FragColor = vec4(col * vState.z, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,Au=class{mesh;geo;mat;cap;limit;count=0;px;py;pz;vx;vy;vz;age;life;size;seed;pop;aPos;aState;aPosA;aStateA;constructor(e,t){this.cap=e,this.limit=e;let n=()=>new Float32Array(e);this.px=n(),this.py=n(),this.pz=n(),this.vx=n(),this.vy=n(),this.vz=n(),this.age=n(),this.life=n(),this.size=n(),this.seed=n(),this.pop=n(),this.aPos=new Float32Array(e*4),this.aState=new Float32Array(e*4),this.geo=Eu(),this.aPosA=new li(this.aPos,4).setUsage(Ye),this.aStateA=new li(this.aState,4).setUsage(Ye),this.geo.setAttribute(`aPos`,this.aPosA),this.geo.setAttribute(`aState`,this.aStateA),this.mat=new qi({vertexShader:Ou,fragmentShader:ku,uniforms:{uTint:{value:t}},transparent:!0,depthWrite:!1,depthTest:!0,blending:2,fog:!1}),this.mesh=new ai(this.geo,this.mat),this.mesh.frustumCulled=!1,this.mesh.renderOrder=30,this.mesh.visible=!1}spawn(e,t,n,r){let i=Math.round(4+12*Math.min(1,Math.max(0,t)));for(let a=0;a<i&&this.count<this.limit;a++){let i=this.count++,a=n()*Math.PI*2,o=(.05+.3*n())*r;this.px[i]=e.x+Math.cos(a)*o,this.py[i]=Math.max(.02,e.y)+n()*.12*r,this.pz[i]=e.z+Math.sin(a)*o,this.vx[i]=Math.cos(a)*.1*n(),this.vz[i]=Math.sin(a)*.1*n(),this.vy[i]=.22+.4*n()+.25*t,this.age[i]=0,this.life[i]=.8+n()*1.4,this.size[i]=(.022+.05*n()*n()+.012*t)*r,this.seed[i]=n(),this.pop[i]=-1}}update(e,t){let n=0;for(;n<this.count;){let r=!1;if(this.pop[n]<0){this.age[n]+=e;let r=Math.exp(-e*1.4);this.vx[n]*=r,this.vz[n]*=r,this.vy[n]=this.vy[n]*r+.35*e;let i=this.seed[n]*40;this.px[n]+=(this.vx[n]+Math.sin(t*5+i)*.07)*e,this.pz[n]+=(this.vz[n]+Math.cos(t*4.3+i)*.07)*e,this.py[n]+=this.vy[n]*e,this.age[n]>=this.life[n]&&(this.pop[n]=0)}else this.pop[n]+=e,this.pop[n]>.16&&(r=!0);if(r){let e=--this.count;this.px[n]=this.px[e],this.py[n]=this.py[e],this.pz[n]=this.pz[e],this.vx[n]=this.vx[e],this.vy[n]=this.vy[e],this.vz[n]=this.vz[e],this.age[n]=this.age[e],this.life[n]=this.life[e],this.size[n]=this.size[e],this.seed[n]=this.seed[e],this.pop[n]=this.pop[e];continue}n++}for(let e=0;e<this.count;e++){let t=this.pop[e]<0?0:Math.min(1,this.pop[e]/.16),n=Math.min(1,this.age[e]/.12);this.aPos[e*4]=this.px[e],this.aPos[e*4+1]=this.py[e],this.aPos[e*4+2]=this.pz[e],this.aPos[e*4+3]=this.size[e],this.aState[e*4]=t,this.aState[e*4+1]=this.seed[e],this.aState[e*4+2]=n*(1-t*t)*.9}this.aPosA.needsUpdate=!0,this.aStateA.needsUpdate=!0,this.geo.instanceCount=this.count,this.mesh.visible=this.count>0}get active(){return this.count}dispose(){this.geo.dispose(),this.mat.dispose()}},ju=`
attribute vec4 aPos;     // xyz, half size
attribute vec4 aTw;      // phase, speed, brightness, 0
varying vec2 vUv;
varying vec3 vTw;
void main() {
  vUv = position.xy;
  vTw = aTw.xyz;
  vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
  mv.xy += position.xy * aPos.w;
  gl_Position = projectionMatrix * mv;
}
`,Mu=`
varying vec2 vUv;
varying vec3 vTw;
uniform float uTime;
uniform float uTwinkle;   // 1 = the specks twinkle; 0 = steady at their mean brightness (calm effects: no pulses)
uniform vec3 uColor;
void main() {
  vec2 p = vUv;
  float r = length(p);
  if (r > 1.0) discard;
  float tw = mix(0.25, pow(0.5 + 0.5 * sin(uTime * vTw.y + vTw.x * 6.2832), 5.0), uTwinkle);
  float star = max(0.0, 1.0 - 7.0 * abs(p.x * p.y)) * (1.0 - smoothstep(0.55, 1.0, r));
  float core = exp(-r * r * 12.0);
  float a = (star * 0.85 + core * 1.1) * (0.18 + 1.7 * tw) * vTw.z;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,Nu=class{twinkle=!0;mesh;geo;mat;cap;burstCap=48;n=0;tri;bw;rf;sz;ph;sp;bx=new Float32Array(48);by=new Float32Array(48);bz=new Float32Array(48);bvx=new Float32Array(48);bvy=new Float32Array(48);bvz=new Float32Array(48);bage=new Float32Array(48);blife=new Float32Array(48);bph=new Float32Array(48);bn=0;aPos;aTw;aPosA;aTwA;constructor(e,t){this.cap=e,this.tri=new Uint32Array(e),this.bw=new Float32Array(e*3),this.rf=new Float32Array(e),this.sz=new Float32Array(e),this.ph=new Float32Array(e),this.sp=new Float32Array(e);let n=e+this.burstCap;this.aPos=new Float32Array(n*4),this.aTw=new Float32Array(n*4),this.geo=Eu(),this.aPosA=new li(this.aPos,4).setUsage(Ye),this.aTwA=new li(this.aTw,4).setUsage(Ye),this.geo.setAttribute(`aPos`,this.aPosA),this.geo.setAttribute(`aTw`,this.aTwA),this.mat=new qi({vertexShader:ju,fragmentShader:Mu,uniforms:{uTime:{value:0},uTwinkle:{value:1},uColor:{value:t}},transparent:!0,depthWrite:!1,depthTest:!0,blending:2,fog:!1}),this.mesh=new ai(this.geo,this.mat),this.mesh.frustumCulled=!1,this.mesh.renderOrder=25,this.mesh.visible=!1}layout(e,n,r,i){this.n=Math.min(this.cap,e),this.scaleHint=i;let a=t(r^6363111),o={tri:0,u:0,v:0,w:0};for(let e=0;e<this.n;e++){let t=a()*2-1,r=a()*Math.PI*2,s=Math.sqrt(1-t*t);n.locate(s*Math.cos(r),t,s*Math.sin(r),o),this.tri[e]=o.tri,this.bw[e*3]=o.u,this.bw[e*3+1]=o.v,this.bw[e*3+2]=o.w,this.rf[e]=.22+.68*Math.cbrt(a()),this.sz[e]=(.005+.008*a()*a()+.003)*i,this.ph[e]=a(),this.sp[e]=2.5+6*a()}}burst(e,t,n,r){let i=Math.round(10+28*Math.min(1,Math.max(0,t)));for(let a=0;a<i&&this.bn<this.burstCap;a++){let i=this.bn++,a=n()*2-1,o=n()*Math.PI*2,s=Math.sqrt(1-a*a),c=(.4+1.1*n())*(.6+.7*t)*r;this.bx[i]=e.x,this.by[i]=Math.max(.03,e.y),this.bz[i]=e.z,this.bvx[i]=s*Math.cos(o)*c,this.bvy[i]=(Math.abs(a)*.9+.35)*c,this.bvz[i]=s*Math.sin(o)*c,this.bage[i]=0,this.blife[i]=.55+.8*n(),this.bph[i]=n()}}trail(e,t){if(this.n===0||this.bn>=this.burstCap||!this.lastPos)return;let n=Math.floor(e()*this.n),r=this.lastPos,i=this.bn++;this.bx[i]=r[n*3],this.by[i]=r[n*3+1],this.bz[i]=r[n*3+2],this.bvx[i]=(e()-.5)*.12*t,this.bvy[i]=(.35+.35*e())*t,this.bvz[i]=(e()-.5)*.12*t,this.bage[i]=0,this.blife[i]=.45+.4*e(),this.bph[i]=e()}lastPos=null;scaleHint=1;update(e,t,n,r,i=!1){let a=0;if(this.lastPos||=new Float32Array(this.cap*3),n){let e=n.positions,o=n.indices,s=n.center,c=s.x,l=s.y,u=s.z;for(let n=0;n<this.n;n++){let s=this.tri[n]*3,d=o[s]*3,f=o[s+1]*3,p=o[s+2]*3,m=this.bw[n*3],h=this.bw[n*3+1],g=this.bw[n*3+2],_=this.rf[n],v=i?(t*.05+this.ph[n])%1:.5,y=i?(v-.5)*.16*this.scaleHint:0,b=i?.15+.85*Math.sin(v*Math.PI):1,x=c+(m*e[d]+h*e[f]+g*e[p]-c)*_,S=l+(m*e[d+1]+h*e[f+1]+g*e[p+1]-l)*_+y,C=u+(m*e[d+2]+h*e[f+2]+g*e[p+2]-u)*_;this.aPos[a*4]=x,this.aPos[a*4+1]=S,this.aPos[a*4+2]=C,this.aPos[a*4+3]=this.sz[n],this.lastPos[n*3]=x,this.lastPos[n*3+1]=S,this.lastPos[n*3+2]=C,this.aTw[a*4]=this.ph[n],this.aTw[a*4+1]=this.sp[n],this.aTw[a*4+2]=r*(.3+.9*_*_)*b,this.aTw[a*4+3]=0,a++}}let o=0;for(;o<this.bn;){if(this.bage[o]+=e,this.bage[o]>=this.blife[o]){let e=--this.bn;this.bx[o]=this.bx[e],this.by[o]=this.by[e],this.bz[o]=this.bz[e],this.bvx[o]=this.bvx[e],this.bvy[o]=this.bvy[e],this.bvz[o]=this.bvz[e],this.bage[o]=this.bage[e],this.blife[o]=this.blife[e],this.bph[o]=this.bph[e];continue}let t=Math.exp(-e*2.2);this.bvx[o]*=t,this.bvz[o]*=t,this.bvy[o]=this.bvy[o]*t-1.5*e,this.bx[o]+=this.bvx[o]*e,this.by[o]+=this.bvy[o]*e,this.bz[o]+=this.bvz[o]*e,this.by[o]<.01&&(this.by[o]=.01,this.bvy[o]=-this.bvy[o]*.3),o++}for(let e=0;e<this.bn;e++){let t=1-this.bage[e]/this.blife[e];this.aPos[a*4]=this.bx[e],this.aPos[a*4+1]=this.by[e],this.aPos[a*4+2]=this.bz[e],this.aPos[a*4+3]=.016+.01*t,this.aTw[a*4]=this.bph[e],this.aTw[a*4+1]=14,this.aTw[a*4+2]=t*1.5,this.aTw[a*4+3]=1,a++}this.mat.uniforms.uTime.value=t,this.mat.uniforms.uTwinkle.value=+!!this.twinkle,this.aPosA.needsUpdate=!0,this.aTwA.needsUpdate=!0,this.geo.instanceCount=a,this.mesh.visible=a>0}get suspended(){return this.n}dispose(){this.geo.dispose(),this.mat.dispose()}},Pu=`
attribute vec4 aPos;     // xyz, size
attribute vec4 aState;   // age01, kind (0 dust, 1 ring), seed, alpha
varying vec2 vUv;
varying vec4 vState;
void main() {
  vUv = position.xy;
  vState = aState;
  if (aState.y > 0.5) {
    vec3 wp = aPos.xyz + vec3(position.x, 0.0, position.y) * aPos.w;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  } else {
    vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
    mv.xy += position.xy * aPos.w;
    gl_Position = projectionMatrix * mv;
  }
}
`,Fu=`
varying vec2 vUv;
varying vec4 vState;
uniform vec3 uColor;
${Bl}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float a;
  vec3 col = uColor;
  if (vState.y > 1.5) {                    // calm mode: the ring becomes a soft fading disc
    float fall = 1.0 - smoothstep(0.0, 1.0, r);
    a = fall * fall * 0.7;
    col = mix(uColor, vec3(1.0, 0.93, 0.82), 0.5);
  } else if (vState.y > 0.5) {
    float w = mix(0.2, 0.07, vState.x);
    a = smoothstep(1.0 - w * 2.0, 1.0 - w, r) * (1.0 - smoothstep(1.0 - w, 1.0, r));
    col = mix(uColor, vec3(1.0, 0.93, 0.82), 0.5);   // a cream ring reads against the orange light pool
  } else {
    float n = whNoise2(vUv * 1.5 + vState.z * 31.0);
    float fall = 1.0 - smoothstep(0.0, 1.0, r);
    a = fall * fall * (0.65 + 0.5 * n);
  }
  gl_FragColor = vec4(col, a * vState.w);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,Iu=class{mesh;geo;mat;cap=36;count=0;px=new Float32Array(36);py=new Float32Array(36);pz=new Float32Array(36);vx=new Float32Array(36);vz=new Float32Array(36);age=new Float32Array(36);life=new Float32Array(36);size=new Float32Array(36);kind=new Float32Array(36);seed=new Float32Array(36);str=new Float32Array(36);aPos=new Float32Array(144);aState=new Float32Array(144);aPosA;aStateA;constructor(e){this.geo=Eu(),this.aPosA=new li(this.aPos,4).setUsage(Ye),this.aStateA=new li(this.aState,4).setUsage(Ye),this.geo.setAttribute(`aPos`,this.aPosA),this.geo.setAttribute(`aState`,this.aStateA),this.mat=new qi({vertexShader:Pu,fragmentShader:Fu,uniforms:{uColor:{value:e}},transparent:!0,depthWrite:!1,depthTest:!0,blending:1,fog:!1,side:2}),this.mesh=new ai(this.geo,this.mat),this.mesh.frustumCulled=!1,this.mesh.renderOrder=28,this.mesh.visible=!1}add(e,t,n,r,i,a,o,s,c,l){if(this.count>=this.cap)return;let u=this.count++;this.px[u]=e,this.py[u]=t,this.pz[u]=n,this.vx[u]=r,this.vz[u]=i,this.age[u]=0,this.life[u]=a,this.size[u]=o,this.kind[u]=s,this.seed[u]=c,this.str[u]=l}footprint=.5;room=1/0;dust(e,t,n,r){let i=5+Math.round(5*t),a=Math.min(1,Math.max(.15,t)),o=this.room*.85;for(let t=0;t<i;t++){let s=t/i*Math.PI*2+n()*.8,c=this.footprint*(.95+.3*n()),l=.04*r+n()*.03,u=(.25+.3*n())*r,d=(.25+.3*n())*r,f=.6+.45*n(),p=(.12+.08*n())*r*(.7+.6*a),m=n(),h=p*1.45*.8,g=.17*r;c+h>o&&(c=Math.max(.1,o-h));let _=Math.max(0,Math.min(1,(o-c-h)/Math.max(.001,g)));this.add(e.x+Math.cos(s)*c,l,e.z+Math.sin(s)*c,Math.cos(s)*u*_,Math.sin(s)*d*_,f,p,0,m,.45+.4*a)}}fadeDisc(e,t){let n=Math.min(1,Math.max(.2,t));this.add(e.x,.012,e.z,0,0,.8,this.footprint*(1.15+.25*n),2,0,.45*(.6+.4*n))}ring(e,t,n,r){let i=Math.min(1,Math.max(.2,t));this.add(e.x,.012,e.z,0,0,.65+.25*i,this.footprint*(1+.5*i),1,0,.7+.2*i)}update(e){let t=0;for(;t<this.count;){if(this.age[t]+=e,this.age[t]>=this.life[t]){let e=--this.count;this.px[t]=this.px[e],this.py[t]=this.py[e],this.pz[t]=this.pz[e],this.vx[t]=this.vx[e],this.vz[t]=this.vz[e],this.age[t]=this.age[e],this.life[t]=this.life[e],this.size[t]=this.size[e],this.kind[t]=this.kind[e],this.seed[t]=this.seed[e],this.str[t]=this.str[e];continue}let n=Math.exp(-e*3.2);this.vx[t]*=n,this.vz[t]*=n,this.px[t]+=this.vx[t]*e,this.pz[t]+=this.vz[t]*e,this.kind[t]<.5&&(this.py[t]+=.07*e),t++}for(let e=0;e<this.count;e++){let t=this.age[e]/this.life[e],n=this.kind[e]>.5,r=this.kind[e]>1.5,i=r?1+.2*t:n?1+1.1*(1-(1-t)*(1-t)):.55+.9*t;if(n){let t=this.size[e]*(r?1.2:2.1),n=this.room*.9;t>n&&(i*=n/t)}let a=r?Math.sin(Math.min(1,t*1.15)*Math.PI):n?(1-t)*(1-t):Math.min(1,t*8)*(1-t)*(1-t);this.aPos[e*4]=this.px[e],this.aPos[e*4+1]=this.py[e],this.aPos[e*4+2]=this.pz[e],this.aPos[e*4+3]=this.size[e]*i,this.aState[e*4]=t,this.aState[e*4+1]=this.kind[e],this.aState[e*4+2]=this.seed[e],this.aState[e*4+3]=a*this.str[e]}this.aPosA.needsUpdate=!0,this.aStateA.needsUpdate=!0,this.geo.instanceCount=this.count,this.mesh.visible=this.count>0}get active(){return this.count}dispose(){this.geo.dispose(),this.mat.dispose()}},Lu=class{group=new mn;bubbles;glitter;puffs;rng;genome;mapper;scale;glow=1;style;tierSpec;trailT=0;calm=!1;constructor(e,n,r,i,a,o){this.genome=e,this.mapper=r,this.scale=a,this.style=o,this.tierSpec=i,this.rng=t(e.seed^15790320),this.bubbles=new Au(Su.high.bubbleMax,Du(n.glow)),this.glitter=new Nu(Su.high.glitterMax,Du(n.glitter)),this.puffs=new Iu(Du(n.dust)),this.group.add(this.puffs.mesh,this.glitter.mesh,this.bubbles.mesh),this.setTier(i)}setTier(e){this.tierSpec=e,this.bubbles.limit=e.bubbleMax;let t=this.style.sparkleBase,n=Math.min(1,t+(1-t)*this.genome.glitter**1.6),r=n<=.02?0:Math.max(10,Math.round(e.glitterMax*n));this.glitter.layout(r,this.mapper,this.genome.seed,this.scale)}setStyle(e){this.style=e,this.setTier(this.tierSpec)}spawn(e,t,n){let r=Number.isFinite(n)?n:.5;switch(e){case`bubbles`:this.bubbles.spawn(t,r,this.rng,this.scale);break;case`glitter`:this.glitter.burst(t,r,this.rng,this.scale);break;case`dust`:this.puffs.dust(t,r,this.rng,this.scale);break;case`ring`:this.calm?this.puffs.fadeDisc(t,r):this.puffs.ring(t,r,this.rng,this.scale)}}setFootprint(e){this.puffs.footprint=Math.max(.15,e)}setFrameRoom(e){this.puffs.room=Math.max(.2,e)}update(e,t,n){this.glow=.85+.9*(n?n.metrics.kinetic:0),this.bubbles.update(e,t);let r=this.style.drift&&!this.calm;if(this.glitter.twinkle=!this.calm,this.glitter.update(e,t,n,this.glow,r),this.style.sparkTrail&&!this.calm&&e>0)for(this.trailT+=e;this.trailT>.14;)this.trailT-=.14,this.glitter.trail(this.rng,this.scale);this.puffs.update(e)}get counts(){return{bubbles:this.bubbles.active,glitter:this.glitter.suspended,puffs:this.puffs.active}}dispose(){this.bubbles.dispose(),this.glitter.dispose(),this.puffs.dispose()}},Ru={enabled:!0,marginMin:3,marginFrac:.02,maxScale:3.2,lensRate:5,calmBelow:.3,calmAbove:.5,tauOut:.25,tauIn:1.2,minBand:.35,sideFitFrom:6,scanFrom:8,scanEvery:6},zu=class{p=new Float64Array(15);s=new Float64Array(4);ready=!1;calm=!0;hasPrev=!1;skip=0;gate(e,t,n){let r=this.s,i=t[4];if(this.hasPrev&&i>1e-4){let t=e.x-r[1],n=e.y-r[2],a=e.z-r[3];r[0]+=(Math.sqrt(t*t+n*n+a*a)/i-r[0])*(1-Math.exp(-i/.12))}r[1]=e.x,r[2]=e.y,r[3]=e.z,this.hasPrev=!0,n?this.calm=!1:this.calm?r[0]>Ru.calmAbove&&(this.calm=!1):r[0]<Ru.calmBelow&&(this.calm=!0)}},Bu=class{ins={top:0,right:0,bottom:0,left:0};lensX=0;lensY=0;goalX=0;goalY=0;wantScale=0;top=0;bottom=0;left=0;right=0;fitY=0;fitX=0;bodies=0;fresh=!0;any=!1;B=new Float64Array(4);cfg=new Float64Array(5);acc=new Float64Array(4);w=new Float64Array(8);cam=[];hp=new Float64Array(15);vp=[];setInsets(e){let t=this.any;for(let t of[`top`,`right`,`bottom`,`left`]){let n=e[t];typeof n==`number`&&Number.isFinite(n)&&(this.ins[t]=Math.max(0,n))}this.any=this.ins.top+this.ins.right+this.ins.bottom+this.ins.left>0,!t&&this.any&&(this.fresh=!0)}get on(){return Ru.enabled&&this.any}reset(){this.fresh=!0,this.clear()}band(e,t){let n=this.ins.top,r=this.ins.bottom,i=this.ins.left,a=this.ins.right,o=n+r>(1-Ru.minBand)*t?(1-Ru.minBand)*t/(n+r):1,s=i+a>(1-Ru.minBand)*e?(1-Ru.minBand)*e/(i+a):1;n*=o,r*=o,i*=s,a*=s;let c=this.B;return c[0]=1-2*n/t,c[1]=-1+2*r/t,c[2]=-1+2*i/e,c[3]=1-2*a/e,c}clear(){this.wantScale=0,this.goalX=0,this.goalY=0,this.bodies=0,this.fitX=0,this.fitY=0}ndc(){let e=this.cam,t=this.w,n=this.cfg,r=t[0],i=t[1],a=t[2],o=e[2]*r+e[6]*i+e[10]*a+e[14];if(!(o<-.01))return!1;let s=1/-o;return t[3]=n[0]*(e[0]*r+e[4]*i+e[8]*a+e[12])*s,t[4]=n[1]*(e[1]*r+e[5]*i+e[9]*a+e[13])*s,t[5]=s,!0}load(e,t){let n=this.w;n[0]=e[t],n[1]=e[t+1],n[2]=e[t+2]}addDisc(){if(!this.ndc())return;let e=this.w,t=this.cfg,n=this.acc,r=t[1]*e[6]*e[5],i=t[0]*e[6]*e[5];e[4]+r>n[0]&&(n[0]=e[4]+r),e[4]-r<n[1]&&(n[1]=e[4]-r),e[3]-i<n[2]&&(n[2]=e[3]-i),e[3]+i>n[3]&&(n[3]=e[3]+i)}pull(e,t,n,r,i){let a=this.hp,o=this.vp,s=t*3,c=this.w,l=this.cfg,u=1;if(!i){this.load(o,e);let t=this.ndc()?c[3+r]:NaN;c[0]=a[s],c[1]=a[s+1],c[2]=a[s+2];let i=this.ndc()?c[3+r]:-n*(1/0);u=n*t>=n*i?l[2]:l[3]}a[s]+=(o[e]-a[s])*u,a[s+1]+=(o[e+1]-a[s+1])*u,a[s+2]+=(o[e+2]-a[s+2])*u}measure(e,t,n,r,i,a){let o=Ru,s=this.fresh,c=this.cfg,l=this.acc,u=this.w;this.cam=t.e,c[0]=t.p0,c[1]=t.p5,c[2]=1-Math.exp(-a/o.tauOut),c[3]=1-Math.exp(-a/o.tauIn),c[4]=a,l[0]=-1/0,l[1]=1/0,l[2]=1/0,l[3]=-1/0;let d=0,f=null,p=0,m=0,h=!0;for(let t of e){if(!t.visible)continue;let e=t.proxy.piece;if(!t.isPiece||!e||f!==null&&e.whole.restLocal!==f){h=!1;break}f=e.whole.restLocal,m=e.whole.radius,p++}let g=h&&p>=2,_=this.gc;_[0]=0,_[1]=0,_[2]=0,_[3]=0;for(let t of e){if(!t.visible)continue;let n=t.hold,r=n.p,i=t.proxy.positions,a=t.proxy.vertexCount*3,o=t.proxy.center,f=t.proxy.metrics;if(d++,s&&(n.ready=!1),n.gate(o,c,(f.fingers??0)>0||f.carried===!0),n.ready&&n.calm&&n.skip>0&&e.length>=Ru.scanFrom)n.skip--;else if(!n.ready||n.calm){n.skip=e.length>=Ru.scanFrom?Ru.scanEvery-1-(n.ready?0:d%Ru.scanEvery):0;let t=this.cam,s=c[0],l=c[1],u=-1,f=-1,p=-1,m=-1,h=-1/0,g=1/0,_=1/0,v=-1/0;for(let e=0;e<a;e+=3){let n=i[e],r=i[e+1],a=i[e+2],o=t[2]*n+t[6]*r+t[10]*a+t[14];if(!(o<-.01))continue;let c=1/-o,d=l*(t[1]*n+t[5]*r+t[9]*a+t[13])*c,y=s*(t[0]*n+t[4]*r+t[8]*a+t[12])*c;d>h&&(h=d,u=e),d<g&&(g=d,f=e),y<_&&(_=y,p=e),y>v&&(v=y,m=e)}let y=!n.ready;u>=0&&(this.hp=r,this.vp=i,this.pull(u,0,1,1,y),this.pull(f,1,-1,1,y),this.pull(p,2,-1,0,y),this.pull(m,3,1,0,y));let b=y?1:c[2];r[12]+=(o.x-r[12])*b,r[13]+=(o.y-r[13])*b,r[14]+=(o.z-r[14])*b,n.ready=!0}if(u[0]=r[0],u[1]=r[1],u[2]=r[2],this.ndc()&&u[4]>l[0]&&(l[0]=u[4]),u[0]=r[3],u[1]=r[4],u[2]=r[5],this.ndc()&&u[4]<l[1]&&(l[1]=u[4]),u[0]=r[6],u[1]=r[7],u[2]=r[8],this.ndc()&&u[3]<l[2]&&(l[2]=u[3]),u[0]=r[9],u[1]=r[10],u[2]=r[11],this.ndc()&&u[3]>l[3]&&(l[3]=u[3]),u[0]=r[12],u[1]=r[13],u[2]=r[14],u[6]=t.proxy.restRadius*t.growth,this.addDisc(),g){let e=typeof t.proxy.frac==`number`&&t.proxy.frac>0?t.proxy.frac:1;_[0]+=r[12]*e,_[1]+=r[13]*e,_[2]+=r[14]*e,_[3]+=e,d===p&&m>0&&_[3]>0&&(u[0]=_[0]/_[3],u[1]=_[1]/_[3],u[2]=_[2]/_[3],u[6]=m,this.addDisc())}}this.bodies=d;let v=l[0],y=l[1],b=l[2],x=l[3];if(d===0||!(v>y)){this.clear();return}this.top=v,this.bottom=y,this.left=b,this.right=x;let S=this.band(n,r),C=2*Math.max(o.marginMin,o.marginFrac*r)/r,w=2*Math.max(o.marginMin,o.marginFrac*n)/n,T=this.ins.left+this.ins.right>0||d>=Ru.sideFitFrom;this.fitY=(v-y)/Math.max(.05,S[0]-S[1]-2*C),this.fitX=T?(x-b)/Math.max(.05,S[3]-S[2]-2*w):0;let E=Math.max(this.fitY,this.fitX);this.wantScale=E>1?Math.min(o.maxScale,E*i):0,this.goalY=Math.max(-.7,Math.min(.7,(S[0]+S[1])/2-(v+y)/2)),this.goalX=T?Math.max(-.7,Math.min(.7,(S[2]+S[3])/2-(b+x)/2)):0}gc=new Float64Array(4);ease(e){if(this.lensX===0&&this.lensY===0&&this.goalX===0&&this.goalY===0&&!(this.fresh&&this.bodies>0))return!1;let t=this.fresh&&this.bodies>0?1:1-Math.exp(-e*Ru.lensRate*(this.bodies>0?1:.35));this.bodies>0&&(this.fresh=!1);let n=this.lensX,r=this.lensY;return this.lensX+=(this.goalX-this.lensX)*t,this.lensY+=(this.goalY-this.lensY)*t,Math.abs(this.lensX)<1e-5&&(this.lensX=0),Math.abs(this.lensY)<1e-5&&(this.lensY=0),this.lensX!==n||this.lensY!==r}};function Vu(e){let t=e.cells[0]?.[0];if(!t)return 0;let n=2654435769^Math.imul(t.id|0,2246822507);for(let e of[Math.round(t.n.x*1e4),Math.round(t.n.y*1e4),Math.round(t.n.z*1e4)])n=Math.imul(n^(e|0),3266489909),n^=n>>>15;return n|0}function Hu(e,t,n,r,i,a,o,s,c,l,u,d,f){let p=o-r,m=s-i,h=c-a,g=l-r,_=u-i,v=d-a,y=e-r,b=t-i,x=n-a,S=p*y+m*b+h*x,C=g*y+_*b+v*x,w=1,T=0,E=0,D=()=>{f[0]=w,f[1]=T,f[2]=E;let p=w*r+T*o+E*l-e,m=w*i+T*s+E*u-t,h=w*a+T*c+E*d-n;return p*p+m*m+h*h};if(S<=0&&C<=0)return D();let O=e-o,k=t-s,A=n-c,j=p*O+m*k+h*A,M=g*O+_*k+v*A;if(j>=0&&M<=j)return w=0,T=1,E=0,D();let N=S*M-j*C;if(N<=0&&S>=0&&j<=0){let e=S/(S-j);return w=1-e,T=e,E=0,D()}let P=e-l,F=t-u,I=n-d,L=p*P+m*F+h*I,ee=g*P+_*F+v*I;if(ee>=0&&L<=ee)return w=0,T=0,E=1,D();let te=L*C-S*ee;if(te<=0&&C>=0&&ee<=0){let e=C/(C-ee);return w=1-e,T=0,E=e,D()}let ne=j*ee-L*M;if(ne<=0&&M-j>=0&&L-ee>=0){let e=(M-j)/(M-j+(L-ee));return w=0,T=1-e,E=e,D()}let re=1/(ne+te+N);return T=te*re,E=N*re,w=1-T-E,D()}function Uu(e,t,n,r,i,a,o,s){let c=1/0,l=n.length?n[0]:0,u=1/3,d=1/3,f=1/3;for(let o=0;o<n.length;o++){let p=n[o],m=t[p*3]*3,h=t[p*3+1]*3,g=t[p*3+2]*3,_=Hu(r,i,a,e[m],e[m+1],e[m+2],e[h],e[h+1],e[h+2],e[g],e[g+1],e[g+2],s);_<c&&(c=_,l=p,u=s[0],d=s[1],f=s[2])}return o.tri=l,o.u=u,o.v=d,o.w=f,Math.sqrt(c)}function Wu(e,t,n,r,i){let a=r.planes,o=a.length,s=n.offset,c=[0,0,0],l=i.radius,u=i.rho,d=[];for(let n=0;n<2;n++){let f=i.eyes[n],p=f.centre,m=-1/0,h=[];for(let e=0;e<o;e++){let t=a[e],n=t.n.x*p.x+t.n.y*p.y+t.n.z*p.z-t.d;h.push(n),n>m&&(m=n)}let g=o===0?1:Math.min(1,Math.max(0,(u-m)/(2*u)));if(g<.12)continue;let _=[];for(let e=0;e<o;e++)h[e]>-u&&_.push(e);_.sort((e,t)=>h[t]-h[e]);let v=_.slice(0,2),y=f.qFlat.x-s.x,b=f.qFlat.y-s.y,x=f.qFlat.z-s.z,S={tri:0,u:0,v:0,w:0};Uu(e,t,r.skinTris,y,b,x,S,c);let C=t[S.tri*3]*3,w=t[S.tri*3+1]*3,T=t[S.tri*3+2]*3,E=S.u*e[C]+S.v*e[w]+S.w*e[T],D=S.u*e[C+1]+S.v*e[w+1]+S.w*e[T+1],O=S.u*e[C+2]+S.v*e[w+2]+S.w*e[T+2],k=y-E,A=b-D,j=x-O,M=Math.sqrt(k*k+A*A+j*j),N=v.length===0&&M>=.01*l;N||(k=0,A=0,j=0);let P=[],F=[];for(let n=0;n<4;n++){let i=f.footFlat[n].x,l=f.footFlat[n].y,u=f.footFlat[n].z,d=!0;for(let e=0;e<o;e++){let t=a[e];if(t.n.x*i+t.n.y*l+t.n.z*u-t.d>.1*f.dist){d=!1;break}}let p={tri:0,u:0,v:0,w:0};Uu(e,t,r.skinTris,i-s.x,l-s.y,u-s.z,p,c),P.push(p),F.push(d)}d.push({slot:n,f:g,hit:S,foot:P,footOk:F,off:{x:k,y:A,z:j},hasOff:N,offRaw:M,clip:v,restCentre:{x:p.x-s.x,y:p.y-s.y,z:p.z-s.z},frame:f.frame})}return{ref:i,eyes:d,salt:Vu(n)}}var Gu=new X(-.68,.62,.4).normalize(),Ku=new X(.62,.26,-.74).normalize(),qu=new X(.78,.18,.6).normalize(),Ju=`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`,Yu=`
varying vec2 vUv;
uniform vec3 uColor;
uniform vec2 uSize;
uniform float uSoft;
uniform float uRadius;
void main() {
  vec2 q = abs(vUv - 0.5) * uSize - (uSize * 0.5 - uRadius);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float a = smoothstep(0.0, -uSoft, d);
  float core = 0.7 + 0.3 * smoothstep(-uSoft * 3.0, -uSoft * 0.2, d);
  gl_FragColor = vec4(uColor * a * core, 1.0);
}
`,Xu=`
varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`,Zu=`
varying vec3 vDir;
void main() {
  float e = vDir.y;
  vec3 floorC = vec3(0.012, 0.008, 0.03);
  vec3 hor = vec3(0.07, 0.035, 0.12);
  vec3 top = vec3(0.03, 0.02, 0.07);
  // one smooth gradient with a soft horizon glow (no kink at e = 0: a kink reflects as a hard straight line in flat glossy areas)
  vec3 g = mix(floorC, top, smoothstep(-0.6, 0.9, e));
  vec3 c = g + (hor - g) * exp(-e * e * 14.0);
  // faint warm wash behind the key side, faint cool wash on the rim side
  c += vec3(0.16, 0.08, 0.03) * pow(max(dot(vDir, normalize(vec3(-0.5, 0.35, 0.8))), 0.0), 6.0);
  c += vec3(0.02, 0.09, 0.11) * pow(max(dot(vDir, normalize(vec3(0.6, 0.2, -0.75))), 0.0), 5.0);
  gl_FragColor = vec4(c, 1.0);
}
`,Qu=[{dir:Gu,dist:4.5,w:2.4,h:1.7,color:[1,.74,.42],k:6.5,soft:.6,radius:.75,roll:.25},{dir:new X(-.93,.28,.1).normalize(),dist:4.5,w:.75,h:3,color:[1,.8,.58],k:6,soft:.14,radius:.3,roll:.12},{dir:new X(.12,1,.2).normalize(),dist:4.5,w:4.2,h:.7,color:[1,.86,.66],k:5.5,soft:.2,radius:.3},{dir:Ku,dist:4.5,w:.8,h:3.6,color:[.28,.82,.95],k:12,soft:.16,radius:.35,roll:-.18},{dir:qu,dist:4.5,w:2.4,h:2.4,color:[.5,.36,.92],k:.55,soft:1.1,radius:1},{dir:new X(-.8,-.05,-.55).normalize(),dist:4.5,w:1.6,h:.5,color:[.3,.7,.9],k:2.2,soft:.2,radius:.2}];function $u(e,t=256){let n=new Sn,r=[],i=[],a=new Li(30,24,16),o=new qi({vertexShader:Xu,fragmentShader:Zu,side:1,depthWrite:!1,toneMapped:!1});r.push(a),i.push(o),n.add(new ai(a,o));let s=new X(0,1,0);for(let e of Qu){let t=new Ii(1,1),a=new qi({vertexShader:Ju,fragmentShader:Yu,side:2,depthWrite:!1,toneMapped:!1,uniforms:{uColor:{value:new X(e.color[0]*e.k,e.color[1]*e.k,e.color[2]*e.k)},uSize:{value:new Y(e.w,e.h)},uSoft:{value:e.soft},uRadius:{value:e.radius}}});r.push(t),i.push(a);let o=new ai(t,a);o.scale.set(e.w,e.h,1),o.position.copy(e.dir).multiplyScalar(e.dist),o.up.copy(Math.abs(e.dir.y)>.95?new X(0,0,-1):s),o.lookAt(0,0,0),e.roll&&o.rotateZ(e.roll),n.add(o)}let c=new Do(e),l=c.fromScene(n,.035,.1,100,{size:t});c.dispose();for(let e of r)e.dispose();for(let e of i)e.dispose();return{texture:l.texture,dispose:()=>l.dispose()}}var ed=class{texture;env;size;users=new Set;constructor(e,t=128){this.size=t,this.env=$u(e,t),this.texture=this.env.texture}apply(e,t){e.envMap=this.texture,e.envMapIntensity=t,this.users.add(e)}release(e){this.users.delete(e)}rebuild(e){this.env=$u(e,this.size),this.texture=this.env.texture;for(let e of this.users)e.envMap=this.texture}dispose(){this.env.dispose(),this.users.clear()}},td={plain:0,speckle:1,swirl:2,bands:3},nd=e=>new Q().setRGB(e[0],e[1],e[2],We);function rd(e){return[.75+e[0]*.25,.62*.75+e[1]*.25,.255+e[2]*.25]}function id(e){let t=Math.max(0,Math.min(1,(.6-e.translucency)/.5));return{rough:Math.max(.05,Math.min(.95,e.roughness+.03)),coat:1-.9*t,tint:.05+.4*t,depth:1-.7*t,glow:1-.5*t}}var ad=`
attribute float aStrain;
attribute vec3 aRest;
attribute vec2 aDisp;
attribute vec2 aCap;
attribute vec3 aCapP;
attribute float aCapD;
varying vec2 vCap;
varying vec3 vCapP;
varying float vCapD;
varying vec2 vDisp;
varying float vStrain;
varying vec3 vRest;
varying vec3 vWPos;
`,od=`
#include <begin_vertex>
vStrain = aStrain;
vDisp = aDisp;
vRest = aRest;
vCap = aCap;
vCapP = aCapP;
vCapD = aCapD;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`,sd=`
varying float vStrain;
varying vec2 vDisp;
varying vec3 vRest;
varying vec3 vWPos;
varying vec2 vCap;
varying vec3 vCapP;
varying float vCapD;
uniform float uCapRough, uCapCoat, uCapTint, uCapDepth, uCapGlow;
uniform float uTime, uCompress, uStretch, uBlushAmt, uPatStrength, uCoreAmt, uCoreRadius, uRimAmt, uScatter, uAlphaBase;
uniform vec3 uBlushCol, uPaleCol, uPatA, uPatB, uRimCol, uGlowCol, uKeyCol, uCoreCol, uSeed, uRimDir, uKeyDir, uCoreWorld;
uniform float uAurora, uIri, uTwoTone, uTierAmt, uTierTint, uMixAmt;
uniform vec3 uTone2Col, uTierCol, uMixCol;
uniform vec4 uTouch0, uTouch1;
uniform float uTouchR, uGrain, uGrainFreq, uPaleMul, uBeads;
uniform vec3 uWB, uTouchCol;
uniform vec4 uSeam, uSpot;
uniform float uSeamAmt, uSeamW, uSpotR;
uniform vec3 uSeamCol;
vec3 jBumpN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
float jCap = 0.0;
float jBlush = 0.0;
float jTwo = 0.0;
float jPale = 0.0;
float jMix = 0.0;
${Bl}
float jBeadH(vec3 q) {
  vec3 c = floor(q), f = fract(q);
  vec3 r = whHash33(c);
  float d = length(f - (0.4 + 0.2 * r)) / (0.3 + 0.1 * r.z);
  return sqrt(max(0.0, 1.0 - d * d));
}
float jSpeckleLayer(vec3 d, float scale, float seed) {
  vec3 q = d * scale + seed;
  vec3 c = floor(q);
  vec3 f = fract(q);
  vec3 r = whHash33(c);
  vec3 ctr = 0.32 + 0.36 * r;
  float rad = 0.12 + 0.14 * fract(r.x * 7.31);
  float on = step(0.45, fract(r.y * 13.7));
  return on * (1.0 - smoothstep(rad * 0.55, rad, length(f - ctr)));
}
`,cd=`
#include <color_fragment>
  jCap = vCap.x > 0.5 ? 1.0 : 0.0;   // constant over a triangle (a fine triangle never straddles two classes)
#if WH_PATTERN == 1
  float jSp = max(jSpeckleLayer(vRest, 5.5, uSeed.x * 17.0), 0.85 * jSpeckleLayer(vRest + 3.1, 9.5, uSeed.y * 17.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, uPatB, jSp * uPatStrength);
#elif WH_PATTERN == 2
  float jAng = atan(vRest.z, vRest.x);
  float jSw = sin(jAng * 3.0 + (1.0 - vRest.y) * 7.0 + uSeed.x * 6.2832 + 1.1 * whNoise3(vRest * 3.0 + uSeed * 9.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, uPatA, smoothstep(0.05, 0.5, jSw) * uPatStrength);
#elif WH_PATTERN == 3
  float jBd = sin(vRest.y * 10.0 + 1.4 * whNoise3(vRest * 2.5 + uSeed * 9.0) + uSeed.y * 6.2832);
  diffuseColor.rgb = mix(diffuseColor.rgb, uPatA, smoothstep(0.15, 0.55, jBd) * uPatStrength);
#endif
  // rarity: Epic's two-tone gradient body (a second hue blooms toward the top). The diffuse mix alone barely shows on a translucent body
  // (the transmission carries its colour) or on a frosted one (the glow does): jTwo also tints the absorption and adds a little light
  jTwo = 0.7 * uTwoTone * smoothstep(-0.15, 0.85, vRest.y + 0.3 * whNoise3(vRest * 2.0 + uSeed * 5.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, uTone2Col, jTwo);
  // merge ceremony: the parents' colours swirl together (lineage)
  float jMixSw = smoothstep(-0.2, 0.6, sin(atan(vRest.z, vRest.x) * 2.0 + vRest.y * 6.0 + uTime * 0.9 + 1.3 * whNoise3(vRest * 2.5)));
  jMix = uMixAmt * jMixSw;
  diffuseColor.rgb = mix(diffuseColor.rgb, uMixCol, jMix);
{
  // strain < 1 = compressed edges; the dent depth term catches local presses (edge lengths barely change in a dent)
  float jComp = max(clamp((1.0 - vStrain) * 5.0, 0.0, 1.0), smoothstep(0.0, 0.8, vDisp.x));
  float jStr = max(clamp((vStrain - 1.0) * 4.0, 0.0, 1.0), 0.8 * smoothstep(0.1, 0.9, vDisp.y));
  jBlush = clamp((jComp + uCompress * 0.55) * uBlushAmt, 0.0, 1.0);
  jPale = clamp((jStr + uStretch * 0.5) * uBlushAmt * uPaleMul, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uBlushCol, jBlush * 0.75);
  diffuseColor.rgb = mix(diffuseColor.rgb, uPaleCol, jPale * 0.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, uPaleCol, jCap * uCapTint);   // a cut face: the paler inside of the squishy
  diffuseColor.rgb = mix(diffuseColor.rgb, uTierCol, uTierTint);
  diffuseColor.rgb *= uWB;
}
`,ld=`
float jNdv0 = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
float jThick = (0.32 + 0.68 * jNdv0) * (1.0 - 0.55 * jPale + 0.12 * jBlush);
float jThickCap = clamp(0.25 + 0.75 * vCapD * uCapDepth, 0.2, 1.0) * (1.0 - 0.55 * jPale + 0.12 * jBlush);   // a cut face is a window as deep as the piece behind it (aCapD)
jThick = mix(jThick, jThickCap, jCap);
float jAtt = (1.0 + 1.8 * jPale) / (1.0 + 0.9 * jBlush);
${io.transmission_fragment.replace(`material.attenuationColor = attenuationColor;`,`material.attenuationColor = min(mix(mix(attenuationColor, uTone2Col, jTwo), uTierCol, uTierTint) * uWB, vec3(1.0));`).replace(`material.thickness = thickness;`,`material.thickness = thickness * jThick;`).replace(`material.attenuationDistance = attenuationDistance;`,`material.attenuationDistance = attenuationDistance * jAtt;`)}
`,ud=`
{
  vec3 jV = normalize(cameraPosition - vWPos);
  vec3 jN = transformNormalByInverseViewMatrix(normal, viewMatrix);
  float jNdv = clamp(dot(jN, jV), 0.0, 1.0);
  float jFres = pow(1.0 - jNdv, 3.4);
  float jRimSide = clamp(dot(jN, uRimDir) * 0.6 + 0.5, 0.0, 1.0);
  vec3 jRim = (uRimCol * (0.08 + 2.2 * jRimSide * jRimSide) + uGlowCol * 0.4) * jFres * uRimAmt;
  float jWrap = clamp((dot(jN, uKeyDir) + 0.55) / 1.55, 0.0, 1.0);
  vec3 jScat = diffuseColor.rgb * uKeyCol * (0.18 + 0.82 * jWrap * jWrap) * uScatter * (1.0 - 0.5 * jFres);
  #ifdef WH_LOW
    jScat *= 0.35;
  #endif
  vec3 jRd = -jV;
  vec3 jToC = uCoreWorld - vWPos;
  float jAlong = dot(jToC, jRd);
  vec3 jPerp = jToC - jRd * jAlong;
  float jHalo = exp(-dot(jPerp, jPerp) / (uCoreRadius * uCoreRadius)) * smoothstep(-0.1, 0.25, jAlong);
  // soft knee above 0.45: a bright (high-tier, high-coreGlow, squeezed) core keeps rising but saturates in its own hue, never clips to white
  float jC = jHalo * uCoreAmt;
  jC = jC < 0.45 ? jC : 0.45 + (jC - 0.45) / (1.0 + (jC - 0.45) / 0.35);
  // the core's light reaches the skin THROUGH the jelly: its crisp heart keeps the core colour, the wide fringe takes on the body's own
  // hue (a gold heart in a ruby goo reads ruby around it, not orange all over; RENDER-3 gallery: bright cores had turned every warm
  // Legendary into the same orange fireball)
  vec3 jBodyN = diffuseColor.rgb / max(max(diffuseColor.r, diffuseColor.g), max(diffuseColor.b, 1e-3));
  vec3 jCore = uCoreCol * jC * (0.55 + 0.45 * jNdv) * mix(jBodyN, vec3(1.0), 0.35 + 0.65 * jHalo);
  vec3 jExtra = vec3(0.0);
  if (uAurora > 0.001) {          // Legendary: slow aurora CURTAINS drifting inside the body, sodium amber low -> rose -> lagoon high
    float jw = whNoise3(vRest * 1.5 + vec3(0.0, uTime * 0.05, uTime * 0.03));
    float jcur = 0.5 + 0.5 * sin(atan(vRest.z, vRest.x) * 3.0 + 2.4 * jw + vRest.y * 1.5 + uTime * 0.12);
    jcur = jcur * jcur * jcur;                                                   // soft folds, no hard stripe edges
    float jh = smoothstep(-0.6, 0.1, vRest.y) * (1.0 - smoothstep(0.45, 1.0, vRest.y));
    float jg = clamp(vRest.y * 0.8 + 0.45 + 0.25 * jw, 0.0, 1.0);
    vec3 jaur = mix(vec3(1.0, 0.5, 0.06), vec3(1.0, 0.22, 0.42), smoothstep(0.0, 0.55, jg));
    jaur = mix(jaur, vec3(0.12, 0.8, 0.78), smoothstep(0.5, 1.0, jg));
    jExtra += jaur * jcur * jh * (0.08 + 0.26 * (1.0 - jFres)) * uAurora;
  }
  if (uIri > 0.001) {             // Mythic: thin-film iridescence, the hue slides with the view angle
    vec3 jfilm = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + jNdv * 1.35 + vRest.y * 0.25 + uTime * 0.03));
    jExtra += jfilm * (0.08 + 0.9 * jFres) * 0.55 * uIri;
    totalSpecular *= mix(vec3(1.0), 0.55 + jfilm, 0.6 * uIri);
  }
  jExtra += uTone2Col * jTwo * (0.1 + 0.25 * (1.0 - jFres));            // Epic two-tone: the second hue also glows a little from inside
  // contact glow (stage B5, "touch the light"): a soft bloom of the CORE's colour where a fingertip presses, on top of the pressure blush
  vec3 jTd0 = vWPos - uTouch0.xyz, jTd1 = vWPos - uTouch1.xyz;
  float jTouch = uTouch0.w * exp(-dot(jTd0, jTd0) / (uTouchR * uTouchR)) + uTouch1.w * exp(-dot(jTd1, jTd1) / (uTouchR * uTouchR));
  jTouch = min(jTouch, 1.2);
  // (kept apart from the jelly's own light: the low tier's deepen / saturate pass below must not recolour it, it is the same bloom on every tier)
  vec3 jTouchE = mix(uTouchCol, vec3(1.0, 0.95, 0.85), 0.35 * jTouch) * jTouch * (0.5 + 0.5 * jNdv) * 1.15;
  // CUT: a thin warm seam along the cut plane (a band, brightest at its centre line) and the bridge's glow spot; zero when unused
  float jSeamD = (dot(vWPos, uSeam.xyz) - uSeam.w) / max(uSeamW, 1e-4);
  vec3 jSd = vWPos - uSpot.xyz;
  // the seam: a hot thin core line with a soft warm falloff either side, brightest where the skin faces you
  float jSeam = uSeamAmt * (exp(-jSeamD * jSeamD) + 0.3 * exp(-jSeamD * jSeamD / 9.0)) + uSpot.w * exp(-dot(jSd, jSd) / max(uSpotR * uSpotR, 1e-6));
  jSeam *= 1.0 - jCap;   // the skin seam band is never drawn on a cut face
  jTouchE += uSeamCol * min(jSeam, 1.3) * (0.55 + 0.45 * jNdv) * 2.4;
  jExtra += uGlowCol * jCap * pow(clamp(vCap.y, 0.0, 1.0), 3.0) * 0.5 * uCapGlow;   // the rim of a cut face catches the light
  jExtra += uTierCol * uTierAmt * (0.25 + 0.9 * jFres + 0.5 * jHalo);   // the tier "tell": light drifting toward the result colour
  jExtra += uMixCol * jMix * (0.16 + 0.3 * (1.0 - jFres));             // merge lineage: the other parents' colours swirl through as light
  totalEmissiveRadiance += jRim + jScat + jCore + jExtra;
  #ifdef WH_LOW
    // low tier: no transmission target, so the body carries its own colour (a base glow) and is only lightly see-through
    totalDiffuse *= 0.16;   // the transmissive tiers keep only ~10% of the direct diffuse; the glow below stands in for the rest
    // fake depth for the transmission-less tier: a thick centre is deeper and more saturated, and the core glows through it
    // (the fake depth deepens the body's OWN hue: it leaned fully on the blush colour, whose hue differs from the body's for many species, so the whole body took the blush hue on
    // the phone: pink dough coral, crimson jelly violet, cream beads ochre. A third of blush is kept: it is the pressed-skin warmth.)
    vec3 jDeepCol = mix(diffuseColor.rgb, uBlushCol, 0.35);
    totalEmissiveRadiance += (diffuseColor.rgb * (0.2 + 0.16 * jWrap) + jDeepCol * (0.34 * pow(jNdv, 1.4)) * (1.0 - 0.35 * jWrap)) * 0.68;
    float jLow = smoothstep(0.45, -0.7, vRest.y) * (1.0 - 0.5 * jFres);   // the lower body is where the core glow sits behind thick jelly
    vec3 jDeep = jDeepCol / max(max(jDeepCol.r, jDeepCol.g), max(jDeepCol.b, 1e-3));
    totalEmissiveRadiance = mix(totalEmissiveRadiance, totalEmissiveRadiance * jDeep * 1.15, 0.85 * jLow);
    // without the transmission pass's absorption the glow reads paler than med/high at the same pose (measured +8..12% in G and B):
    // a saturation lift on the jelly's own light closes most of that gap for free (specular highlights stay white)
    totalEmissiveRadiance = max(mix(vec3(dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722))), totalEmissiveRadiance, 1.0 + 0.3 * (1.0 - jLow)), 0.0);
    float jSpec = dot(totalSpecular, vec3(0.3333));
    diffuseColor.a = clamp(mix(uAlphaBase, 1.0, jFres) + jSpec * 0.45 + 0.1 * jCap, 0.0, 1.0);   // (a face is a little more opaque: the window must not look empty)
  #endif
  totalEmissiveRadiance += jTouchE;
}
vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
`;function dd(e,t=0){let n=i(e.species),r=n?o(n.family):1;return Math.max(0,Math.min(1,r,(Number.isFinite(e.translucency)?e.translucency:0)+t))}function fd(e){return i(e.species)?.family??`jellygel`}var pd={slowrise:30,marshmallow:18,mochidough:22,putty:26,beadsqueeze:6,firmsilicone:30,popdome:20},md=`
#include <normal_fragment_maps>
#define GRAIN_AMP 0.022
if (uGrain > 0.001 && jCap < 0.5) {
  vec3 jq = vRest * uGrainFreq;
  // fade the grain out before it aliases (cells smaller than ~3 px: a far or small body, the phone's low tier)
  float jFade = 1.0 - smoothstep(0.2, 0.45, length(fwidth(jq)));
  if (jFade > 0.0) {
    // height in world units, slope = its screen derivative over the surface's own screen derivative (a real bump, any distance)
    // pores / powder: two octaves of noise; a bead bed: round caps, one per cell (beads pressing up under the skin)
    float jH = uBeads > 0.5 ? jBeadH(jq) * 1.6 : whNoise3(jq) + 0.5 * whNoise3(jq * 2.3 + 4.1);
    jH *= uGrain * uCoreRadius * GRAIN_AMP * jFade;
    vec3 jPx = dFdx(-vViewPosition), jPy = dFdy(-vViewPosition);
    vec2 jdH = vec2(dFdx(jH) / max(length(jPx), 1e-6), dFdy(jH) / max(length(jPy), 1e-6));
    normal = jBumpN(-vViewPosition, normal, jdH, faceDirection);
  }
}
`,hd=[1,.74,.42],gd=.3,_d=.3;function vd(e,t){let n=hd[0]**+-e,r=hd[1]**+-e,i=hd[2]**+-e,a=.2126*n+.7152*r+.0722*i;return t.set(n/a,r/a,i/a)}var yd=class{uniforms;genome;palette;scale;full=null;low=null;hub;style;pattern;look;familyId;tack;stringiness;opacityKeep=1;famKeep;constructor(e,n,r,i,s){this.hub=i,this.genome=e;let l=fd(e);this.familyId=l;let d=c(l,e);this.look=d.look,this.tack=d.physics.tack,this.stringiness=d.physics.stringiness;let p=o(l),m=u(l)?a[l].look.translucency:.82;this.famKeep=p<1?gd+.7*Math.max(0,Math.min(1,(p-.3)/.7)):1-.5*Math.max(0,Math.min(1,(.6-m)/.35)),this.style=s,this.pattern=td[e.pattern]??0,this.pattern===0&&s.swirlFloor>0&&(this.pattern=2);let h=t(e.seed^1597463007),g=this.patternStrength();this.uniforms={uTime:{value:0},uCompress:{value:0},uStretch:{value:0},uBlushAmt:{value:1},uPatStrength:{value:g},uCoreAmt:{value:.5+e.coreGlow*.9},uCoreRadius:{value:.3*r},uRimAmt:{value:.8},uScatter:{value:.2+.2*dd(e)},uAlphaBase:{value:.94-.07*dd(e)},uBlushCol:{value:nd(n.blush)},uPaleCol:{value:nd(n.pale)},uPatA:{value:nd(n.patA)},uPatB:{value:nd(n.patB)},uRimCol:{value:new Q(5887718)},uGlowCol:{value:nd(n.glow)},uKeyCol:{value:new Q(16757575)},uCoreCol:{value:nd(n.core)},uSeed:{value:new X(h(),h(),h())},uRimDir:{value:Ku.clone()},uKeyDir:{value:Gu.clone()},uCoreWorld:{value:new X},uAurora:{value:0},uIri:{value:0},uTwoTone:{value:0},uTone2Col:{value:nd(n.tone2)},uTierCol:{value:nd(s.tell)},uTierAmt:{value:0},uTierTint:{value:0},uMixCol:{value:nd(n.body)},uMixAmt:{value:0},uTouch0:{value:new Pt(0,-10,0,0)},uTouch1:{value:new Pt(0,-10,0,0)},uTouchR:{value:.12*r},uGrain:{value:0},uGrainFreq:{value:24},uPaleMul:{value:1},uBeads:{value:+(l===`beadsqueeze`)},uWB:{value:new X(1,1,1)},uTouchCol:{value:nd(f(e).core)},uSeam:{value:new Pt(0,1,0,-100)},uSeamAmt:{value:0},uSeamW:{value:.03*r},uSeamCol:{value:nd(rd(f(e).core))},uSpot:{value:new Pt(0,-10,0,0)},uSpotR:{value:.15*r},uCapRough:{value:.12},uCapCoat:{value:1},uCapTint:{value:0},uCapDepth:{value:1},uCapGlow:{value:1}},this.palette=n,this.scale=r,this.applyStyleUniforms()}patternStrength(){let e=this.genome,t=td[e.pattern]??0;if(t===0)return this.style.swirlFloor;let n=t===1?.6+.4*e.speckle:.4+.6*e.speckle;return Math.max(n,this.style.swirlFloor*.8)}applyStyleUniforms(){let e=this.uniforms,t=this.style,n=this.genome,r=this.look;e.uRimAmt.value=.8*t.rim*(1+.35*r.fuzz),e.uBlushAmt.value=t.blush*Math.min(1.15,Math.max(.25,r.blush/.85)),e.uPaleMul.value=Math.min(1.3,Math.max(.2,r.stretchPale/.75)),e.uGrain.value=r.grain,e.uGrainFreq.value=pd[this.familyId]??24;{let t=id(r);e.uCapRough.value=t.rough,e.uCapCoat.value=t.coat,e.uCapTint.value=t.tint,e.uCapDepth.value=t.depth,e.uCapGlow.value=t.glow}e.uAurora.value=t.aurora,e.uIri.value=t.iri,e.uTwoTone.value=t.twoTone,e.uTierCol.value.setRGB(t.tell[0],t.tell[1],t.tell[2],We);let i=this.palette.core,a=t.coreTint*s(t.tell,this.palette);e.uCoreCol.value.setRGB(i[0]+(t.tell[0]-i[0])*a,i[1]+(t.tell[1]-i[1])*a,i[2]+(t.tell[2]-i[2])*a,We),e.uPatStrength.value=this.patternStrength();let o=dd(n,t.translucencyAdd);e.uScatter.value=.14+.2*o+.1*r.subsurface,this.opacityKeep=this.famKeep*(1-.6*Math.max(0,Math.min(1,(.65-o)/.35)));let c=Math.max(0,Math.min(1,(1-this.opacityKeep)/.7));vd(_d+1*c,e.uWB.value),e.uAlphaBase.value=.94-.07*o+.05*c}setStyle(e){this.style=e,this.pattern=td[this.genome.pattern]??0,this.pattern===0&&e.swirlFloor>0&&(this.pattern=2),this.applyStyleUniforms(),this.dispose()}make(e){let t=this.genome,r=this.palette,i=dd(t,this.style.translucencyAdd),a=t.gloss,o=this.look,s=new Xi({color:nd(r.body),roughness:Math.min(.95,Math.max(.12,n(.58,.32,a)+.6*(o.roughness-.08))),metalness:0,clearcoat:(.45+.55*a)*(1-.6*o.fuzz),clearcoatRoughness:Math.min(.6,n(.3,.07,a)+.3*Math.max(0,o.roughness-.08)*(1-a)),sheen:o.fuzz,sheenRoughness:.55,sheenColor:nd(r.pale),ior:1.42,specularIntensity:1,side:0,fog:!1});this.hub.apply(s,1.25),e?(s.color=nd(r.body).lerp(nd(r.attenuation),.65*this.opacityKeep),s.transparent=!0,s.depthWrite=!1,s.transmission=0,s.clearcoatRoughness=Math.max(s.clearcoatRoughness,.16)):(s.transmission=n(.62,1,i)*this.opacityKeep,s.thickness=(.45+.35*i)*this.scale*o.thickness,s.attenuationColor=nd(r.attenuation),s.attenuationDistance=n(.3,1,i)*this.scale*this.style.attenuation,s.depthWrite=!1);let c={...s.defines??{},WH_PATTERN:this.pattern};e&&(c.WH_LOW=``),s.defines=c;let l=this.uniforms;return s.onBeforeCompile=e=>{Object.assign(e.uniforms,l),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
`+ad).replace(`#include <begin_vertex>`,od),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
`+sd).replace(`#include <color_fragment>`,cd).replace(`#include <roughnessmap_fragment>`,`#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, uCapRough, jCap);   // a cut face: matte-to-glossy by the family (capLookOf)`).replace(`#include <lights_physical_fragment>`,`#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= mix(1.0, uCapCoat, jCap);
#endif`).replace(`#include <normal_fragment_maps>`,md).replace(`#include <transmission_fragment>`,ld).replace(`vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;`,ud).replace(`#include <opaque_fragment>`,`#include <opaque_fragment>
#ifndef WH_LOW
  gl_FragColor.a = 1.0;
#endif`)},s.customProgramCacheKey=()=>`wh-jelly-v5-${this.pattern}-${e?`low`:`full`}`,s}get(e){return Su[e].transmission?this.full??=this.make(!1):this.low??=this.make(!0)}dispose(){this.full&&this.hub.release(this.full),this.low&&this.hub.release(this.low),this.full?.dispose(),this.low?.dispose(),this.full=this.low=null}},bd=`
attribute vec4 aPos;     // xyz, half size
attribute vec4 aVel;     // xyz velocity (streaks), w = kind
attribute vec4 aCol;     // rgb, alpha (already includes the life fade)
varying vec2 vUv;
varying vec4 vCol;
varying float vKind;
void main() {
  vUv = position.xy;
  vCol = aCol;
  vKind = aVel.w;
  vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
  if (aVel.w > 1.5 && aVel.w < 2.5) {
    vec4 mv2 = viewMatrix * vec4(aPos.xyz + aVel.xyz * 0.07, 1.0);
    vec2 dir = mv2.xy - mv.xy;
    float L = length(dir);
    vec2 d = L > 1e-5 ? dir / L : vec2(1.0, 0.0);
    vec2 n = vec2(-d.y, d.x);
    mv.xy -= d * (L * 0.5);
    mv.xy += d * position.x * (aPos.w + L * 0.5) + n * position.y * aPos.w * 0.55;
  } else {
    mv.xy += position.xy * aPos.w;
  }
  gl_Position = projectionMatrix * mv;
}
`,xd=`
varying vec2 vUv;
varying vec4 vCol;
varying float vKind;
uniform float uTime;
uniform float uTwinkle;   // 1 = star points twinkle, 0 = steady (calm effects: no pulses)
void main() {
  vec2 p = vUv;
  float r = length(p);
  float a;
  vec3 tint = vCol.rgb;
  if (vKind < 0.5) {                       // mote
    if (r > 1.0) discard;
    a = exp(-r * r * 5.5) + 0.9 * exp(-r * r * 28.0);
  } else if (vKind < 1.5) {                // star
    if (r > 1.0) discard;
    float star = max(0.0, 1.0 - 7.0 * abs(p.x * p.y)) * (1.0 - smoothstep(0.5, 1.0, r));
    a = star * 0.9 + 1.1 * exp(-r * r * 14.0);
    a *= 0.8 + 0.2 * uTwinkle * sin(uTime * 2.0 + vCol.r * 20.0);
  } else if (vKind < 2.5) {                // streak
    float along = clamp(1.0 - abs(p.x), 0.0, 1.0);
    a = pow(along, 1.5) * exp(-p.y * p.y * 7.0);
    a *= 0.35 + 0.65 * smoothstep(-1.0, 1.0, p.x);          // bright head, faded tail
  } else {                                 // satellite sphere
    if (r > 1.0) discard;
    vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r * r)));
    float dif = clamp(dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(vec3(0.0, 0.0, -1.0), n), normalize(vec3(-0.4, 0.6, 0.7))), 0.0, 1.0), 24.0);
    float rim = pow(1.0 - n.z, 2.5);
    a = 0.35 + 0.8 * dif + rim * 0.7;
    tint = tint * a + vec3(1.0) * spec * 1.2;
    a = 1.0;
    a *= 1.0 - smoothstep(0.92, 1.0, r);
  }
  gl_FragColor = vec4(tint * a * vCol.a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,Sd=class{mesh;cap;n=0;geo;mat;px;py;pz;vx;vy;vz;age;life;size;kind;cr;cg;cb;ca;attract;spin;drag;grav;fade;aPos;aVel;aCol;aPosA;aVelA;aColA;ax=0;ay=0;az=0;attractK=0;emitted=0;dropped=0;constructor(e,t=32){this.cap=e;let n=()=>new Float32Array(e);this.px=n(),this.py=n(),this.pz=n(),this.vx=n(),this.vy=n(),this.vz=n(),this.age=n(),this.life=n(),this.size=n(),this.kind=n(),this.cr=n(),this.cg=n(),this.cb=n(),this.ca=n(),this.attract=n(),this.spin=n(),this.drag=n(),this.grav=n(),this.fade=n(),this.aPos=new Float32Array(e*4),this.aVel=new Float32Array(e*4),this.aCol=new Float32Array(e*4),this.geo=new La,this.geo.setAttribute(`position`,new tr(new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0]),3)),this.geo.setIndex(new tr(new Uint16Array([0,1,2,0,2,3]),1)),this.geo.boundingSphere=new cr(new X,1e4),this.geo.instanceCount=0,this.aPosA=new li(this.aPos,4).setUsage(Ye),this.aVelA=new li(this.aVel,4).setUsage(Ye),this.aColA=new li(this.aCol,4).setUsage(Ye),this.geo.setAttribute(`aPos`,this.aPosA),this.geo.setAttribute(`aVel`,this.aVelA),this.geo.setAttribute(`aCol`,this.aColA),this.mat=new qi({vertexShader:bd,fragmentShader:xd,uniforms:{uTime:{value:0},uTwinkle:{value:1}},transparent:!0,depthWrite:!1,depthTest:!0,blending:2,fog:!1}),this.mesh=new ai(this.geo,this.mat),this.mesh.frustumCulled=!1,this.mesh.renderOrder=t,this.mesh.visible=!1}get count(){return this.n}setTwinkle(e){this.mat.uniforms.uTwinkle.value=+!!e}clear(){this.n=0,this.geo.instanceCount=0,this.mesh.visible=!1}emit(e){if(this.n>=this.cap)return this.dropped++,!1;let t=this.n++;return this.emitted++,this.px[t]=e.x,this.py[t]=e.y,this.pz[t]=e.z,this.vx[t]=e.vx??0,this.vy[t]=e.vy??0,this.vz[t]=e.vz??0,this.age[t]=0,this.life[t]=e.life,this.size[t]=e.size,this.kind[t]=e.kind??0,this.cr[t]=e.r??1,this.cg[t]=e.g??1,this.cb[t]=e.b??1,this.ca[t]=e.a??1,this.attract[t]=e.attract??0,this.spin[t]=e.spin??0,this.drag[t]=e.drag??0,this.grav[t]=e.grav??0,this.fade[t]=e.fade??1,!0}set(e,t,n,r,i,a,o,s){this.px[e]=t,this.py[e]=n,this.pz[e]=r,this.vx[e]=i,this.vy[e]=a,this.vz[e]=o,this.ca[e]=s}configure(e,t,n,r,i,a,o){this.kind[e]=t,this.size[e]=n,this.cr[e]=r,this.cg[e]=i,this.cb[e]=a,this.ca[e]=o}update(e,t){let n=0,r=this.attractK;for(;n<this.n;){if(this.age[n]+=e,this.age[n]>=this.life[n]){let e=--this.n;this.px[n]=this.px[e],this.py[n]=this.py[e],this.pz[n]=this.pz[e],this.vx[n]=this.vx[e],this.vy[n]=this.vy[e],this.vz[n]=this.vz[e],this.age[n]=this.age[e],this.life[n]=this.life[e],this.size[n]=this.size[e],this.kind[n]=this.kind[e],this.cr[n]=this.cr[e],this.cg[n]=this.cg[e],this.cb[n]=this.cb[e],this.ca[n]=this.ca[e],this.attract[n]=this.attract[e],this.spin[n]=this.spin[e],this.drag[n]=this.drag[e],this.grav[n]=this.grav[e],this.fade[n]=this.fade[e];continue}let t=this.attract[n];if(r>0&&t>0){let i=this.ax-this.px[n],a=this.ay-this.py[n],o=this.az-this.pz[n],s=Math.sqrt(i*i+a*a+o*o)+1e-4,c=r*t*e;this.vx[n]+=i/s*c*Math.min(1,s*2+.2),this.vy[n]+=a/s*c*Math.min(1,s*2+.2),this.vz[n]+=o/s*c*Math.min(1,s*2+.2);let l=this.spin[n]*e;this.vx[n]+=-o/s*l,this.vz[n]+=i/s*l}let i=Math.exp(-this.drag[n]*e);this.vx[n]*=i,this.vy[n]=this.vy[n]*i-this.grav[n]*e,this.vz[n]*=i,this.px[n]+=this.vx[n]*e,this.py[n]+=this.vy[n]*e,this.pz[n]+=this.vz[n]*e,this.grav[n]>0&&this.py[n]<.01&&(this.py[n]=.01,this.vy[n]=Math.abs(this.vy[n])*.3),n++}for(let e=0;e<this.n;e++){let t=this.age[e]/this.life[e],n=this.fade[e],r=n===0?1-t:n===2?t<.6?1:1-(t-.6)/.4:Math.min(1,t*6)*(1-t)*(1-t)*1+0;this.aPos[e*4]=this.px[e],this.aPos[e*4+1]=this.py[e],this.aPos[e*4+2]=this.pz[e],this.aPos[e*4+3]=this.size[e],this.aVel[e*4]=this.vx[e],this.aVel[e*4+1]=this.vy[e],this.aVel[e*4+2]=this.vz[e],this.aVel[e*4+3]=this.kind[e],this.aCol[e*4]=this.cr[e],this.aCol[e*4+1]=this.cg[e],this.aCol[e*4+2]=this.cb[e],this.aCol[e*4+3]=this.ca[e]*r}this.mat.uniforms.uTime.value=t,this.aPosA.needsUpdate=!0,this.aVelA.needsUpdate=!0,this.aColA.needsUpdate=!0,this.geo.instanceCount=this.n,this.mesh.visible=this.n>0}dispose(){this.geo.dispose(),this.mat.dispose()}},Cd=[`common`,`uncommon`,`rare`,`epic`,`legendary`,`mythic`],wd=e=>Math.max(0,Cd.indexOf(e)),Td=e=>typeof e==`string`&&Cd.includes(e)?e:`common`,Ed=e=>e<=.04045?e/12.92:((e+.055)/1.055)**2.4,Dd=e=>[Ed((e>>16&255)/255),Ed((e>>8&255)/255),Ed((e&255)/255)],Od=(e,t,n,r)=>({name:e,index:t,tell:n,tellFamily:r,prism:!1,translucencyAdd:0,attenuation:1,rim:1,blush:1,twoTone:0,aurora:0,iri:0,swirlFloor:0,coreMul:1,coreSize:1,coreWarm:0,corePrism:0,coreTint:0,corePulseHz:0,corePulseAmp:0,haloMul:1,haloSize:1,poolMul:1,poolTint:0,ring:0,ringPulseHz:0,rimHalo:0,dome:0,pillar:0,sparkleBase:0,drift:!1,sparkTrail:!1,constellation:0,motes:0,satellites:0}),kd={common:{...Od(`common`,0,Dd(16773590),`other`),rim:.8,coreMul:.7,haloMul:.8,poolMul:.62},uncommon:{...Od(`uncommon`,1,Dd(5887718),`cyan`),translucencyAdd:.1,rim:1.12,coreMul:1.22,coreWarm:.8,poolMul:1.6,poolTint:.85,sparkleBase:.34},rare:{...Od(`rare`,2,Dd(9067760),`other`),translucencyAdd:.15,attenuation:.8,rim:1.35,swirlFloor:.8,coreMul:1.15,coreSize:1.18,corePulseHz:.36,corePulseAmp:.16,haloMul:1.1,poolMul:.95,poolTint:.3,rimHalo:.5,sparkleBase:.45},epic:{...Od(`epic`,3,Dd(16734797),`coral`),translucencyAdd:.15,attenuation:.8,rim:1.2,blush:1.5,twoTone:.85,coreMul:1.3,coreSize:1.2,coreTint:.3,haloMul:1.6,haloSize:1.3,poolMul:.9,poolTint:.25,ring:.7,rimHalo:.26,sparkleBase:.55,drift:!0,motes:4},legendary:{...Od(`legendary`,4,Dd(16757575),`other`),translucencyAdd:.18,attenuation:.75,rim:1.3,blush:1.3,aurora:1,coreMul:1.15,coreSize:1.25,coreTint:.55,haloMul:1.2,haloSize:1.3,poolMul:1,poolTint:.35,ring:.8,ringPulseHz:.25,rimHalo:.46,pillar:.5,sparkleBase:.85,drift:!0,sparkTrail:!0},mythic:{...Od(`mythic`,5,[1,1,1],`other`),prism:!0,translucencyAdd:.2,attenuation:.7,rim:1.4,blush:1.2,iri:1,coreMul:1.25,coreSize:1.25,corePrism:1,corePulseHz:.2,corePulseAmp:.12,haloMul:1.25,haloSize:1.35,poolMul:1.15,ring:.6,rimHalo:.24,dome:1,sparkleBase:.3,drift:!0,constellation:12,satellites:2}};function Ad(e,t){let n=e-Math.floor(e);t[0]=.5+.5*Math.cos(6.2832*(n+0)),t[1]=.5+.5*Math.cos(6.2832*(n+.33)),t[2]=.5+.5*Math.cos(6.2832*(n+.67));let r=.2126*t[0]+.7152*t[1]+.0722*t[2],i=Math.min(1.6,Math.max(.75,.5/Math.max(.05,r)));return t[0]=Math.min(1,t[0]*i),t[1]=Math.min(1,t[1]*i),t[2]=Math.min(1,t[2]*i),t}var jd=`
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vH = position.y;
  gl_Position = projectionMatrix * mv;
}
`,Md=`
varying vec3 vN;
varying vec3 vV;
varying float vH;
uniform float uStrength;
uniform float uTime;
void main() {
  float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  // a SOFT shell of light: brightest a little inside its silhouette and fading to nothing AT it (no glass-bell outline), gone toward
  // the top and at the table seam; a pastel prism (half white), not a saturated rainbow band
  float shell = smoothstep(0.0, 0.35, ndv) * pow(1.0 - ndv, 1.7);
  vec3 film = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + ndv * 0.9 + vH * 0.6 + uTime * 0.04));
  film = mix(vec3(0.82, 0.88, 1.0), film, 0.55);
  float a = (shell * 0.95 + 0.025) * smoothstep(0.0, 0.2, vH) * (1.0 - smoothstep(0.4, 0.95, vH)) * uStrength;
  gl_FragColor = vec4(film * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,Nd=`
varying vec3 vN;
varying vec3 vV;
varying float vH;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vH = position.y;
  gl_Position = projectionMatrix * mv;
}
`,Pd=`
varying vec3 vN;
varying vec3 vV;
varying float vH;
uniform vec3 uColor;
uniform float uStrength;
void main() {
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  // across the column: (1 - x^2)^2, a soft beam with no visible sides; up: fades out long before the top
  float a = pow(ndv, 4.0) * pow(max(0.0, 1.0 - vH), 2.4) * smoothstep(0.0, 0.1, vH) * uStrength;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`,Fd=class{mesh;geo=new Li(1,32,18,0,Math.PI*2,0,Math.PI/2);mat=new qi({vertexShader:jd,fragmentShader:Md,uniforms:{uStrength:{value:0},uTime:{value:0}},transparent:!0,depthWrite:!1,depthTest:!0,blending:2,fog:!1});constructor(){this.mesh=new ai(this.geo,this.mat),this.mesh.renderOrder=26,this.mesh.frustumCulled=!1,this.mesh.visible=!1}set(e,t,n,r,i,a){this.mesh.position.set(e,0,t),this.mesh.scale.set(n,r,n),this.mat.uniforms.uStrength.value=i,this.mat.uniforms.uTime.value=a,this.mesh.visible=i>.003}dispose(){this.geo.dispose(),this.mat.dispose()}},Id=class{mesh;geo=new Pi(1,1,1,28,1,!0);mat=new qi({vertexShader:Nd,fragmentShader:Pd,uniforms:{uColor:{value:new Q(1,.7,.3)},uStrength:{value:0}},transparent:!0,depthWrite:!1,depthTest:!0,blending:2,side:2,fog:!1});constructor(){this.geo.translate(0,.5,0),this.mesh=new ai(this.geo,this.mat),this.mesh.renderOrder=24,this.mesh.frustumCulled=!1,this.mesh.visible=!1}set(e,t,n,r,i,a){this.mesh.position.set(e,0,t),this.mesh.scale.set(n,r,n),this.mat.uniforms.uColor.value.setRGB(i[0],i[1],i[2],We),this.mat.uniforms.uStrength.value=a,this.mesh.visible=a>.003}dispose(){this.geo.dispose(),this.mat.dispose()}},Ld=class{group=new mn;live={aura:!1,dome:!1,pillar:!1,orbiters:0,stars:0};calm=!1;frameFit=1;strength=1;style;ctx;aura=null;dome=null;pillar=null;orbit=null;stars=null;lines=null;lineGeo=null;lineMat=null;lineArr=null;starTri=null;starW=null;starRf=null;starPairs=[];nMotes=0;nSats=0;fx=0;fz=0;fy=0;follow=!1;col=[1,1,1];constructor(e,t){this.style=e,this.ctx=t,this.setStyle(e)}get tierStyle(){return this.style}setStyle(e){this.style=e;let t=this.ctx.scale;e.rimHalo>0&&!this.aura&&(this.aura=new zl({ring:1,fadeH:.12*t,renderOrder:-18}),this.group.add(this.aura.mesh)),e.dome>0&&!this.dome&&(this.dome=new Fd,this.group.add(this.dome.mesh)),e.pillar>0&&!this.pillar&&(this.pillar=new Id,this.group.add(this.pillar.mesh));let n=e.motes+e.satellites;if(n>0&&!this.orbit){this.orbit=new Sd(16,31);for(let e=0;e<12;e++)this.orbit.emit({x:0,y:-100,z:0,life:1e9,size:.02,kind:0,a:0,fade:2});this.group.add(this.orbit.mesh)}this.nMotes=e.motes,this.nSats=e.satellites,e.constellation>0&&!this.stars&&this.buildConstellation(e.constellation),this.aura&&(this.aura.mesh.visible=e.rimHalo>0),this.dome&&e.dome<=0&&(this.dome.mesh.visible=!1),this.pillar&&e.pillar<=0&&(this.pillar.mesh.visible=!1),this.stars&&(this.stars.mesh.visible=e.constellation>0,this.lines&&(this.lines.visible=e.constellation>0)),this.orbit&&(this.orbit.mesh.visible=n>0),this.follow=!1}buildConstellation(e){let n=t(this.ctx.seed^358981),r={tri:0,u:0,v:0,w:0};this.starTri=new Uint32Array(e),this.starW=new Float32Array(e*3),this.starRf=new Float32Array(e);let i=[];for(let t=0;t<e;t++){let e=n()*2-1,a=n()*Math.PI*2,o=Math.sqrt(1-e*e),s=o*Math.cos(a),c=o*Math.sin(a);i.push(s,e,c),this.ctx.mapper.locate(s,e,c,r),this.starTri[t]=r.tri,this.starW[t*3]=r.u,this.starW[t*3+1]=r.v,this.starW[t*3+2]=r.w,this.starRf[t]=.35+.4*n()}let a=new Set;for(let t=0;t<e;t++){let n=[];for(let r=0;r<e;r++)r!==t&&n.push([Math.hypot(i[t*3]-i[r*3],i[t*3+1]-i[r*3+1],i[t*3+2]-i[r*3+2]),r]);n.sort((e,t)=>e[0]-t[0]);for(let e=0;e<2;e++){let r=n[e][1],i=Math.min(t,r)*64+Math.max(t,r);a.has(i)||(a.add(i),this.starPairs.push(t,r))}}this.stars=new Sd(e,30);for(let t=0;t<e;t++)this.stars.emit({x:0,y:-100,z:0,life:1e9,size:.03*this.ctx.scale,kind:1,a:0,r:.9+.1*n(),g:.95,b:1,fade:2});this.lineArr=new Float32Array(this.starPairs.length*3),this.lineGeo=new gr,this.lineGeo.setAttribute(`position`,new tr(this.lineArr,3).setUsage(Ye)),this.lineGeo.boundingSphere=new cr(new X,1e4),this.lineMat=new mi({color:13625087,transparent:!0,opacity:0,blending:2,depthWrite:!1,fog:!1}),this.lines=new Ei(this.lineGeo,this.lineMat),this.lines.frustumCulled=!1,this.lines.renderOrder=29,this.group.add(this.stars.mesh,this.lines)}update(e,t,n,r,i,a,o=1/0){let s=this.style,c=this.ctx.scale,l=n.center,u=this.strength,d=this.calm,f=Math.max(r,i,.3);if(this.aura&&s.rimHalo>0){let e=s.prism?Ad(t*.05,this.col):s.tell,n=this.ctx.palette.glow,r=s.prism?.4:0;this.aura.setColor((e[0]*.8+n[0]*.2)*(1-r)+r*.9,(e[1]*.8+n[1]*.2)*(1-r)+r*.9,(e[2]*.8+n[2]*.2)*(1-r)+r),this.aura.set(l.x,l.y,l.z,Math.min(f*1.85*this.frameFit,Math.max(f*1.1,o*.9)),.38*s.rimHalo*u)}if(this.dome&&s.dome>0){let e=d?1:.82+.18*Math.sin(t*Math.PI*2*.2);this.dome.set(l.x,l.z,Math.min(f*Math.max(1.2,1.5*this.frameFit),Math.max(f*1.05,o*.9)),f*1.7+(l.y-.4*c)*.2,.9*s.dome*e*u,t)}if(this.pillar&&s.pillar>0&&this.pillar.set(l.x,l.z,f*.55,2.6*c,s.tell,.4*s.pillar*u*(d?.7:.85+.15*Math.sin(t*Math.PI*2*.25))),this.orbit){this.follow||=(this.fx=l.x,this.fy=l.y,this.fz=l.z,!0);let n=1-Math.exp(-e*6);this.fx+=(l.x-this.fx)*n,this.fy+=(l.y-this.fy)*n,this.fz+=(l.z-this.fz)*n;let r=(l.x-this.fx)/.17,i=(l.z-this.fz)/.17,a=Math.hypot(r,i),o=1.2*c;a>o&&(r*=o/a,i*=o/a);let d=Math.hypot(r,i)>.25,p=s.tell;for(let e=0;e<this.nMotes;e++){let n=e*(Math.PI*2/Math.max(1,this.nMotes))+.7,a=.55+.1*e,o=t*a+n,s=(.82+.07*Math.sin(o*1.3+e))*f*1.1,l=this.fy+(.08+.2*Math.sin(o*.8+e*2))*c,m=this.fx+Math.cos(o)*s,h=this.fz+Math.sin(o)*s,g=a*s;this.orbit.set(e,m,l,h,-Math.sin(o)*g*1.6+r*3,0,Math.cos(o)*g*1.6+i*3,0),this.orbit.configure(e,d?2:0,(d?.034:.05)*c,p[0]*.7+.3,p[1]*.6+.3,p[2]*.55+.3,.95*u)}for(let e=0;e<this.nSats;e++){let n=6+e,r=t*(.32+.1*e)+e*Math.PI,i=(1.05+.08*e)*f*1.1,a=.5+.35*e,o=this.fx+Math.cos(r)*i,s=this.fz+Math.sin(r)*i*Math.cos(a),l=this.fy+Math.sin(r)*i*Math.sin(a)+.15*c,d=Ad(t*.07+e*.4,this.col);this.orbit.set(n,o,l,s,0,0,0,0),this.orbit.configure(n,3,.05*c,d[0],d[1],d[2],.95*u)}for(let e=this.nMotes;e<6;e++)this.orbit.set(e,0,-100,0,0,0,0,0);for(let e=6+this.nSats;e<12;e++)this.orbit.set(e,0,-100,0,0,0,0,0);this.orbit.update(0,t),this.live.orbiters=this.nMotes+this.nSats}if(this.stars&&this.starTri&&this.starW&&this.starRf&&this.lineArr&&this.lineMat&&s.constellation>0){let e=n.positions,r=n.indices,i=l.x,a=l.y,o=l.z,s=this.starTri.length,c=d?1:.85+.15*Math.sin(t*.9);for(let t=0;t<s;t++){let n=this.starTri[t]*3,s=r[n]*3,l=r[n+1]*3,d=r[n+2]*3,f=this.starW[t*3],p=this.starW[t*3+1],m=this.starW[t*3+2],h=this.starRf[t],g=i+(f*e[s]+p*e[l]+m*e[d]-i)*h,_=a+(f*e[s+1]+p*e[l+1]+m*e[d+1]-a)*h,v=o+(f*e[s+2]+p*e[l+2]+m*e[d+2]-o)*h;this.stars.set(t,g,_,v,0,0,0,.9*c*u),this.sx[t]=g,this.sy[t]=_,this.sz[t]=v}let f=this.starPairs;for(let e=0;e<f.length;e+=2){let t=f[e],n=f[e+1];this.lineArr[e*3]=this.sx[t],this.lineArr[e*3+1]=this.sy[t],this.lineArr[e*3+2]=this.sz[t],this.lineArr[e*3+3]=this.sx[n],this.lineArr[e*3+4]=this.sy[n],this.lineArr[e*3+5]=this.sz[n]}(this.lineGeo?.getAttribute(`position`)).needsUpdate=!0,this.lineMat.opacity=.32*u*c,this.stars.setTwinkle(!d),this.stars.update(0,t),this.live.stars=s}this.live.aura=!!this.aura&&s.rimHalo>0,this.live.dome=!!this.dome&&s.dome>0,this.live.pillar=!!this.pillar&&s.pillar>0}sx=new Float32Array(32);sy=new Float32Array(32);sz=new Float32Array(32);dispose(){this.aura?.dispose(),this.dome?.dispose(),this.pillar?.dispose(),this.orbit?.dispose(),this.stars?.dispose(),this.lineGeo?.dispose(),this.lineMat?.dispose()}},Rd=14,zd=6,Bd=1.3,Vd=1.4,Hd=.22,Ud=.16,Wd=class{mesh;radii;along=null;seg;rad;geo=new gr;pos;nrm;constructor(e,t=Rd,n=zd){this.seg=t,this.rad=n,this.radii=new Float32Array(t+1),this.pos=new Float32Array((t+1)*n*3),this.nrm=new Float32Array((t+1)*n*3);let r=[];for(let e=0;e<t;e++)for(let t=0;t<n;t++){let i=e*n+t,a=e*n+(t+1)%n,o=(e+1)*n+t,s=(e+1)*n+(t+1)%n;r.push(i,a,o,a,s,o)}this.geo.setIndex(r),this.geo.setAttribute(`position`,new tr(this.pos,3).setUsage(Ye)),this.geo.setAttribute(`normal`,new tr(this.nrm,3).setUsage(Ye)),this.geo.boundingSphere=new cr(new X,1e4),this.mesh=new ai(this.geo,e),this.mesh.frustumCulled=!1,this.mesh.renderOrder=11,this.mesh.visible=!1}build(e,t,n,r,i,a,o){let s=r-e,c=i-t,l=a-n,u=Math.hypot(s,c,l)||1e-4;s/=u,c/=u,l/=u;let d=-l,f=0,p=s,m=Math.hypot(d,f,p);m<1e-4&&(d=1,f=0,p=0,m=1),d/=m,f/=m,p/=m;let h=c*p-l*f,g=l*d-s*p,_=s*f-c*d,v=this.pos,y=this.nrm,b=this.radii,x=this.along,S=this.seg,C=this.rad,w=c*s,T=-1+c*c,E=c*l,D=Math.hypot(w,T,E),O=.4+.6*D;D<.35?(w=d,T=f,E=p,O=.5):(w/=D,T/=D,E/=D);for(let r=0;r<=S;r++){let i=r/S,a=x?x[r]:i,m=o*u*O*4*i*(1-i),D=e+s*a*u+w*m,k=t+c*a*u+T*m,A=n+l*a*u+E*m;for(let e=0;e<C;e++){let t=e/C*Math.PI*2,n=Math.cos(t),i=Math.sin(t),a=d*n+h*i,o=f*n+g*i,s=p*n+_*i,c=(r*C+e)*3;v[c]=D+a*b[r],v[c+1]=k+o*b[r],v[c+2]=A+s*b[r],y[c]=a,y[c+1]=o,y[c+2]=s}}this.geo.getAttribute(`position`).needsUpdate=!0,this.geo.getAttribute(`normal`).needsUpdate=!0}dispose(){this.geo.dispose()}},Gd=class{tube;get mesh(){return this.tube.mesh}active=!1;snapping=!1;anchor=-1;dx=0;dy=0;dz=1;len=0;peak=0;snapT=0;r0=.02;snapLen=0;alongBuf=new Float32Array(15);constructor(e){this.tube=new Wd(e,Rd,zd)}start(e,t,n,r,i,a){this.active=!0,this.snapping=!1,this.anchor=e;let o=Math.hypot(t,n,r)||1;this.dx=t/o,this.dy=n/o,this.dz=r/o,this.len=i,this.peak=0,this.snapT=0,this.r0=a,this.tube.mesh.visible=!0}snap(){this.snapping=!0,this.snapT=0,this.snapLen=this.len}stop(){this.active=!1,this.snapping=!1,this.tube.mesh.visible=!1}build(e,t,n,r,i){let a=this.snapping?this.snapLen:this.len,o=Math.sqrt(Math.min(1,Math.max(.05,this.r0*5/Math.max(a,.001))))*(.45+.55*r),s=Math.min(1,a/Math.max(.001,i)),c=this.snapping?this.snapT/Ud:0,l=this.tube.radii,u=this.alongBuf;for(let e=0;e<=Rd;e++){let t=e/Rd,n=t,r=this.r0*o*(1-.82*s*4*t*(1-t));if(r*=1+.8*(1-t)**8+.5*t**8,this.snapping){let e=t<.5?t/.5:(t-.5)/.5,i=1-c;n=t<.5?e*.5*i:1-(1-e)*.5*i,r*=i*(t<.5?1-.9*e:.1+.9*e)}l[e]=r,u[e]=n}this.tube.along=u,this.tube.build(e,t,n,e+this.dx*a,t+this.dy*a,n+this.dz*a,.18*(this.snapping?1-c:1))}dispose(){this.tube.dispose()}},Kd=class{group=new mn;events=[];strands=null;mat=null;hub;colour;tipX=new Float32Array(2);tipY=new Float32Array(2);tipZ=new Float32Array(2);tipR=new Float32Array(2);held=new Float32Array(2);hadTip=[!1,!1];evPool=[{finger:0,tension:0,snap:!1,x:0,y:0,z:0},{finger:1,tension:0,snap:!1,x:0,y:0,z:0},{finger:0,tension:0,snap:!1,x:0,y:0,z:0},{finger:1,tension:0,snap:!1,x:0,y:0,z:0}];snapsAt=[];constructor(e,t,n){this.hub=e,this.colour=[t[0]+(n[0]-t[0])*.45,t[1]+(n[1]-t[1])*.45,t[2]+(n[2]-t[2])*.45],this.group.frustumCulled=!1}get active(){return!!this.strands&&(this.strands[0].active||this.strands[1].active)}ensure(){if(this.strands)return this.strands;let e=this.colour,t=new Xi({color:new Q().setRGB(e[0],e[1],e[2],We),roughness:.12,metalness:0,clearcoat:1,clearcoatRoughness:.05,transparent:!0,opacity:.9,depthWrite:!1,fog:!1});return t.emissive.setRGB(e[0]*.5,e[1]*.5,e[2]*.5,We),this.hub.apply(t,1.2),this.mat=t,this.strands=[new Gd(t),new Gd(t)],this.group.add(this.strands[0].mesh,this.strands[1].mesh),this.strands}update(e,t,n,r,i,a){this.events.length=0,this.snapsAt.length=0;let o=typeof n==`number`&&Number.isFinite(n)?Math.min(1,Math.max(0,n)):0;for(let n=0;n<2;n++){let a=n===0?r:i;if(a){this.tipX[n]=a.x,this.tipY[n]=a.y,this.tipZ[n]=a.z,this.tipR[n]=a.r,this.held[n]+=e,this.hadTip[n]=!0;continue}let s=this.strands?this.strands[n]:null;if(this.hadTip[n]&&o>.02&&!(s&&s.active)){let e=this.ensure()[n],r=qd(t,this.tipX[n],this.tipY[n],this.tipZ[n]),i=t.positions,a=i[r*3],o=i[r*3+1],s=i[r*3+2],c=this.tipX[n]-a,l=this.tipY[n]-o,u=this.tipZ[n]-s;Math.hypot(c,l,u)<1e-4&&(c=a-t.center.x,l=o-t.center.y,u=s-t.center.z);let d=Math.hypot(c,l,u)||1;e.start(r,.45*c/d,.45*l/d+1,.45*u/d,Math.max(this.tipR[n],.01)*.6,Math.max(.012,this.tipR[n]*.4))}this.hadTip[n]=!1,this.held[n]=0}if(!this.strands)return;let s=0;for(let n=0;n<2;n++){let r=this.strands[n];if(!r.active)continue;let i=t.positions,c=r.anchor,l=i[c*3],u=i[c*3+1],d=i[c*3+2];if(r.snapping){if(r.snapT+=e,a||r.snapT>=Ud){r.stop();continue}r.build(l,u,d,0,Vd*t.restRadius);continue}r.peak=Math.max(r.peak,o),r.len=Math.min(r.len+Bd*e*(1-.5*r.len/(Vd*t.restRadius)),Vd*t.restRadius*1.05);let f=r.peak>0?o/r.peak:0,p=l+r.dx*r.len,m=u+r.dy*r.len,h=d+r.dz*r.len;if(o<Hd*r.peak||r.len>=Vd*t.restRadius){r.snap();let e=this.evPool[s++];e.finger=n,e.tension=0,e.snap=!0,e.x=l+r.dx*r.len*.5,e.y=u+r.dy*r.len*.5,e.z=d+r.dz*r.len*.5,this.events.push(e),this.snapsAt.push(e.x,e.y,e.z),r.build(l,u,d,0,Vd*t.restRadius);continue}r.build(l,u,d,f,Vd*t.restRadius);let g=this.evPool[s++];g.finger=n,g.tension=f*o,g.snap=!1,g.x=p,g.y=m,g.z=h,this.events.push(g)}}dispose(){if(this.strands)for(let e of this.strands)e.dispose();this.mat&&(this.hub.release(this.mat),this.mat.dispose()),this.group.removeFromParent()}};function qd(e,t,n,r){let i=e.positions,a=e.vertexCount,o=0,s=1/0;for(let e=0;e<a;e++){let a=i[e*3]-t,c=i[e*3+1]-n,l=i[e*3+2]-r,u=a*a+c*c+l*l;u<s&&(s=u,o=e)}return o}var Jd=.45,Yd=.06,Xd=class{id;proxy;genome;palette;group=new mn;scale;restHalfW;restH;owned;tier;style;mats;jelly;core;face;fx;decals;rarity;fp={cx:0,cz:0,rx:.5,rz:.5,lowY:0,compression:0,stretch:0};frameRoom=1/0;extraPool=0;extraPoolTell=0;poolTellNow=0;poolBase=[0,0,0];clock=0;faceHidden=!1;chunk;isPiece;hold=new zu;lodNow=0;get lod(){return this.lodNow}setLod(e){e!==this.lodNow&&(this.lodNow=e,this.decals.wanted=e===0,this.fx.group.visible=e===0,this.rarity.group.visible=e===0&&!this.chunk,this.core.minKept=e===0?.002:Yd,this.core.setHidden(e===1&&!this.isPiece))}glowK=1;seamN=new X(0,1,0);seamD=0;seamTarget=0;seamAmt=0;frac0;sortDepth=0;strands;touchAmt=new Float32Array(2);tipsLive=!1;spec;smComp=0;smStretch=0;prevSq=0;sqRate=0;touchGate=0;grabGate=0;calm=!1;shown=!0;disposed=!1;get isDisposed(){return this.disposed}constructor(e,t,n,r,i,a,o,s,c=!1){this.id=e,this.genome=n,this.tier=r,this.style=kd[r],this.spec=i,this.owned=s,this.isPiece=Al(t.piece),this.chunk=c&&!this.isPiece,this.frac0=typeof t.frac==`number`&&Number.isFinite(t.frac)&&t.frac>0?t.frac:1,this.proxy=new xl(t),this.palette=d(n),this.scale=(this.isPiece?t.piece.whole.radius:t.restRadius)/.5;let l=t.restRadius;{let e=t.positions,n=t.center;for(let t=0;t<e.length;t+=3){let r=Math.hypot(e[t]-n.x,e[t+2]-n.z);r>l&&(l=r)}}this.restHalfW=l;{let e=t.positions,n=0,r=1/0;for(let t=1;t<e.length;t+=3)e[t]>n&&(n=e[t]),e[t]<r&&(r=e[t]);this.restH=Math.max(.1,n-(Number.isFinite(r)?r:0))}this.mats=new yd(n,this.palette,this.scale,a,this.style),this.jelly=new cu(this.proxy,this.mats.get(i.tier),i.fineFreq),this.jelly.mesh.renderOrder=10,this.core=new Kl(n,this.palette,this.scale,this.style),this.core.setLite(!i.transmission),this.hubRef=a,this.face=this.makeFace(a),this.core.setPiece(this.proxy.piece),this.fx=new Lu(n,this.palette,this.jelly.mapper,i,this.scale,this.style),this.decals=new Zl(o),this.applyPoolColour(),this.rarity=new Ld(this.style,{scale:this.scale,seed:n.seed,mapper:this.jelly.mapper,palette:this.palette}),this.strands=new Kd(a,this.palette.body,this.palette.pale),this.group.add(this.jelly.mesh,this.core.group,this.face.group,this.fx.group,this.decals.shadow,this.decals.pool,this.rarity.group,this.strands.group),this.group.frustumCulled=!1,this.chunk&&(this.faceHidden=!0,this.face.group.visible=!1,this.rarity.group.visible=!1),this.update(0,0,null,null,0,0)}get body(){return this.proxy}get visible(){return this.shown}setVisible(e){this.shown=e,this.group.visible=e}setCalm(e){this.calm=e,this.core.calm=e,this.fx.calm=e,this.rarity.calm=e}applyPoolColour(){let e=this.palette.pool,t=this.style.tell,n=this.style.poolTint,r=this.poolBase;r[0]=e[0]+(t[0]-e[0])*n,r[1]=e[1]+(t[1]-e[1])*n,r[2]=e[2]+(t[2]-e[2])*n,this.decals.setColor(r),this.poolTellNow=0;let i=this.style.prism?[.75,.85,1]:t;this.decals.setRingColor([i[0]*.8+e[0]*.2,i[1]*.8+e[1]*.2,i[2]*.8+e[2]*.2])}setTier(e){e!==this.tier&&(this.tier=e,this.style=kd[e],this.mats.setStyle(this.style),this.jelly.mesh.material=this.mats.get(this.spec.tier),this.core.setStyle(this.style),this.fx.setStyle(this.style),this.rarity.setStyle(this.style),this.applyPoolColour())}applyQuality(e){this.spec=e,this.jelly.mesh.material=this.mats.get(e.tier),this.jelly.freq!==e.fineFreq&&this.jelly.rebuild(e.fineFreq),this.fx.setTier(e),this.core.setLite(!e.transmission)}spawnFx(e,t,n){this.fx.spawn(e,t,n)}update(e,t,n,r,i,a){if(this.disposed)return;this.owned&&a>0&&this.proxy.inner.step(a),this.proxy.sync(e,t);let o=this.proxy,s=o.metrics,c=this.jelly;c.update(),this.isPiece&&o.piece!==this.facePiece&&this.rebuildFace(),this.touchGate+=(+(s.fingers>0)-this.touchGate)*(1-Math.exp(-e*(s.fingers>0?30:7))),this.grabGate+=((s.grabbed||s.fingers>0?1:0)-this.grabGate)*(1-Math.exp(-e*(s.grabbed||s.fingers>0?30:7)));let l=typeof s.press==`number`&&Number.isFinite(s.press)?Math.min(1,Math.max(0,s.press)):0,u=Math.max(s.compression,c.press*.9*this.touchGate,l*this.touchGate);e>1e-4&&(this.sqRate+=((u-this.prevSq)/e-this.sqRate)*(1-Math.exp(-e/.06))),this.prevSq=u,this.smComp+=(u-this.smComp)*(1-Math.exp(-e*14)),this.smStretch+=(Math.max(s.stretch,c.pull*.6*this.grabGate)-this.smStretch)*(1-Math.exp(-e*10));let d=this.proxy.inner.frac,f=!this.isPiece&&typeof d==`number`&&Number.isFinite(d)&&d>0?Math.min(3,Math.max(.3,Math.cbrt(d/this.frac0))):1;this.core.sizeMul=this.proxy.scale*f,this.sizeK=f*this.proxy.scale,this.fracK=f,this.core.update(o,e,t,this.smComp,c.caps);let p=this.mats.uniforms;p.uTime.value=t,p.uCompress.value=this.smComp,p.uStretch.value=this.smStretch,p.uCoreWorld.value.copy(this.core.center),p.uCoreAmt.value=.3*this.core.amount*(this.spec.transmission?1:1.9);let m=this.fp;if(m.cx=(c.minX+c.maxX)*.5,m.cz=(c.minZ+c.maxZ)*.5,m.rx=(c.maxX-c.minX)*.5,m.rz=(c.maxZ-c.minZ)*.5,m.lowY=c.minY,m.compression=this.smComp,m.stretch=this.smStretch,r){let e=r.matrixWorld.elements,t=o.center,n=t.x-r.position.x,i=t.y-r.position.y,a=t.z-r.position.z,s=Math.max(.5,-(n*e[8]+i*e[9]+a*e[10]));this.frameRoom=Math.max(.2,s*Math.tan(r.fov*Math.PI/360)*r.aspect-Math.abs(n*e[0]+i*e[1]+a*e[2]))}m.room=this.frameRoom,this.fx.setFootprint(Math.max(m.rx,m.rz)),this.fx.setFrameRoom(this.frameRoom),this.face.group.visible=this.proxy.foldAmount<.4&&!this.faceHidden;let h=Math.min(this.sqRate,s.compressionRate);!this.chunk&&this.face.eyeCount>0&&this.face.update(e,t,n,r,this.smComp,s.fingers>0||s.grabbed?Math.max(0,h):h);let g=this.seamTarget*this.glowK*(this.calm?Jd:1);this.seamAmt+=(g-this.seamAmt)*(1-Math.exp(-e*(g>this.seamAmt?10:5))),this.seamAmt<.001&&g<=0&&(this.seamAmt=0);let _=this.proxy.offset;p.uSeam.value.set(this.seamN.x,this.seamN.y,this.seamN.z,this.seamD+this.seamN.x*_.x+this.seamN.y*_.y+this.seamN.z*_.z),p.uSeamAmt.value=this.seamAmt,p.uSeamW.value=.03*this.scale*f,p.uSpotR.value=.16*this.scale*f,this.lodNow===0&&this.fx.update(e,t,o);let v=Math.min(1,Math.max(0,this.extraPoolTell))*Math.min(1,this.extraPool*2);if(v!==this.poolTellNow){this.poolTellNow=v;let e=this.poolBase,t=this.style.tell;this.decals.setColorRGB(e[0]+(t[0]-e[0])*v,e[1]+(t[1]-e[1])*v,e[2]+(t[2]-e[2])*v)}this.decals.update(e,t,m,i,this.style,this.calm,this.extraPool);let y=null,b=null;(s.fingers>0||this.tipsLive)&&(y=this.proxy.tip(0),b=this.proxy.tip(1)),this.tipsLive=!!y||!!b,this.touchGlow(e,y,b),this.strands.update(e,this.proxy,s.strands,y,b,this.calm);for(let e=0;e<this.strands.snapsAt.length;e+=3)this.snapAt.x=this.strands.snapsAt[e],this.snapAt.y=this.strands.snapsAt[e+1],this.snapAt.z=this.strands.snapsAt[e+2],this.fx.spawn(`bubbles`,this.snapAt,0);r&&(this.rarity.frameFit=Math.min(1,Math.max(.72,r.aspect/.75))),this.lodNow===0&&this.rarity.update(e,t,o,m.rx,m.rz,i,this.frameRoom)}snapAt={x:0,y:0,z:0};hubRef=null;facePiece;makeFace(e){let t=this.proxy.piece,n=this.jelly.pb;if(this.facePiece=t,this.isPiece&&t&&n){let r=t.whole,i=mu({vertexCount:r.restLocal.length/3|0,indices:r.indices,restLocal:r.restLocal},r.radius,this.genome);return new xu(this.proxy,this.genome,this.jelly,e,Wu(this.proxy.restLocal,this.proxy.indices,t,n,i))}return new xu(this.proxy,this.genome,this.jelly,e,void 0,this.faceLod)}get faceLod(){let e=this.scale;return this.isPiece||!(e<.7)||!Sl.enabled?void 0:{domeQ:Math.max(.4,Math.min(1,Math.sqrt(e))),singlePass:!0}}rebuildFace(){let e=this.face;this.face=this.makeFace(this.hubRef),e.group.removeFromParent(),e.dispose(),this.group.add(this.face.group),this.core.setPiece(this.proxy.piece)}setSeam(e,t){let n=e?.normal,r=e?.point,i=n?Math.sqrt(n.x*n.x+n.y*n.y+n.z*n.z):0;if(!n||!r||!(i>1e-6)||!Number.isFinite(i)||!Number.isFinite(r.x+r.y+r.z)||!(t>0)){this.seamTarget=0;return}if(this.isPiece&&this.planeIsFace(n.x/i,n.y/i,n.z/i,(n.x*r.x+n.y*r.y+n.z*r.z)/i)){this.seamTarget=0;return}this.seamN.set(n.x/i,n.y/i,n.z/i),this.seamD=this.seamN.x*r.x+this.seamN.y*r.y+this.seamN.z*r.z;let a=Math.min(1,t/.45);this.seamTarget=.9*a*a*(3-2*a)}planeIsFace(e,t,n,r){let i=this.proxy.offset,a=this.scale*.5,o=e*i.x+t*i.y+n*i.z;for(let i of this.jelly.caps)if(i.live&&!(Math.abs(e*i.nx+t*i.ny+n*i.nz)<.97)&&Math.abs(e*i.cx+t*i.cy+n*i.cz-o-r)<=.03*a)return!0;return!1}carrySeam(e,t,n,r,i){let a=this.proxy.offset;this.seamN.set(e,t,n),this.seamD=r-(e*a.x+t*a.y+n*a.z),this.seamAmt=Math.max(this.seamAmt,i),this.seamTarget=0}get seamAmount(){return this.seamAmt}get liveRadius(){return this.proxy.restRadius*this.sizeK}sizeK=1;fracK=1;get growth(){return this.fracK}setSpot(e,t,n,r){this.mats.uniforms.uSpot.value.set(e,t,n,Math.max(0,Math.min(1,r)))}touchGlow(e,t,n){let r=this.mats.uniforms,i=this.calm?.45:.9;for(let a=0;a<2;a++){let o=a===0?t:n,s=a===0?r.uTouch0.value:r.uTouch1.value,c=o?Math.min(1,Math.max(0,o.depth*1.3)):0,l=this.touchAmt[a];this.touchAmt[a]=l+(c-l)*(1-Math.exp(-e*(c>l?10:5))),o&&(s.x=o.x,s.y=o.y,s.z=o.z,r.uTouchR.value=Math.max(.05*this.scale,o.r*1.5)),s.w=this.touchAmt[a]*i}}dispose(){this.disposed||(this.disposed=!0,this.group.removeFromParent(),this.jelly.dispose(),this.core.dispose(),this.face.dispose(),this.fx.dispose(),this.mats.dispose(),this.decals.dispose(),this.rarity.dispose(),this.strands.dispose())}},Zd=.24,Qd=.12,$d=.72,ef=.36,tf=new X,nf=new X;function rf(e){let t=[new Y(Zd,0),new Y(Zd,e*Qd)];for(let n=1;n<=14;n++){let r=n/14*Math.PI/2;t.push(new Y(Zd*Math.cos(r),e*(Qd+Zd*Math.sin(r))))}return e===1?t:t.reverse()}var af=`varying vec3 vOP;
`,of=`
varying vec3 vOP;
uniform float uCrack, uStress, uLeakAmt, uPrism, uTimeC;
uniform vec3 uLeakCol, uSeedC;
${Bl}
vec2 whVoronoi(vec3 x) {
  vec3 p = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 b = vec3(float(i), float(j), float(k));
    vec3 r = b - f + whHash33(p + b);
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
  }
  return vec2(sqrt(f1), sqrt(f2));
}
`,sf=`
{
  vec3 cq = vOP * 8.0 + uSeedC;
  vec2 vor = whVoronoi(cq);
  float cedge = vor.y - vor.x;
  float spread = whNoise3(vOP * 3.1 + uSeedC);
  float pres = 1.0 - smoothstep(uCrack * 1.3 - 0.15, uCrack * 1.3 + 0.05, spread);
  float cw = mix(0.012, 0.07, uCrack);
  float cline = (1.0 - smoothstep(0.0, cw, cedge)) * pres;
  float sline = (1.0 - smoothstep(0.0, 0.018, cedge)) * uStress * smoothstep(0.5, 0.78, whNoise3(vOP * 5.0 + uSeedC));
  vec3 lc = uLeakCol;
  if (uPrism > 0.5) lc = 0.5 + 0.5 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + whNoise3(cq * 0.6) + uTimeC * 0.08));
  totalEmissiveRadiance += lc * (cline * uLeakAmt * 3.4 + uLeakAmt * 0.1) + vec3(0.9, 0.92, 1.0) * sline * 0.3;
  totalDiffuse *= 1.0 - 0.35 * cline;
}
vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
`,cf=class{group=new mn;rig=new mn;pos=new X;radius=Zd;landed=!1;touchedDown=!1;calm=!1;gone=!1;burstT=-1;u;top;bottom;wad;geoTop;geoBottom;geoWad=new Li(1,20,12);shellMat;wadMat;hub;decals;lowTier=!1;y=2.6;vy=0;bounces=0;rock=0;rockV=0;squeeze=0;time=0;onLand=null;tv=new X;bv=new X;tw=new X;bw=new X;tp=new X;bp=new X;fp={cx:0,cz:0,rx:Zd,rz:Zd,lowY:0,compression:0,stretch:0};sz=1;sizeGoal=1;get size(){return this.sz}setSize(e){this.sz=this.sizeGoal=Math.min(1,Math.max(.4,Number.isFinite(e)?e:1)),this.fp.rx=this.fp.rz=Zd*this.sz}leak=0;burstGain=1;fade=1;fadeS=.45;baseOpacity=1;constructor(e,t,n){this.hub=e,this.lowTier=n,this.geoTop=new Fi(rf(1),36),this.geoBottom=new Fi(rf(-1),36),this.u={uCrack:{value:0},uStress:{value:0},uLeakAmt:{value:0},uPrism:{value:0},uTimeC:{value:0},uLeakCol:{value:new Q(1,.8,.5)},uSeedC:{value:new X(3.1,7.7,1.3)}},this.shellMat=new Xi({color:15264762,roughness:.16,metalness:0,clearcoat:1,clearcoatRoughness:.05,ior:1.45,specularIntensity:1,side:2,fog:!1}),e.apply(this.shellMat,1.3),this.applyTier(n);let r=this.u;this.shellMat.onBeforeCompile=e=>{Object.assign(e.uniforms,r),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
`+af).replace(`#include <begin_vertex>`,`#include <begin_vertex>
vOP = position;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
`+of).replace(`vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;`,sf)},this.shellMat.customProgramCacheKey=()=>`wh-capsule-v1-`+(this.lowTier?`low`:`full`),this.top=new ai(this.geoTop,this.shellMat),this.bottom=new ai(this.geoBottom,this.shellMat);for(let e of[this.top,this.bottom])e.frustumCulled=!1,e.renderOrder=12;this.wadMat=new qr({color:new Q(.55,.5,.8),toneMapped:!0,fog:!1,transparent:!0}),this.wad=new ai(this.geoWad,this.wadMat),this.wad.scale.setScalar(.125),this.wad.renderOrder=-20,this.wad.frustumCulled=!1,this.decals=new Zl(t),this.decals.setColor([.6,.55,.9]),this.rig.add(this.top,this.bottom,this.wad),this.group.add(this.rig,this.decals.shadow,this.decals.pool),this.group.frustumCulled=!1,this.group.visible=!1}applyTier(e){let t=this.shellMat;this.lowTier=e,e?(t.transmission=0,t.transparent=!0,this.baseOpacity=.62,t.depthWrite=!1):(t.transmission=.9,t.thickness=.16,t.attenuationColor=new Q(13225968),t.attenuationDistance=.75,t.transparent=!0,this.baseOpacity=1,t.depthWrite=!0),t.opacity=this.baseOpacity*this.fade,t.needsUpdate=!0}drop(e,t,n){this.pos.set(e,0,t),this.y=2.6,this.vy=0,this.bounces=0,this.landed=!1,this.touchedDown=!1,this.rock=0,this.rockV=0,this.onLand=n??null,this.group.visible=!0,this.gone=!1,this.burstT=-1,this.top.visible=this.bottom.visible=!0}appear(e,t,n,r=.45){this.placeStanding(e,t),this.fade=0,this.fadeS=Math.max(.05,r),this.touchedDown=!1,this.onLand=n??null,this.applyFade()}applyFade(){let e=this.fade*this.fade*(3-2*this.fade);this.shellMat.opacity=this.baseOpacity*e,this.wadMat.opacity=e,this.decals.alphaMul=e}placeStanding(e,t){this.pos.set(e,0,t),this.y=ef*this.sz,this.vy=0,this.landed=!0,this.touchedDown=!0,this.rock=0,this.rockV=0,this.group.visible=!0,this.gone=!1,this.burstT=-1}slideTo(e,t,n){this.glide=null,this.pos.x+=(e-this.pos.x)*n,this.pos.z+=(t-this.pos.z)*n}glideTo(e,t,n){Number.isFinite(e+t+n)&&(this.glide={x:e,z:t},this.sizeGoal=Math.min(1,Math.max(.4,n)))}glide=null;get gliding(){return this.glide!==null}setSqueeze(e){this.squeeze=Number.isFinite(e)?Math.min(1,Math.max(0,e)):0}get squeezeAmount(){return this.squeeze}setCrack(e,t,n,r){this.u.uCrack.value=e,this.u.uLeakAmt.value=t,this.leak=t,this.u.uLeakCol.value.setRGB(n[0],n[1],n[2],We),this.u.uPrism.value=+!!r,this.wadMat.color.setRGB(.55+(n[0]*1.2-.55)*Math.min(1,t),.5+(n[1]*1.2-.5)*Math.min(1,t),.8+(n[2]*1.2-.8)*Math.min(1,t),We),this.decals.setColor([.6+(n[0]-.6)*Math.min(1,t),.55+(n[1]-.55)*Math.min(1,t),.9+(n[2]-.9)*Math.min(1,t)])}wobble(e){this.calm||(this.rockV+=e)}burst(e=1){this.burstT=0,this.burstGain=e,this.tp.set(0,0,0),this.bp.set(0,0,0),this.tv.set(3.2,2.6,-2),this.bv.set(-3,1,1.8),this.tw.set(2,3.2,-4.5),this.bw.set(-1.5,2,3.5),this.u.uStress.value=0}hide(){this.group.visible=!1,this.gone=!0}screenPoint(e,t,n,r){if(!this.group.visible||this.gone||this.burstT>=0||!this.touchedDown)return null;let i=tf.set(this.pos.x,ef*this.sz,this.pos.z).project(e),a=nf.set(this.pos.x,.6*this.sz,this.pos.z).project(e);r.x=(i.x*.5+.5)*t,r.y=(1-(i.y*.5+.5))*n,r.r=Math.max(20,Math.abs((a.y-i.y)*.5*n)*1.35);let o=Math.min(r.x,t-r.x,r.y,n-r.y);return o>0&&r.r>o&&(r.r=Math.max(12,o)),r}update(e,t){if(this.gone)return;if(this.time=t,this.fade<1&&(this.fade=Math.min(1,this.fade+e/this.fadeS),this.applyFade(),this.fade>=1&&(this.touchedDown=!0,this.onLand?.(),this.onLand=null)),this.u.uTimeC.value=t,this.glide){if(this.burstT>=0||!this.landed)this.glide=null;else{let t=1-Math.exp(-e*6);this.pos.x+=(this.glide.x-this.pos.x)*t,this.pos.z+=(this.glide.z-this.pos.z)*t,Math.abs(this.glide.x-this.pos.x)<.004&&Math.abs(this.glide.z-this.pos.z)<.004&&(this.pos.x=this.glide.x,this.pos.z=this.glide.z,this.glide=null)}}this.sz!==this.sizeGoal&&(this.sz+=(this.sizeGoal-this.sz)*(1-Math.exp(-e*6)),Math.abs(this.sz-this.sizeGoal)<.001&&(this.sz=this.sizeGoal),this.fp.rx=this.fp.rz=Zd*this.sz);let n=ef*this.sz,r=this.sz;if(!this.landed&&this.burstT<0&&(this.vy-=9.8*e,this.y+=this.vy*e,this.y<=n)){if(this.y=n,this.vy<-.5&&this.bounces<2){let e=-this.vy;this.vy=e*.36,this.bounces++,this.rockV+=(this.bounces===1?5.5:2.5)*(this.bounces%2?1:-1),this.bounces===1&&(this.touchedDown=!0,this.onLand?.(),this.onLand=null)}else this.vy=0,this.landed=!0,this.touchedDown||(this.touchedDown=!0,this.onLand?.(),this.onLand=null)}let i=2.4+6*this.squeeze;this.rockV+=(-70*this.rock-i*this.rockV)*e,this.rock+=this.rockV*e;let a=this.squeeze,o=this.calm?0:a*a*.05*Math.sin(t*58),s=1-.14*a,c=1+.07*a;if(this.u.uStress.value=this.burstT<0?Math.min(1,a*1.4)*(this.u.uCrack.value<.05?1:.3):0,this.burstT<0)this.landed&&Math.abs(this.y-n)>1e-4&&(this.y=n),this.rig.position.set(this.pos.x,this.y-n*(1-s),this.pos.z),this.rig.rotation.set(o,0,this.rock+o*.5),this.rig.scale.set(c*r,s*r,c*r),this.top.position.set(0,0,0),this.bottom.position.set(0,0,0),this.top.rotation.set(0,0,0),this.bottom.rotation.set(0,0,0),this.top.scale.setScalar(1),this.bottom.scale.setScalar(1),this.wad.position.set(0,0,0),this.wad.scale.setScalar(.125*(1+.15*Math.min(1,this.leak)));else{this.burstT+=e,this.rig.rotation.set(0,0,0),this.rig.scale.set(r,r,r),this.rig.position.set(this.pos.x,n,this.pos.z),this.tv.y-=9.8*e,this.bv.y-=9.8*e,this.tp.addScaledVector(this.tv,e),this.bp.addScaledVector(this.bv,e),this.top.position.copy(this.tp),this.bottom.position.copy(this.bp),this.top.rotation.x+=this.tw.x*e,this.top.rotation.y+=this.tw.y*e,this.top.rotation.z+=this.tw.z*e,this.bottom.rotation.x+=this.bw.x*e,this.bottom.rotation.y+=this.bw.y*e,this.bottom.rotation.z+=this.bw.z*e;let t=Math.min(1,Math.max(0,this.burstT/.14)),i=(1-t)*(1-t);this.top.scale.setScalar(i),this.bottom.scale.setScalar(i),this.wad.scale.setScalar(Math.max(0,.125*(1-this.burstT*14))),this.burstT>.8&&(this.gone=!0,this.group.visible=!1)}this.fp.cx=this.pos.x,this.fp.cz=this.pos.z,this.fp.lowY=Math.max(0,this.y-n),this.fp.compression=this.squeeze*.4,this.decals.update(e,t,this.fp,0,null,!0,this.burstT<0?Math.min(1,this.leak)*1.1:Math.max(0,1-this.burstT*2)*this.burstGain),this.decals.pool.visible=this.decals.pool.visible&&this.leak>.02}dispose(){this.group.removeFromParent(),this.geoTop.dispose(),this.geoBottom.dispose(),this.geoWad.dispose(),this.hub.release(this.shellMat),this.shellMat.dispose(),this.wadMat.dispose(),this.decals.dispose()}},lf={common:1.6,uncommon:2,rare:2.6,epic:3.2,legendary:3.9,mythic:4.5},uf={common:2.2,uncommon:2.6,rare:3.2,epic:3.8,legendary:4.5,mythic:5.2},df=.4,ff=.8,pf=.65,mf=.12,hf=.6,gf=.25,_f=.45;function vf(e,t={}){return(t.quick&&wd(e)<=1?ff:lf[e])*(t.calm?pf:1)}function yf(e,t={}){return(uf[e]+(t.tierUp?df:0))*(t.calm?pf:1)}var bf=[0,0,.3,.5,.8,1],xf=[1.3,1.5,1.8,2.1,2.4,2.8],Sf=[12,24,40,70,120,200],Cf=[0,6,12,0,0,0],wf=[0,0,0,24,0,0],Tf=[0,0,0,0,3,0],Ef=[0,0,0,0,0,24],Df=[0,0,1,2,3,3],Of=[1,.5,.3],kf=[0,.02,.04,.06,-.07,.05],Af=[0,0,6,10,15,25],jf=[[1,0],[1,0],[1,0],[.6,.25],[.5,.35],[.4,.5]],Mf=[.1,.12,.15,.17,.18,.19],Nf=[0,.08,.16,.28,.42,.55],Pf=[.45,.6,.8,1,1.15,1.2],Ff=[1,1.04,1.08,1.12,1.12,1.12],If=1.3,Lf=.04,Rf={x0:-.2,v0:6},zf={x0:-.1,v0:2.8},Bf=[.9,1.1,1.4,1.7,1.7,1.7],Vf=0,Hf=[.55,.58,.6,.42,.6,.42],Uf=.25,Wf=[.26,.28,.3,.18,.3,.2],Gf=[.55,.3],Kf=[.3,.5],qf=[1,.88,.68],Jf=(e,t,n)=>{let r=Math.min(1,Math.max(0,(n-e)/(t-e)));return r*r*(3-2*r)},Yf=e=>e<0?0:e>1?1:e;function Xf(e,t,n){let r=e.prism?Ad(t*.2,n):e.tell,i=e.prism?.62:.18;return n[0]=l(r[0])*(1-i)+i,n[1]=l(r[1])*(1-i)+i,n[2]=l(r[2])*(1-i)+i,n}var Zf=class{t=0;duration;tier;style;done;rng;resolveDone;finished=!1;skipping=!1;skipLeft=0;fired=new Set;calm;tmp=[1,1,1];resultView=null;stats={burstParticles:0,rings:0,fades:0,push:0,pull:0,arcDeg:0,minTimeScale:1,dipSeconds:0,ramps:0,softBurst:0};gain=1;burstAtT=-1;host;hooks;constructor(e,n,r,i,a){this.host=e,this.hooks=i,this.tier=n,this.style=kd[n],this.duration=r,this.calm=e.calm(),this.rng=t(a^52782),this.done=new Promise(e=>{this.resolveDone=e})}get active(){return!this.finished}get resultBody(){return this.resultView?this.resultView.proxy.inner:null}get resultBodyId(){return this.resultView?this.resultView.id:null}beat(e){if(!this.fired.has(e)){this.fired.add(e);try{this.hooks?.onBeat?.(e,{t:this.t,tier:this.tier})}catch{}}}skip(){if(this.finished||this.skipping)return;let e=this.burstAtT>=0?this.t-this.burstAtT:1/0;e<hf?this.host.crossfade(Math.max(mf,hf-e),`decay`):this.host.crossfade(mf,`linear`),this.finalize(!0);let t=this.resultView;t&&(t.clock=Math.max(t.clock,this.duration-mf)),this.host.setFraming(null,!0),this.beat(`reveal`),this.beat(`settle`),this.skipping=!0,this.skipLeft=mf}step(e){if(this.finished)return 1;if(this.skipping)return this.skipLeft-=e,this.skipLeft<=0&&this.end(),1;this.t+=e;let t=this.tick(e),n=this.calm?1:t,r=this.stats,i=this.host.cameraFx;return r.push=Math.max(r.push,1-i.dist),r.pull=Math.max(r.pull,i.dist-1),r.arcDeg=Math.max(r.arcDeg,Math.abs(i.yaw)*180/Math.PI),r.minTimeScale=Math.min(r.minTimeScale,t,n),Math.min(t,n)<.999&&(r.dipSeconds+=e),this.t>=this.duration&&(this.finalize(!1),this.beat(`settle`),this.end()),n}end(){this.finished||(this.finished=!0,this.resolveDone())}startRamp(){this.burstAtT=this.t;let e=this.host.flash.flash(this.host.now(),Mf[this.style.index]);if(e>0){let t=Xf(this.style,this.t,this.tmp);this.host.screen.startRamp(e,t[0],t[1],t[2]),this.stats.ramps++,this.gain=1}else this.gain=this.calm?_f:gf,this.calm||(this.stats.softBurst=1)}camera(e,t,n,r){let i=this.host.cameraFx;if(this.calm){i.dist=1,i.yaw=0,i.pitch=0;return}let a=this.style.index,o=Jf(e,e+t,this.t)*(1-Jf(n-r,n,this.t));i.dist=1-kf[a]*o,i.yaw=Af[a]*Math.PI/180*o,i.pitch=a>=5?.06*o:0}burstParticles(e,t,n,r){let i=this.host.particles,a=this.style.index,o=this.rng,s=this.calm?.3:1,c=this.gain,l=i.emitted,u=this.style.tell,d=(e,t)=>e*(1-t)+t,f=e=>this.style.prism?Ad(o()+e*.01,this.tmp):(this.tmp[0]=d(u[0],.5),this.tmp[1]=d(u[1],.45),this.tmp[2]=d(u[2],.4),this.tmp);for(let l=0,u=Math.round(Sf[a]*s);l<u;l++){let a=o()*2-1,s=o()*Math.PI*2,u=Math.sqrt(1-a*a),d=(.7+1.7*o())*r,p=f(l);i.emit({x:e,y:t,z:n,vx:u*Math.cos(s)*d,vy:Math.abs(a)*d*.9+.4*r,vz:u*Math.sin(s)*d,life:.6+.6*o(),size:(.018+.022*o())*r,kind:0,r:p[0],g:p[1],b:p[2],a:.9*c,drag:1.3,grav:.8})}for(let l=0,u=Math.round(Cf[a]*s);l<u;l++){let a=o()*Math.PI*2,s=(.5+.9*o())*r;i.emit({x:e,y:t,z:n,vx:Math.cos(a)*s,vy:(.6+.9*o())*r,vz:Math.sin(a)*s,life:.8+.5*o(),size:.02*r,kind:1,r:1,g:.95,b:.85,a:.9*c,drag:1.2,grav:.5})}for(let l=0,u=Math.round(wf[a]*s);l<u;l++){let a=l/Math.max(1,u)*Math.PI*2+o()*.4,s=f(l),d=-Math.sin(a),p=Math.cos(a);i.emit({x:e+Math.cos(a)*.2*r,y:t,z:n+Math.sin(a)*.2*r,vx:(d*2.6+Math.cos(a)*.9)*r,vy:(.8+.6*o())*r,vz:(p*2.6+Math.sin(a)*.9)*r,life:.8+.3*o(),size:.03*r,kind:2,r:s[0],g:s[1],b:s[2],a:.9*c,drag:1.1})}for(let o=0,s=Math.round(Tf[a]*(this.calm?.34:1));o<s;o++)for(let a=0;a<14;a++){let s=o*2.094+a*.34,l=.05+a*.085,u=.5+.5*Math.sin(a*.5+o);i.emit({x:e+Math.cos(s)*.32*r,y:t*.3+l*r,z:n+Math.sin(s)*.32*r,vx:-Math.sin(s)*2*r,vy:.9*r,vz:Math.cos(s)*2*r,life:.9+a/14*.5,size:.034*r,kind:2,r:1-.6*u,g:.62+.2*u,b:.2+.65*u,a:.85*c,drag:1})}for(let l=0,u=Math.round(Ef[a]*s);l<u;l++){let a=o()*2-1,s=o()*Math.PI*2,l=Math.sqrt(1-a*a),u=(.5+.8*o())*r,d=Ad(o(),this.tmp);i.emit({x:e,y:t,z:n,vx:l*Math.cos(s)*u,vy:(Math.abs(a)*.8+.2)*u,vz:l*Math.sin(s)*u,life:1.6+.6*o(),size:.034*r,kind:1,r:d[0]*.5+.5,g:d[1]*.5+.5,b:d[2]*.5+.5,a:.95*c,drag:1.8,fade:2})}this.stats.burstParticles+=i.emitted-l}spawnRing(e,t,n,r,i=!0){if(this.calm){e.fx.spawn(`ring`,{x:t,y:0,z:n},r),i&&this.stats.fades++;return}this.host.flash.ring(this.host.now())&&(e.fx.spawn(`ring`,{x:t,y:0,z:n},r),i&&this.stats.rings++)}expandDome(e,t,n,r,i,a,o,s){let c=Jf(0,.6,o),l=r*(1+.9*c),u=i*(1+.8*c),d=.92*this.host.viewHalfWidth()-Math.abs(t);if(l>d){let e=Math.max(r*.9,d)/l;l*=e,u*=Math.max(e,.8)}e.set(t,n,l,u,a*(r*i/(l*u))*(1-Jf(.4,1.4,o)),s)}ringSchedule(e){let t=Df[this.style.index],n=[];for(let r=0;r<t;r++)n.push(e+r*.6);return n}},Qf=class extends Zf{cap;spec;others;keep;asideX;tb;ks;pillar;dome;rings;ringIdx=0;burst=!1;cx=0;cz=0;drop={y:.5,vy:.7,bounces:0,landed:!1,age:0};converge=!1;fadeIn=0;sq0;constructor(e,t,n){let r=t.result.tier,i=e.calm(),a=vf(r,{quick:t.quick,calm:i});super(e,r,a,n,t.result.genome.seed),this.spec=t;let o=this.style.index,s=lf[r];this.ks=a/s;let c=this.ks,l=bf[o]*c,u=.35*c,d=.3*c+l,f=.35*c;this.tb={b0:u,b1:d,b2:f,b3:a-(u+d+f),burstAt:u+d,revealAt:u+d+f},this.cap=e.takeCapsule(),!this.cap.landed&&this.cap.group.visible===!1&&this.cap.appear(0,.25),this.sq0=this.cap.squeezeAmount,this.others=e.allViews().filter(e=>e.visible),this.keep=!!t.keepCurrent,this.asideX=-Math.min(1.3,Math.max(.75,e.viewHalfWidth()*.62)),this.pillar=o===4?new Id:null,this.dome=o===5?new Fd:null,this.pillar&&e.addToScene(this.pillar.mesh),this.dome&&e.addToScene(this.dome.mesh),this.rings=this.ringSchedule(this.tb.burstAt);try{this.resultView=e.createOwned(t.result.genome,t.createBody,r)}catch(t){throw this.pillar&&(e.removeFromScene(this.pillar.mesh),this.pillar.dispose()),this.dome&&(e.removeFromScene(this.dome.mesh),this.dome.dispose()),e.returnCapsule(this.cap),this.finished=!0,this.resolveDone(),t}this.resultView.setVisible(!1),this.resultView.rarity.strength=0,this.beat(`grab`)}tick(e){let{b0:t,b1:n,burstAt:r}=this.tb,i=this.t,a=this.style,o=a.index,s=this.host,c=this.cap,l=Jf(0,Math.max(.38,.5*this.ks),i);if(this.keep)for(let e of this.others)e.proxy.offset.x=this.asideX*e.scale*l;else for(let e of this.others)e.proxy.offset.x=-3.4*l,e.rarity.strength=1-l,l>=1&&e.setVisible(!1);if(c.slideTo(0,.25,1-Math.exp(-e*7)),this.cx=c.pos.x,this.cz=c.pos.z,i<t&&(c.setSqueeze(this.sq0+(1-this.sq0)*Jf(0,t,i)),this.calm||c.wobble(.9*Math.sin(i*52)*e*12)),i>=t&&i<r){this.beat(`crack`);let l=Yf((i-t)/n),u=s.flash.tint(s.now(),a.tellFamily)===a.tellFamily?a.tell:qf,d=Jf(0,.7,l),f=Pf[o]*(this.calm?.7:1)*(o>=3?l**1.6:Jf(.05,1,l));if(c.setCrack(d,f,u,a.prism),c.setSqueeze(1),this.calm||c.wobble(Math.sin(i*61)*e*(6+22*l*l)),this.pillar){let e=Jf(r-.8*this.ks,r,i);this.pillar.set(this.cx,this.cz,.22,3.2,a.tell,.3*e)}if(this.dome&&this.dome.set(this.cx,this.cz,.62,.8,.85*Jf(0,1,l),i),this.dome&&!this.converge){this.converge=!0;let e=s.particles;e.ax=this.cx,e.ay=.35,e.az=this.cz,e.attractK=16;for(let t=0,r=Math.round(24*(this.calm?.3:1));t<r;t++){let t=this.rng()*2-1,r=this.rng()*Math.PI*2,i=Math.sqrt(1-t*t),a=1.5+.4*this.rng(),o=Ad(this.rng(),this.tmp);e.emit({x:this.cx+i*Math.cos(r)*a,y:.4+t*a*.6+.3,z:this.cz+i*Math.sin(r)*a,life:n*.98,size:.032,kind:1,r:o[0]*.5+.5,g:o[1]*.5+.5,b:o[2]*.5+.5,a:.9,attract:1,drag:1.2,spin:1.5,fade:2})}}}o>=2&&i>=.65*this.ks&&this.beat(`preroll`);let u=1;if(i>=r&&!this.burst&&this.doBurst(),this.burst){let t=jf[o][0],n=jf[o][1];if(n>0&&!this.calm){let e=i-r,a=Jf(0,.04,e)*(1-Jf(n,n+.09,e));u=1-(1-t)*a}for(this.tickResult(e*u,e),c.setCrack(1,Math.max(0,Pf[o]*this.gain*(1-(i-r)*2.2)),a.tell,a.prism);this.ringIdx<this.rings.length&&i>=this.rings[this.ringIdx];){this.ringIdx++;let e=this.resultView;e&&this.spawnRing(e,this.cx,this.cz,(Of[this.ringIdx-1]??.3)*this.gain)}this.pillar&&this.pillar.set(this.cx,this.cz,.22+.5*(i-r),3.2,a.tell,.2*this.gain*Math.max(0,1-(i-r)*1.3)),this.dome&&this.expandDome(this.dome,this.cx,this.cz,.62,.8,.85*this.gain,i-r,i)}return i>=this.tb.revealAt&&this.beat(`reveal`),this.camera(r,.5*this.ks+.2,this.duration,.3*this.tb.b3),u}doBurst(){this.burst=!0,this.beat(`burst`);let e=this.host;this.startRamp(),this.cap.burst(this.gain),e.particles.attractK=0,e.particles.clear();let t=this.resultView;t.setVisible(!0),this.drop={y:this.calm?.12:.3,vy:this.calm?0:.6,bounces:+!!this.calm,landed:!1,age:0},t.proxy.setOffset(this.cx,this.drop.y,this.cz),t.proxy.scale=this.gain<1?Kf[0]:Gf[0],e.setFraming(t.scale,this.calm),this.burstParticles(this.cx,.4,this.cz,t.scale),this.cap.wobble(0)}tickResult(e,t){let n=this.resultView;if(!n)return;let r=this.drop,i=n.proxy.offset;r.age+=e;let a=this.gain<1?Kf:Gf;n.proxy.scale=a[0]+(1-a[0])*Jf(0,a[1],r.age),i.x+=(0-i.x)*(1-Math.exp(-e*5)),i.z+=(0-i.z)*(1-Math.exp(-e*5)),this.cx=i.x,this.cz=i.z,r.vy-=9.8*e,r.y+=r.vy*e,r.y<=0&&(r.y=0,r.landed||(r.vy<-.9&&r.bounces<1?(r.vy=-r.vy*.22,r.bounces++):(r.landed=!0,r.vy=0),n.proxy.inner.nudge({x:0,y:-2.4,z:0}),n.fx.spawn(`dust`,{x:i.x,y:0,z:i.z},.7),this.host.shake(.05+.04*this.style.index))),i.y=r.y,this.fadeIn=Math.min(1,this.fadeIn+t/(this.gain<1?.7:.3)),n.rarity.strength=Jf(0,1,this.fadeIn);let o=n.mats.uniforms;o.uTierAmt.value=Math.max(0,Wf[this.style.index]*this.gain*(1-r.age/.9)),o.uTierCol.value.setRGB(this.style.tell[0],this.style.tell[1],this.style.tell[2],We),n.extraPool=Math.max(0,.5*this.gain*(1-r.age/1.2)),n.extraPoolTell=1}finalize(e){let t=this.host;if(t.particles.attractK=0,e&&t.particles.clear(),t.cameraFx.dist=1,t.cameraFx.yaw=0,t.cameraFx.pitch=0,this.cap.hide(),t.releaseCapsule(this.cap),this.pillar&&(t.removeFromScene(this.pillar.mesh),this.pillar.dispose()),this.dome&&(t.removeFromScene(this.dome.mesh),this.dome.dispose()),this.keep)for(let e of this.others)e.proxy.offset.x=this.asideX*e.scale;else for(let e of this.others)t.removeView(e);let n=this.resultView;n.setVisible(!0),n.proxy.setOffset(0,0,0),n.proxy.scale=1,n.proxy.popFrom(0,0),(e||!this.drop.landed)&&n.proxy.inner.reset(),n.rarity.strength=1,n.extraPool=0,n.extraPoolTell=0,n.core.boost=0,n.mats.uniforms.uTierAmt.value=0,n.mats.uniforms.uMixAmt.value=0,t.makePrimary(n)}},$f=class extends Zf{spec;parents=[];others;b;ks;start=[];dirX=[];dirZ=[];framing=1;coreCol0=[1,.5,.3];pillar;dome;rings=[];ringIdx=0;burst=!1;drop={y:0,vy:0,landed:!1,age:0,hopped:!1};moteAcc=0;moteSpec={x:0,y:0,z:0,vx:0,vy:0,vz:0,life:.55,size:.02,kind:0,r:1,g:1,b:1,a:.9,attract:1,spin:6,drag:.6,grav:0,fade:1};sparkled=!1;fadeIn=0;mixCol;bodyScale=1;ballCx=0;ballCy=.4;ballCz=0;layout;constructor(e,t,n){let r=t.result.tier,i=!!t.result.tierUp,a=yf(r,{tierUp:i,calm:e.calm()});super(e,r,a,n,t.result.genome.seed),this.spec=t;let o=this.style.index,s=uf[r]+(i?df:0),c=this.ks=a/s,l=.4*c,u=.5*c,d=(xf[o]-.9)*c,p=.2*c,m=a-(l+u+d+p);this.b={t0:0,t1:l,t2:l+u,t3:l+u+d,t4:l+u+d+p,a1:l,a2:u,a3:d,a4:m},this.others=e.allViews().filter(e=>e.visible);let h=Math.max(2,Math.min(3,t.parents.length));try{for(let n=0;n<h;n++){let r=t.parents[n]??t.parents[0];this.parents.push(e.createOwned(r.genome,t.createBody,r.tier??`common`))}this.resultView=e.createOwned(t.result.genome,t.createBody,r)}catch(t){for(let t of this.parents)e.removeView(t);throw this.parents.length=0,this.resultView&&e.removeView(this.resultView),this.resultView=null,this.finished=!0,this.resolveDone(),t}for(let e of this.others)e.setVisible(!1);e.parkCapsule(!0),this.resultView.setVisible(!1),this.resultView.rarity.strength=0;let g=this.resultView.scale;for(let e of this.parents)g=Math.max(g,e.scale);this.bodyScale=this.parents[0].scale;{let e=this.parents[0].mats.uniforms.uCoreCol.value;this.coreCol0[0]=e.r,this.coreCol0[1]=e.g,this.coreCol0[2]=e.b}let _=e.viewHalfWidth(g);this.layout=h===2?`pair`:_>=1.25?`row`:`triangle`;let v=Math.max(.5*g,Math.min(1.55,_*.9-.15,_-.58*g-.02)),y=this.layout===`row`?0:(this.layout===`pair`?v:v*.97)+.58*g,b=Math.min(1.5,Math.max(1,y/Math.max(.2,_))),x=this.resultView.restH*If+Bf[o]*Bf[o]/19.6,S=this.calm?1:Math.min(1.5,e.framingForHeight(x,Lf)/g),C=Math.max(b,this.calm?1:Ff[o],S);e.setFraming(C*g,!0);let w=_*C;for(let e=0;e<h;e++){if(this.layout===`pair`)this.start.push({x:e===0?-v:v,z:0});else if(this.layout===`row`)this.start.push({x:e===0?0:(e===1?-1:1)*Math.max(.9,w*.95-.3),z:0});else{let t=Math.PI/2+e*2*Math.PI/3;this.start.push({x:Math.cos(t)*v*.97,z:Math.sin(t)*1.2})}let t=this.start[e],n=Math.hypot(t.x,t.z);this.dirX.push(n>1e-6?t.x/n:1),this.dirZ.push(n>1e-6?t.z/n:0),this.parents[e].proxy.setOffset(t.x,0,t.z)}this.framing=C;let T=[0,0,0],E=t.parents.length>1?t.parents.slice(1):t.parents;for(let e of E){let t=f(e.genome);T[0]+=t.body[0]/E.length,T[1]+=t.body[1]/E.length,T[2]+=t.body[2]/E.length}this.mixCol=T,this.pillar=o===4?new Id:null,this.dome=o===5?new Fd:null,this.pillar&&e.addToScene(this.pillar.mesh),this.dome&&e.addToScene(this.dome.mesh),this.beat(`press`)}tick(e){let t=this.t,n=this.b,r=this.style,i=r.index,a=this.host,o=this.parents.length,s=this.bodyScale,c=1;if(t<n.t3){let e=Jf(0,n.a1,t),r=this.layout===`row`,i=(r?.66:.33)*s,a=Jf(n.t1,n.t2,t),c=1-Jf(n.t1+n.a2*.25,n.t2,t),l=r?Math.abs(this.start[1].x+(-i-this.start[1].x)*e)*(1-a):0;for(let s=0;s<o;s++){let u=this.parents[s],d=this.start[s],f=this.dirX[s],p=this.dirZ[s],m=r&&s===0,h=m?0:(d.x+(f*i-d.x)*e)*(1-a),g=m?0:(d.z+(p*i-d.z)*e)*(1-a);u.proxy.offset.x=h,u.proxy.offset.z=g,u.proxy.squashAx=f,u.proxy.squashAz=p,u.proxy.squashAmt=c,u.proxy.squashTwoSided=m,u.rarity.strength=1-a,u.proxy.squashPlane=r?l*.5:Math.hypot(h,g)*(o===2?1:.85),this.layout===`triangle`&&s>0&&(u.faceHidden=!0),u.core.boost=.95*Jf(n.a1*.5,n.a1,t)+.6*a,u.proxy.setFold(a),s>0&&(u.proxy.scale=1-.92*Jf(.55,1,a)),s>0&&u.proxy.scale<.1&&u.setVisible(!1)}let u=this.parents[0];u.mats.uniforms.uMixCol.value.setRGB(this.mixCol[0],this.mixCol[1],this.mixCol[2],We),u.mats.uniforms.uMixAmt.value=.7*Jf(n.t1,n.t2,t),t>=n.t1&&this.beat(`fold`)}if(t>=n.t2&&t<n.t3){this.beat(`charge`);let o=Yf((t-n.t2)/n.a3),c=this.parents[0];this.ballCx=c.proxy.center.x,this.ballCy=c.proxy.center.y,this.ballCz=c.proxy.center.z,c.proxy.tremble(this.calm?0:.2+.8*o),c.proxy.charge=.3+.7*o,c.proxy.scale=1-.1*o,c.core.boost=1+1.1*o;let l=a.flash.tint(a.now(),r.tellFamily)===r.tellFamily,u=c.mats.uniforms,d=l?r.tell:qf,f=Jf(0,.55,o);u.uTierCol.value.setRGB(d[0],d[1],d[2],We),r.prism||(c.core.tint(d[0],d[1],d[2],.8*f),u.uCoreCol.value.setRGB(this.coreCol0[0]+(d[0]-this.coreCol0[0])*f,this.coreCol0[1]+(d[1]-this.coreCol0[1])*f,this.coreCol0[2]+(d[2]-this.coreCol0[2])*f,We)),u.uTierTint.value=r.prism?0:.72*f,u.uTierAmt.value=(r.prism?.95:.4)*f,u.uMixAmt.value=.7*(1-f),c.extraPool=.5*o,c.extraPoolTell=l?o:0;let p=a.particles;p.ax=this.ballCx,p.ay=this.ballCy,p.az=this.ballCz,p.attractK=24;let m=Sf[i]*1.2*(this.calm?.3:1)/Math.max(.2,n.a3);for(this.moteAcc+=m*e;this.moteAcc>=1;){--this.moteAcc;let e=this.rng()*Math.PI*2,t=(1+.5*this.rng())*s,n=r.prism?Ad(this.rng(),this.tmp):r.tell,i=o,a=this.mixCol[0]*(1-i)+(r.prism?n[0]:r.tell[0])*i,c=this.mixCol[1]*(1-i)+(r.prism?n[1]:r.tell[1])*i,l=this.mixCol[2]*(1-i)+(r.prism?n[2]:r.tell[2])*i,u=this.moteSpec;u.x=this.ballCx+Math.cos(e)*t,u.y=this.ballCy+(this.rng()-.4)*.6*s,u.z=this.ballCz+Math.sin(e)*t,u.vx=-Math.sin(e)*1.4,u.vz=Math.cos(e)*1.4,u.size=(.02+.018*this.rng())*s,u.kind=this.rng()<.4?2:0,u.r=.35+a*1.4,u.g=.35+c*1.4,u.b=.35+l*1.4,p.emit(u)}if(this.pillar){let e=Jf(n.t3-.8*this.ks,n.t3,t);this.pillar.set(this.ballCx,this.ballCz,.25,3.2,r.tell,.3*e)}this.dome&&this.dome.set(this.ballCx,this.ballCz,.7,.9,.8*Jf(0,1,o),t)}if(t>=n.t3&&!this.burst&&this.doBurst(),this.burst){let o=jf[i][0],s=jf[i][1];if(s>0&&!this.calm){let e=t-n.t3;c=1-(1-o)*Jf(0,.04,e)*(1-Jf(s,s+.09,e))}for(this.tickResult(e*c,e);this.ringIdx<this.rings.length&&t>=this.rings[this.ringIdx];){this.ringIdx++;let e=this.resultView;e&&this.spawnRing(e,0,0,(Of[this.ringIdx-1]??.3)*this.gain)}if(this.pillar&&this.pillar.set(0,0,.25+.5*(t-n.t3),3.2,r.tell,.2*this.gain*Math.max(0,1-(t-n.t3)*1.2)),this.dome&&this.expandDome(this.dome,0,0,.7,.9,.8*this.gain,t-n.t3,t),this.spec.result.tierUp&&!this.sparkled&&t>=this.duration-.4*this.ks){this.sparkled=!0;let e=a.particles,t=this.resultView?this.resultView.scale:1;for(let n=0,i=Math.round(16*(this.calm?.3:1));n<i;n++){let n=this.rng()*Math.PI*2,i=(.15+.5*this.rng())*t,a=r.prism?Ad(this.rng(),this.tmp):r.tell;e.emit({x:Math.cos(n)*i,y:.1+.8*this.rng()*t,z:Math.sin(n)*i,vy:(1+.8*this.rng())*t,life:.9,size:.026*t,kind:1,r:a[0]*.4+.6,g:a[1]*.4+.6,b:a[2]*.4+.6,a:.95,drag:.8,fade:0})}}}return t>=n.t4&&!this.fired.has(`reveal`)&&(this.beat(`reveal`),!this.calm&&this.resultView&&a.setFraming(this.resultView.scale)),this.camera(n.t3,.45*this.ks+.2,this.duration,.3*n.a4),c}doBurst(){this.burst=!0;let e=this.host,t=this.style.index;this.beat(`burst`),this.startRamp(),e.particles.attractK=0,e.particles.clear();for(let t of this.parents)e.removeView(t);this.parents.length=0;let n=this.resultView;n.setVisible(!0),n.proxy.setOffset(0,0,0),n.proxy.scale=1,this.calm&&e.setFraming(n.scale,!0);let r=this.calm?zf:Rf;n.proxy.native.burst?n.proxy.burstOpen(this.calm?.45:1):n.proxy.popFrom(r.x0,r.v0);let i=n.mats.uniforms;i.uMixCol.value.setRGB(this.mixCol[0],this.mixCol[1],this.mixCol[2],We),i.uMixAmt.value=Uf,i.uTierAmt.value=Hf[t]*this.gain,i.uTierTint.value=0,n.extraPoolTell=1,this.drop={y:0,vy:this.calm?Vf:Bf[t],landed:!1,age:0,hopped:!0},this.rings.push(...this.ringSchedule(this.b.t3)),this.burstParticles(0,this.ballCy,0,n.scale),e.shake(Nf[t])}tickResult(e,t){let n=this.resultView;if(!n)return;let r=this.drop,i=n.proxy.offset,a=n.mats.uniforms;if(r.age+=e,r.hopped&&!r.landed){if(r.vy-=9.8*e,r.y+=r.vy*e,r.y<=0&&r.vy<0){r.y=0,r.landed=!0,r.vy=0,n.proxy.inner.nudge({x:0,y:-2.6,z:0}),n.fx.spawn(`dust`,{x:0,y:0,z:0},.8);let e=this.ringIdx<this.rings.length?this.rings[this.ringIdx]-this.t:1/0;this.style.index>=4&&e>.55&&this.spawnRing(n,0,0,.8,!1),this.host.shake(.05+.04*this.style.index)}i.y=r.y}this.fadeIn=Math.min(1,this.fadeIn+t/(this.gain<1?.7:.3)),n.rarity.strength=Jf(0,1,this.fadeIn);let o=1-Jf(0,.5,r.age);a.uTierAmt.value=Hf[this.style.index]*this.gain*o,a.uMixAmt.value=Uf*(1-Jf(0,.9,r.age)),n.extraPool=Math.max(0,this.gain*(1-r.age/1.2)),n.core.boost=Math.max(0,.5*(1-r.age/.7))}finalize(e){let t=this.host;t.particles.attractK=0,e&&t.particles.clear(),t.cameraFx.dist=1,t.cameraFx.yaw=0,t.cameraFx.pitch=0,this.pillar&&(t.removeFromScene(this.pillar.mesh),this.pillar.dispose()),this.dome&&(t.removeFromScene(this.dome.mesh),this.dome.dispose());for(let e of this.parents)t.removeView(e);this.parents.length=0;for(let e of this.others)t.removeView(e);let n=this.resultView;n.setVisible(!0),n.proxy.setOffset(0,0,0),n.proxy.scale=1,n.proxy.popFrom(0,0),(e||!this.drop.landed)&&n.proxy.inner.reset(),n.rarity.strength=1,n.extraPool=0,n.extraPoolTell=0,n.core.boost=0,n.mats.uniforms.uTierAmt.value=0,n.mats.uniforms.uMixAmt.value=0,n.mats.uniforms.uTierTint.value=0,t.makePrimary(n),t.parkCapsule(!1)}},ep=class{run=null;host;constructor(e){this.host=e}get active(){return!!this.run&&this.run.active}get current(){return this.run&&this.run.active?this.run:null}get kind(){return this.run&&this.run.active?this.run instanceof $f?`merge`:`capsule`:null}startCapsule(e,t){this.abort();let n=new Qf(this.host,{...e,result:{...e.result,tier:Td(e.result.tier)}},t);return this.run=n,n}startMerge(e,t){this.abort();let n=(e.parents&&e.parents.length?e.parents:[{genome:e.result.genome}]).map(e=>({genome:e.genome,tier:Td(e.tier)})),r=new $f(this.host,{...e,parents:n,result:{...e.result,tier:Td(e.result.tier)}},t);return this.run=r,r}abort(){let e=this.run;e&&e.active&&(e.skip(),e.step(.13)),this.run=null}update(e){let t=this.run;if(!t)return 1;let n=t.step(e);return t.active||(this.run=null),n}},tp=40,np=20,rp=.16,ip=3,ap=[[0,0],[.34,.22],[-.34,0]],op=16,sp=class{mat;t;get mesh(){return this.t.mesh}get radii(){return this.t.radii}constructor(e){this.mat=new Xi({roughness:.1,metalness:0,clearcoat:1,clearcoatRoughness:.04,transparent:!0,opacity:.9,depthWrite:!1,fog:!1}),e.apply(this.mat,1.4),this.t=new Wd(this.mat,tp,np)}build(e,t,n,r,i,a,o){this.t.build(e,t,n,r,i,a,o)}paint(e,t,n,r,i,a,o){this.mat.color.setRGB(e,t,n,We),this.mat.emissive.setRGB(i,a,o,We),this.mat.opacity=r}dispose(e){e.release(this.mat),this.mat.dispose(),this.t.dispose()}};function cp(e,t,n,r){let i=e.proxy.positions,a=e.proxy.vertexCount,o=e.proxy.center,s=0,c=-1/0;for(let e=0;e<a;e++){let a=(i[e*3]-o.x)*t+(i[e*3+1]-o.y)*n+(i[e*3+2]-o.z)*r;a>c&&(c=a,s=e)}return s}function lp(e,t,n,r){if(!e.isPiece)return null;let i=e.jelly.caps,a=null,o=.55;for(let e=0;e<i.length;e++){let s=i[e];if(!s.live||!(s.area>1e-6))continue;let c=s.nx*t+s.ny*n+s.nz*r;c>o&&(o=c,a=s)}return a}function up(e,t,n){let r=e.proxy.center,i=t.proxy.center,a=i.x-r.x,o=i.y-r.y,s=i.z-r.z,c=Math.hypot(a,o,s);c<1e-6?(a=1,o=0,s=0):(a/=c,o/=c,s/=c),n[0]=a,n[1]=o,n[2]=s}function dp(e,t,n){let r=e.length-1;for(let i=0;i<=r;i++){let a=i/r;if(a<t&&t>1e-4){let n=a/t;e[i]*=Math.sqrt(Math.max(0,1-(1-n)*(1-n)))}else if(a>n&&n<.9999){let t=(1-a)/(1-n);e[i]*=Math.sqrt(Math.max(0,1-(1-t)*(1-t)))}}}var fp=(e,t,n)=>{let r=Math.min(1,Math.max(0,(n-e)/(t-e)));return r*r*(3-2*r)},pp=class{group=new mn;events=[];eventBody=[];hub;pool=[];free=[];partings=[];bridges=[];dir=new Float32Array(3);evPool=Array.from({length:op},()=>({finger:0,tension:0,snap:!1,x:0,y:0,z:0}));lastSeam={nx:0,ny:1,nz:0,d:0,amt:0,age:1e9};calm=!1;live={strands:0,bridges:0,glow:0};constructor(e){this.hub=e,this.group.frustumCulled=!1}take(){let e=this.free.pop();if(e)return e;if(this.pool.length>=op)return null;let t=new sp(this.hub);return this.pool.push(t),this.group.add(t.mesh),t}give(e){e.mesh.visible=!1,this.free.push(e)}bodyRemoved(e){if(e.seamAmount>.02){let t=this.lastSeam,n=e.mats.uniforms.uSeam.value;t.nx=n.x,t.ny=n.y,t.nz=n.z,t.d=n.w,t.amt=e.seamAmount,t.age=0}for(let t of this.bridges)(t.a===e||t.b===e)&&(t.fading=!0,t.target=0)}part(e,t){if(e===t)return;let n=this.lastSeam;if(n.age<.5&&n.amt>.02)for(let r of[e,t])r.carrySeam(n.nx,n.ny,n.nz,n.d,n.amt);for(let n of this.partings)if(!n.done&&(n.a===e&&n.b===t||n.a===t&&n.b===e))return;let r=Math.min(1,Math.max(0,e.mats.tack*(.35+.65*e.mats.stringiness))),i=this.calm?.5:1,a=r>=.5?ip:r>=.12?2:1;if(this.free.length+(op-this.pool.length)<a)return;let o=this.dir;up(e,t,o);let s=-o[2],c=o[0],l=Math.hypot(s,c);l<1e-4?(s=1,c=0):(s/=l,c/=l);let u=Math.min(e.liveRadius,t.liveRadius),d=e.proxy.positions,f=t.proxy.positions,p=e.palette.body,m=e.palette.pale,h=[];for(let n=0;n<a;n++){let a=this.take();if(!a)break;let l=ap[n],g=cp(e,o[0]+s*l[0],o[1]+l[1],o[2]+c*l[0]),_=cp(t,-o[0]+s*l[0],-o[1]+l[1],-o[2]+c*l[0]),v=Math.max(0,(f[_*3]-d[g*3])*o[0]+(f[_*3+1]-d[g*3+1])*o[1]+(f[_*3+2]-d[g*3+2])*o[2]),y=Math.max(v,.06*u),b=n===0?1:.7;h.push({tube:a,ia:g,ib:_,L0:y,Lref:Math.max(v,.4*u),maxLen:y+u*(.1+1.5*r)*i*(1-.12*n),r0:u*(.032+.06*r)*b,T:(.24+.85*r)*(1+.22*n)*(this.calm?.7:1),phase:n*2.1,ax:d[g*3],ay:d[g*3+1],az:d[g*3+2],bx:f[_*3],by:f[_*3+1],bz:f[_*3+2],snapping:!1,snapT:0,snapLen:0,done:!1,dx:o[0],dy:o[1],dz:o[2],prog:0}),a.paint(p[0]+(m[0]-p[0])*.12,p[1]+(m[1]-p[1])*.12,p[2]+(m[2]-p[2])*.12,.35+.4*Math.min(1,r/.5),p[0]*.3,p[1]*.3,p[2]*.3),a.mesh.visible=!1}h.length&&this.partings.push({threads:h,a:e,b:t,age:0,done:!1,px:o[0],py:o[1],pz:o[2],announced:!1,seen:!1})}bridge(e,t,n){let r=Number.isFinite(n)?Math.min(1,Math.max(0,n)):0,i=null;for(let n of this.bridges)if(n.a===e&&n.b===t||n.a===t&&n.b===e){i=n;break}if(!i){if(r<=0||e===t)return;let n=this.take();if(!n)return;i={tube:n,a:e,b:t,target:0,amt:0,fading:!1,ax:0,ay:0,az:0,bx:0,by:0,bz:0,sx:0,sy:0,sz:0,tx:0,ty:0,tz:0,gap:0,ra:e.liveRadius,rb:t.liveRadius,fr:0},this.bridges.push(i);let a=e.palette.body,o=e.palette.attenuation;n.paint(a[0]+(o[0]-a[0])*.85,a[1]+(o[1]-a[1])*.85,a[2]+(o[2]-a[2])*.85,.74,0,0,0)}i.target=r>0?Math.max(r,.72):0,i.fading=!1}update(e,t){this.events.length=0,this.eventBody.length=0,this.lastSeam.age+=e;let n=0,r=0,i=0,a=this.dir;for(let t=this.partings.length-1;t>=0;t--){let r=this.partings[t];if(r.done){for(let e of r.threads)this.give(e.tube);this.partings.splice(t,1);continue}r.age+=e;let o=r.a.visible&&r.b.visible&&!r.a.isDisposed&&!r.b.isDisposed;o&&(up(r.a,r.b,a),r.px=a[0],r.py=a[1],r.pz=a[2]);let s=!0;for(let t=0;t<r.threads.length;t++){let a=r.threads[t];if(a.done)continue;if(s=!1,o&&!a.snapping){let e=r.a.proxy.positions,t=r.b.proxy.positions;a.ax=e[a.ia*3],a.ay=e[a.ia*3+1],a.az=e[a.ia*3+2],a.bx=t[a.ib*3],a.by=t[a.ib*3+1],a.bz=t[a.ib*3+2]}let c=(a.bx-a.ax)*r.px+(a.by-a.ay)*r.py+(a.bz-a.az)*r.pz,l=a.tube.radii;if(!a.snapping){let e=Math.min(1,Math.max(0,(c-a.L0)/Math.max(.001,a.maxLen-a.L0)));if(a.prog=Math.max(e,Math.min(1,r.age/a.T)),!o||c>=a.maxLen||r.age>=a.T){a.snapping=!0,a.snapT=0,a.snapLen=Math.max(0,Math.hypot(a.bx-a.ax,a.by-a.ay,a.bz-a.az)),a.dx=a.bx-a.ax,a.dy=a.by-a.ay,a.dz=a.bz-a.az;let e=Math.hypot(a.dx,a.dy,a.dz);if(e>1e-5?(a.dx/=e,a.dy/=e,a.dz/=e):(a.dx=r.px,a.dy=r.py,a.dz=r.pz),!r.announced&&n<this.evPool.length){r.announced=!0;let e=this.evPool[n++];e.finger=0,e.tension=0,e.snap=!0,e.x=(a.ax+a.bx)/2,e.y=(a.ay+a.by)/2,e.z=(a.az+a.bz)/2,this.events.push(e),this.eventBody.push(r.a.id)}}}let u=Math.min(.2*r.a.liveRadius,a.r0*2.4);if(a.snapping){if(a.snapT+=e,this.calm||a.snapT>=rp||a.snapLen<=0){a.done=!0,a.tube.mesh.visible=!1;continue}let t=a.snapT/rp,n=1-t,r=Math.sqrt(Math.max(.05,a.Lref/Math.max(a.snapLen,.001)));for(let e=0;e<=tp;e++){let i=e/tp,o=i<.5?i/.5:(1-i)/.5;l[e]=a.r0*Math.min(1,r)*.5*n*Math.max(0,1-o*(.4+.6*t)*1.6)*(1+1*(1-o)**5)}a.tube.build(a.ax-a.dx*u,a.ay-a.dy*u,a.az-a.dz*u,a.ax+a.dx*(a.snapLen+u),a.ay+a.dy*(a.snapLen+u),a.az+a.dz*(a.snapLen+u),.14*n*a.snapLen),i++;continue}if(c<=.01*r.a.liveRadius)a.tube.mesh.visible=!1;else{r.seen=!0;let e=a.bx-a.ax,o=a.by-a.ay,s=a.bz-a.az,c=Math.hypot(e,o,s)||1e-4;e/=c,o/=c,s/=c;let d=c+2*u,f=a.prog,p=Math.min(1.15,Math.sqrt(Math.max(.1,a.Lref/Math.max(c,.001)))),m=1-.86*f**1.2;for(let e=0;e<=tp;e++){let t=e/tp,n=4*t*(1-t),r=(1-n)**2.4,i=1+.16*Math.sin(t*9.4+a.phase)*n;l[e]=a.r0*p*(1+1.2*r)*(1-(1-m)*n**1.1)*i}if(dp(l,u/d,1-u/d),a.tube.build(a.ax-e*u,a.ay-o*u,a.az-s*u,a.bx+e*u,a.by+o*u,a.bz+s*u,.12+.1*f),a.tube.mesh.visible=!0,i++,t===0&&n<this.evPool.length){let e=this.evPool[n++];e.finger=0,e.tension=1-.7*f,e.snap=!1,e.x=(a.ax+a.bx)/2,e.y=(a.ay+a.by)/2,e.z=(a.az+a.bz)/2,this.events.push(e),this.eventBody.push(r.a.id)}}}s&&(r.done=!0)}let o=this.calm?.55:1;for(let n=this.bridges.length-1;n>=0;n--){let i=this.bridges[n],s=i.target>i.amt?7:i.fading?12:4.5;if(i.amt+=(i.target-i.amt)*(1-Math.exp(-e*s)),i.amt<.01&&i.target<=0){i.a.isDisposed||i.a.setSpot(0,0,0,0),i.b.isDisposed||i.b.setSpot(0,0,0,0),this.give(i.tube),this.bridges.splice(n,1);continue}let c=!i.fading&&i.a.visible&&i.b.visible&&!i.a.isDisposed&&!i.b.isDisposed;c&&(i.ra=i.a.liveRadius,i.rb=i.b.liveRadius);let l=Math.min(i.ra,i.rb),u=i.amt;if(c){up(i.a,i.b,a);let e=lp(i.a,a[0],a[1],a[2]),t=lp(i.b,-a[0],-a[1],-a[2]),n=i.a.proxy.positions,r=i.b.proxy.positions,o,s,c,d,f,p;if(e)o=e.cx,s=e.cy,c=e.cz;else{let e=cp(i.a,a[0],a[1],a[2]);o=n[e*3],s=n[e*3+1],c=n[e*3+2]}if(t)d=t.cx,f=t.cy,p=t.cz;else{let e=cp(i.b,-a[0],-a[1],-a[2]);d=r[e*3],f=r[e*3+1],p=r[e*3+2]}i.fr=e&&t?.72*Math.min(Math.sqrt(e.area/Math.PI),Math.sqrt(t.area/Math.PI)):0,i.gap=(d-o)*a[0]+(f-s)*a[1]+(p-c)*a[2];let m=i.fr>0?i.fr*(.5+.5*u):l*(.22+.33*u),h=Math.min(.6*i.ra,m*1.1),g=Math.min(.6*i.rb,m*1.1);i.ax=o-a[0]*h,i.ay=s-a[1]*h,i.az=c-a[2]*h,i.bx=o+a[0]*(Math.max(0,i.gap)+g),i.by=s+a[1]*(Math.max(0,i.gap)+g),i.bz=c+a[2]*(Math.max(0,i.gap)+g),i.sx=o,i.sy=s,i.sz=c,i.tx=d,i.ty=f,i.tz=p}let d=i.fr>0,f=d?i.fr*(.5+.5*u):l*(.22+.33*u),p=d?f*(.62-.2*u):Math.min(f,l*(.12+.4*u)),m=fp(-.25*l,.02*l,i.gap)*Math.min(1,u*6),h=i.tube.radii,g=Math.min(.6*i.ra,f*1.1),_=Math.min(.6*i.rb,f*1.1),v=Math.max(i.gap,0),y=g+v+_;for(let e=0;e<=tp;e++){let t=Math.min(1,Math.max(0,(e/tp*y-g)/Math.max(v,.001))),n=d?(1-Math.sin(Math.PI*t))**1.8:1-Math.sin(Math.PI*e/tp)**1.4;h[e]=(p+(f-p)*n)*m}{let e=Math.hypot(i.bx-i.ax,i.by-i.ay,i.bz-i.az)||1;dp(h,Math.min(.45,g/e),Math.max(.55,1-_/e))}i.tube.build(i.ax,i.ay,i.az,i.bx,i.by,i.bz,0),i.tube.mesh.visible=m>.01;let b=.55*u*o*t,x=i.a.mats.uniforms.uSeamCol.value;i.tube.mat.emissive.setRGB(x.r*b*.34,x.g*b*.34,x.b*b*.34,We),i.a.isDisposed||i.a.setSpot(i.sx,i.sy,i.sz,b*.8),i.b.isDisposed||i.b.setSpot(i.tx,i.ty,i.tz,b*.8),r=Math.max(r,b)}this.live.strands=i,this.live.bridges=this.bridges.length,this.live.glow=r}clear(){for(let e of this.partings)for(let t of e.threads)this.give(t.tube);for(let e of this.bridges)this.give(e.tube);this.partings.length=0,this.bridges.length=0,this.lastSeam.age=1e9,this.live.strands=0,this.live.bridges=0,this.live.glow=0}dispose(){this.clear();for(let e of this.pool)e.dispose(this.hub);this.pool.length=0,this.free.length=0,this.group.removeFromParent()}},mp=.25,hp=.08,gp=.4,_p=class{calm=!1;flashStarts=[];lastRing=-1e9;lastTintFamily=`other`;lastTintAt=-1e9;granted=0;refused=0;reset(){this.flashStarts.length=0,this.lastRing=-1e9,this.lastTintFamily=`other`,this.lastTintAt=-1e9,this.granted=this.refused=0}flash(e,t){let n=this.flashStarts;for(;n.length&&e-n[0]>=1;)n.shift();let r=n.length?n[n.length-1]:-1e9;return this.calm||n.length>=2||e-r<1||!(t>0)?(this.refused++,0):(n.push(e),this.granted++,Math.min(mp,t))}sinceFlash(e){let t=this.flashStarts;return t.length?e-t[t.length-1]:1/0}ring(e){return this.calm||e-this.lastRing<.5?!1:(this.lastRing=e,!0)}tint(e,t){return(t===`coral`&&this.lastTintFamily===`cyan`||t===`cyan`&&this.lastTintFamily===`coral`)&&e-this.lastTintAt<.5?this.lastTintFamily:(t!==`other`&&(this.lastTintFamily=t,this.lastTintAt=e),t)}};function vp(e){if(e<=0)return 0;if(e<.08){let t=e/hp;return t*t*(3-2*t)}let t=(e-hp)/gp;if(t>=1)return 0;let n=1-t;return n*n}var yp=.15,bp=.25,xp=.9,Sp=.55,Cp=.06,wp=.8,Tp=.42;function Ep(){if(typeof document>`u`)return null;let e=document.createElement(`canvas`);e.width=e.height=64;let t=e.getContext(`2d`);if(!t)return null;t.clearRect(0,0,64,64),t.lineCap=`round`,t.strokeStyle=`rgba(40,24,64,0.34)`,t.lineWidth=8,t.beginPath(),t.arc(32,32,20,0,Math.PI*2),t.stroke(),t.strokeStyle=`rgba(255,248,236,0.96)`,t.lineWidth=3.4,t.beginPath(),t.arc(32,32,20,0,Math.PI*2),t.stroke(),t.fillStyle=`rgba(255,248,236,0.9)`,t.beginPath(),t.arc(32,32,3.2,0,Math.PI*2),t.fill();let n=new ki(e);return n.colorSpace=Ue,n.generateMipmaps=!0,n.needsUpdate=!0,n}var Dp=class{group=new mn;shown=0;wanted=0;tex;sprites=[];mats=[];amt=new Float32Array(6);want=new Uint8Array(6);clock=0;constructor(){this.tex=Ep(),this.group.visible=!1;for(let e=0;e<6;e++){let t=new Er({map:this.tex,transparent:!0,depthTest:!1,depthWrite:!1,fog:!1,opacity:0,toneMapped:!1}),n=new Br(t);n.renderOrder=40+e*.01,n.visible=!1,n.frustumCulled=!1,this.mats.push(t),this.sprites.push(n),this.group.add(n)}}set(e){let t=e?Math.min(6,e.length):0;this.wanted=t;for(let n=0;n<6;n++)if(n<t){let t=e[n];t&&Number.isFinite(t.x)&&Number.isFinite(t.y)&&Number.isFinite(t.z)?(this.sprites[n].position.set(t.x,t.y,t.z),this.want[n]=1):this.want[n]=0}else this.want[n]=0}update(e,t,n,r){(!(e>0)||!Number.isFinite(e))&&(e=0),this.clock+=e;let i=r?1:1+Cp*Math.sin(this.clock*Math.PI*2*wp),a=Tp*(Number.isFinite(t)&&t>0?t:.5)*i,o=(r?Sp:xp)*Math.min(1,Math.max(0,Number.isFinite(n)?n:1)),s=0;for(let t=0;t<6;t++){let n=this.want[t],r=this.amt[t];n>r?r+=Math.min(n-r,e/yp):n<r&&(r-=Math.min(r-n,e/bp)),this.amt[t]=r;let i=this.sprites[t];if(r<=.004){i.visible&&=!1;continue}s++,i.visible=!0;let c=r*r*(3-2*r);i.scale.setScalar(a*(.7+.3*c)),this.mats[t].opacity=o*c}this.shown=s,this.group.visible=s>0}dispose(){for(let e of this.mats)e.dispose();this.tex?.dispose(),this.group.clear()}},Op=`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`,kp=`
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  // a soft vignette-shaped wash: brighter toward the centre of the frame, so the burst reads as light from the body, not a white-out
  vec2 p = vUv * 2.0 - 1.0;
  float k = 0.55 + 0.45 * (1.0 - smoothstep(0.0, 1.4, length(p)));
  gl_FragColor = vec4(uColor * uAlpha * k, 1.0);
}
`,Ap=`
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
void main() { gl_FragColor = vec4(texture2D(uTex, vUv).rgb, uAlpha); }
`,jp=class{light;fade;geo=new Ii(2,2);lightMat;fadeMat;snapshot=null;fadeT=0;fadeLen=.12;fadeShape=`linear`;rampAge=-1;rampAmp=0;rampCol=new Q;lightAlpha=0;constructor(){this.lightMat=new qi({vertexShader:Op,fragmentShader:kp,uniforms:{uColor:{value:new Q(1,.8,.5)},uAlpha:{value:0}},transparent:!0,depthWrite:!1,depthTest:!1,blending:2,toneMapped:!1,fog:!1}),this.light=new ai(this.geo,this.lightMat),this.light.renderOrder=1e3,this.light.frustumCulled=!1,this.light.visible=!1,this.fadeMat=new qi({vertexShader:Op,fragmentShader:Ap,uniforms:{uTex:{value:null},uAlpha:{value:0}},transparent:!0,depthWrite:!1,depthTest:!1,blending:1,toneMapped:!1,fog:!1}),this.fade=new ai(this.geo,this.fadeMat),this.fade.renderOrder=1001,this.fade.frustumCulled=!1,this.fade.visible=!1}setLight(e,t,n,r){this.lightAlpha=r,this.lightMat.uniforms.uColor.value.setRGB(e,t,n,We),this.lightMat.uniforms.uAlpha.value=r,this.light.visible=r>.002}startRamp(e,t,n,r){this.rampAge=0,this.rampAmp=e,this.rampCol.setRGB(t,n,r,We),this.setLight(t,n,r,0)}stopRamp(){this.rampAge=-1,this.setLight(0,0,0,0)}get ramping(){return this.rampAge>=0}beginCrossfade(e,t,n=`linear`){try{let r=e.getDrawingBufferSize(new Y);return(!this.snapshot||this.snapshot.image.width!==r.x||this.snapshot.image.height!==r.y)&&(this.snapshot?.dispose(),this.snapshot=new Di(r.x,r.y)),e.copyFramebufferToTexture(this.snapshot),this.fadeMat.uniforms.uTex.value=this.snapshot,this.fadeLen=Math.max(.02,t),this.fadeT=this.fadeLen,this.fadeShape=n,this.fadeMat.uniforms.uAlpha.value=1,this.fade.visible=!0,!0}catch{return this.fade.visible=!1,!1}}get crossfading(){return this.fade.visible}update(e){if(this.fade.visible){this.fadeT-=e;let t=Math.max(0,this.fadeT/this.fadeLen);this.fadeMat.uniforms.uAlpha.value=this.fadeShape===`decay`?t*t:t,t<=0&&(this.fade.visible=!1)}if(this.rampAge>=0){if(this.rampAge+=e,this.rampAge>=.08+.4)this.stopRamp();else{let e=this.rampCol;this.setLight(e.r,e.g,e.b,this.rampAmp*vp(this.rampAge))}}}dispose(){this.geo.dispose(),this.lightMat.dispose(),this.fadeMat.dispose(),this.snapshot?.dispose()}},Mp={ink:1314858,plum:2758468,dusk:5978758,felt:2761040,amber:16757575,lagoon:5887718,ember:16734797,cream:16773590},Np=-.045,Pp=`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`,Fp=`
varying vec3 vDir;

uniform vec3 uZenith; uniform vec3 uInk; uniform vec3 uPlum; uniform vec3 uHorizon;
uniform vec3 uGlowWarm; uniform vec3 uGlowCool;
uniform vec3 uBase; uniform vec3 uWarm;
uniform float uGroundY; uniform float uFogNear; uniform float uFogFar;
// the dusk glow on the horizon, by azimuth (warm toward the key light's side, a cool hint opposite)
vec3 whGlow(vec3 d) {
  vec2 az = normalize(vec2(d.x, d.z) + vec2(1e-5));
  return uGlowWarm * pow(max(dot(az, normalize(vec2(0.3, -0.95))), 0.0), 7.0) + uGlowCool * pow(max(dot(az, normalize(vec2(-0.75, -0.6))), 0.0), 6.0);
}
// the sky WITHOUT the glow (the ground haze below the horizon fogs toward this at e = 0)
vec3 whSkyBase(float e) {
  vec3 c = mix(uHorizon, uPlum, smoothstep(0.0, 0.2, e));
  c = mix(c, uInk, smoothstep(0.12, 0.6, e));
  return mix(c, uZenith, smoothstep(0.55, 1.0, e));
}
// The glow PEAKS at the horizon and fades both ways: upward over ~26 degrees, downward into the ground haze over ~9 degrees, each with
// zero slope at the horizon (C1). It used to RISE from 0 over the first 4 degrees above the horizon, and at the default pitch the frame
// top cuts the sky right inside that rise: a lighter band across the top of the frame. Now the frame top is never lighter than the
// horizon below it, at any pitch, zoom or aspect ratio.
vec3 whSky(vec3 d) {
  float e = max(d.y, 0.0);
  return whSkyBase(e) + whGlow(d) * (1.0 - smoothstep(0.0, 0.45, e));
}

${Bl}
void main() {
  vec3 d = normalize(vDir);
  vec3 sky = whSky(d);
  vec3 col = sky;
  if (d.y < 0.004) {
    float h = max(cameraPosition.y - uGroundY, 0.05);
    float t = h / max(-d.y, 1e-4);                       // distance along the ray to the ground plane
    vec2 hp = cameraPosition.xz + d.xz * t;              // hit point
    // grain fades with distance (no aliasing shimmer at grazing angles)
    vec3 ground = uBase * (0.8 + 0.4 * mix(whNoise2(hp * 1.7), 0.5, smoothstep(uFogNear, uFogFar, t))) + uWarm * exp(-length(hp) * 0.42);
    // the haze is a smooth function of the depression ANGLE, not of distance: distance fog saturated a whole range of far rays to
    // one constant colour, a flat band whose lower end read as a hard edge across the top of the frame. This one has no plateau and
    // meets the sky at the horizon with zero slope on both sides (C1), at every aspect ratio, pitch and zoom.
    float dep = -d.y;
    float fog = 1.0 - smoothstep(0.0, 0.34, dep);
    fog *= 1.0 - 0.5 * smoothstep(0.0, 0.34, dep);
    vec3 gcol = mix(ground, whSkyBase(0.0), fog) + whGlow(d) * (1.0 - smoothstep(0.0, 0.16, dep));
    col = mix(gcol, sky, smoothstep(-0.003, 0.004, d.y));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb += (whHash21(gl_FragCoord.xy) - 0.5) / 255.0;
}
`,Ip=`
varying vec3 vWP;
uniform float uMatR;
uniform float uFibre;
uniform float uOctaves;
uniform float uStitch;
uniform float uVigIn;
uniform float uVigOut;
uniform vec3 uStitchCol;
uniform vec3 uFogCol;
uniform float uFogNear;
uniform float uFogFar;
float jFibre = 0.5;
${Bl}
vec3 jBump(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`,Lp=`
#include <color_fragment>
{
  vec2 fp = vWP.xz;
  float r = length(fp);
  float fw = max(length(fwidth(fp)), 1e-5);
  // band-limited grain: each octave only contributes while its cells are ~1.5..9 px wide (no aliasing far away,
  // no visible lattice blocks up close), so the felt always reads as fine fibre
  float fib = 0.0, wsum = 0.0;
  float ang = whHash21(floor(fp * 5.0)) * 6.2832;
  vec2 rp = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * fp;
  for (int o = 0; o < 4; o++) {
    if (float(o) >= uOctaves) break;
    float fq = o == 0 ? 40.0 : o == 1 ? 110.0 : o == 2 ? 300.0 : 800.0;
    float px = 1.0 / (fq * fw);
    float wgt = smoothstep(1.2, 2.4, px) * (1.0 - smoothstep(6.0, 12.0, px));
    float n = o == 3 ? whNoise2(rp * vec2(fq * 0.5, fq * 4.0)) : whNoise2(fp * fq + float(o) * 7.3);
    fib += wgt * (n - 0.5);
    wsum += wgt;
  }
  fib = 0.5 + fib / max(0.6, wsum) * 0.55;
  jFibre = fib;
  diffuseColor.rgb *= 0.64 + 0.72 * mix(0.5, fib, uFibre);
  diffuseColor.rgb *= 0.86 + 0.28 * whNoise2(fp * 2.1 + 3.0);
  diffuseColor.rgb *= mix(1.0, 0.3, smoothstep(uVigIn, uVigOut, r));
  // stitched ring, anti-aliased against its own pixel footprint (at grazing angles near the far edge it used to alias into a
  // dotted line along the horizon): the ring widens to >= ~1.5 px and loses coverage, the dash pattern relaxes to its mean
  float fr = max(fwidth(r), 1e-5);
  float arc = atan(fp.y, fp.x) * 64.0 / 6.2832;
  float dashes = mix(0.5, step(0.5, fract(arc)), 1.0 - smoothstep(0.25, 0.6, fwidth(arc)));
  float ring = 1.0 - smoothstep(max(0.004, fr * 0.5), max(0.011, fr * 1.5), abs(r - (uMatR - 0.16)));
  ring *= min(1.0, 0.012 / (fr * 1.5));
  vec3 toCam = cameraPosition - vWP;
  ring *= smoothstep(0.17, 0.3, abs(toCam.y) / max(length(toCam), 1e-3));   // gone at grazing angles: the far rim must not read as a dotted line
  diffuseColor.rgb = mix(diffuseColor.rgb, uStitchCol, ring * dashes * uStitch);
}
`,Rp=`
#include <normal_fragment_maps>
{
  vec2 dH = vec2(dFdx(jFibre), dFdy(jFibre)) * uFibre * 0.5;
  normal = jBump(-vViewPosition, normal, dH, faceDirection);
}
`,zp=`
{
  float fogT = smoothstep(uFogNear, uFogFar, length(vWP - cameraPosition));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogCol, fogT);
}
`,Bp=new WeakMap;function Vp(e,t){let n=new Xi({color:e.color,roughness:e.roughness,metalness:0,specularIntensity:.1});t.apply(n,e.env);let r={uMatR:{value:e.matR},uFibre:{value:e.fibre},uOctaves:{value:4},uStitch:{value:e.stitch},uVigIn:{value:e.vigIn},uVigOut:{value:e.vigOut},uStitchCol:{value:new Q(Mp.dusk).multiplyScalar(1.1)},uFogCol:{value:e.fogCol},uFogNear:{value:5},uFogFar:{value:22}};return n.onBeforeCompile=e=>{Object.assign(e.uniforms,r),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
varying vec3 vWP;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
`+Ip).replace(`#include <color_fragment>`,Lp).replace(`#include <normal_fragment_maps>`,Rp).replace(`#include <fog_fragment>`,zp)},n.customProgramCacheKey=()=>`wh-felt-v3`,Bp.set(n,r),n}var Hp=class{group=new mn;sky;skyMat;matTop;feltMat;geos=[];hub;constructor(e){this.hub=e;let t=new Q(Mp.dusk).multiplyScalar(.62).convertLinearToSRGB(),n={uZenith:{value:new Q(657432)},uInk:{value:new Q(Mp.ink)},uPlum:{value:new Q(Mp.plum)},uHorizon:{value:new Q(Mp.dusk).multiplyScalar(.62)},uGlowWarm:{value:new Q(Mp.amber).multiplyScalar(.075)},uGlowCool:{value:new Q(Mp.lagoon).multiplyScalar(.02)},uBase:{value:new Q(1314346)},uWarm:{value:new Q(Mp.amber).multiplyScalar(.012)},uGroundY:{value:Np},uFogNear:{value:4},uFogFar:{value:26}};this.skyMat=new qi({vertexShader:Pp,fragmentShader:Fp,uniforms:n,side:1,depthTest:!1,depthWrite:!1,toneMapped:!1,fog:!1});let r=new Li(1,48,32);this.geos.push(r),this.sky=new ai(r,this.skyMat),this.sky.renderOrder=-100,this.sky.frustumCulled=!1,this.sky.scale.setScalar(90);let i=3.5;this.feltMat=Vp({env:.2,color:Mp.felt,roughness:.92,fibre:1,stitch:1,vigIn:.9,vigOut:i*.98,matR:i,fogCol:t},e);let a=new Pi(i,i,.06,128,1);a.translate(0,-.03,0),this.geos.push(a),this.matTop=new ai(a,this.feltMat),this.matTop.renderOrder=-50,this.group.add(this.sky,this.matTop)}setLite(e){let t=Bp.get(this.feltMat);t&&(t.uOctaves.value=e?2:4)}update(e){this.sky.position.copy(e.position)}dispose(){for(let e of this.geos)e.dispose();this.hub.release(this.feltMat),this.skyMat.dispose(),this.feltMat.dispose()}},Up=.24,Wp=[1,.8,.66,.55,.46],Gp=1.2,Kp=1.32,qp=[[0,0],[1.3,0],[-1.3,0],[2.6,0],[-2.6,0]],Jp=[[0,0],[.9,-1.3],[-.9,-1.3],[1.8,-2.6],[-1.8,-2.6]],Yp=[1,-1],Xp=[.15,0,-.25,-.5],Zp=[.14,.06,.26],Qp=[[.45,1],[.5,1],[.45,2],[0,2.2],[0,3.2],[.3,3.9],[.3,2.6],[.3,1.6],[.5,4.8],[.5,6],[.5,7.5]],$p=.42,em=4,tm=[1,1,1],nm=Object.freeze({done:Promise.resolve(),skip(){},active:!1,duration:0,resultBody:null,resultBodyId:null}),rm=Object.freeze({id:0,landed:!1,screenPoint:()=>null,hitTest:()=>!1,setSqueeze(){},wobble(){},remove(){}}),im=(e,t)=>t.sortDepth-e.sortDepth;function am(e){let t=e?._listeners;t&&t.dispose&&(t.dispose.length=0)}function om(e){let t=e=>{e&&e.isTexture&&am(e)};e.traverse(e=>{let n=e;n.geometry&&am(n.geometry);let r=Array.isArray(n.material)?n.material:n.material?[n.material]:[];for(let e of r){am(e);for(let n of Object.keys(e))t(e[n]);let n=e.uniforms;if(n)for(let e of Object.keys(n))t(n[e]?.value)}})}function sm(e){return e.style.dome>0?Math.max(1.2,1.5*e.rarity.frameFit)-1:e.style.ring>0?.12:0}function cm(e){let t=new bl({canvas:e,antialias:!0,powerPreference:`high-performance`,stencil:!1});t.toneMapping=4,t.toneMappingExposure=1,t.localClippingEnabled=!0,t.outputColorSpace=Ue,t.setClearColor(Mp.ink,1);let n=new Sn,i=new ja(35,1,.1,200),a=new Na(Mp.amber,240,0,.62,1,2);a.position.copy(Gu).multiplyScalar(5.6),a.target.position.set(0,.2,0);let o=new Ia(Mp.lagoon,2);o.position.copy(Ku).multiplyScalar(6);let s=new ya(8018632,2761040,2.4);n.add(a,a.target,o,s);let c=new ed(t,128),l=new Hp(c);n.add(l.group);let u=Xl(),d=new jp;n.add(d.light,d.fade);let f=new Sd(360,33);n.add(f.mesh);let p=new _p,m=new pp(c);n.add(m.group);let h=new Dp;n.add(h.group);let g=new Tu,_=g.tier;t.transmissionResolutionScale=Su[_].transmissionScale;let v=0,y=.27,b=1,x=v,S=y,C=b,w=new X(0,$p,0),T={dist:1,yaw:0,pitch:0},E=0,D=1,O=1,k=1,A=1,j=1,M=1,N=null,P=!1,F=0,I=!1,L=!1,ee=!1,te=0,ne=0,re=0,R=0,ie=new X,z=[],B=[],ae=null,oe=1,V=null,se=null,ce=!1,le=null,ue=0,de={top:0,right:0,bottom:72,left:0},H=new Bu,fe={e:i.matrixWorldInverse.elements,p0:1,p5:1},pe=0,me=NaN,he=NaN,ge=[],_e=[0,0,0,0],ve=new X,ye=!1,be=!1,xe=null,Se=!1,Ce=-1,we=.7,Te=!1,U=new Float64Array(64);function Ee(){let e=B.length,t=Sl.fullViews;if(e<=t||!Sl.enabled){for(let t=0;t<e;t++)B[t].setLod(0),B[t].core.setHidden(!1);return}U.length<e&&(U=new Float64Array(e*2));for(let t=0;t<e;t++){let e=B[t],n=e.proxy.frac;U[t]=(typeof n==`number`&&Number.isFinite(n)?n:1)-e.id*1e-9}for(let n=0;n<e;n++){let r=0,i=U[n];for(let t=0;t<e;t++)U[t]>i&&r++;B[n].setLod(r<t?0:1)}let n=-1,r=-1,i=.06,a=.06;for(let t=0;t<e;t++){let e=B[t];if(!e.isPiece)continue;let o=e.core.kept;o>i?(r=n,a=i,n=t,i=o):o>a&&(r=t,a=o)}for(let t=0;t<e;t++){let e=B[t];e.isPiece&&e.core.setHidden(t!==n&&t!==r)}}let De=()=>{for(let e of z)if(e.id===ae)return e;return null},Oe=e=>{for(let t of z)if(t.id===e)return t;return null},W=()=>M*Math.max(3,2.4/Math.max(.2,i.aspect)),ke=()=>Math.max(3,2.4/Math.max(.2,i.aspect))*Math.tan(i.fov*Math.PI/360)*i.aspect,G={want:1,multi:!1,mx:0,mz:0,grp:!1,gx:0,gy:0,gz:0};function Ae(e,t,n,r){let a=De(),o=N??j*(a?a.growth:1),s=0,c=0,l=!1,u=0,d=0,f=0;if(!e){let e=null,t=0,n=!0,r=0;for(let i of z){if(!i.visible)continue;let a=i.proxy.piece;if(!i.isPiece||!a||e!==null&&a.whole.restLocal!==e){n=!1;break}e=a.whole.restLocal,t++;let o=typeof i.proxy.frac==`number`&&i.proxy.frac>0?i.proxy.frac:1,s=i.proxy.center;u+=s.x*o,d+=s.y*o,f+=s.z*o,r+=o}n&&t>=2&&r>0&&(l=!0,u/=r,d/=r,f/=r)}let p=1/0,m=-1/0,h=1/0,g=-1/0,_=1/0,v=-1/0,y=1/0,b=-1/0;for(let e of z){if(!e.visible)continue;s++;let t=e.growth,n=e.proxy.center,r=Math.max(e.proxy.restRadius*1.25,e.restHalfW*1.12)*t,i=(e.restHalfW*1.06+.05*e.scale)*t;c=n.x,n.x-r<p&&(p=n.x-r),n.x+r>m&&(m=n.x+r),n.z-r<h&&(h=n.z-r),n.z+r>g&&(g=n.z+r),n.x-i<_&&(_=n.x-i),n.x+i>v&&(v=n.x+i),n.z-i<y&&(y=n.z-i),n.z+i>b&&(b=n.z+i)}if(e){let e=Up*r;t-e<p&&(p=t-e),t+e>m&&(m=t+e),n-e<h&&(h=n-e),n+e>g&&(g=n+e),t-e<_&&(_=t-e),t+e>v&&(v=t+e),n-e<y&&(y=n-e),n+e>b&&(b=n+e)}let x=ke();{let e=0;for(let t of z){if(!t.visible)continue;let n=I?0:Math.min(1,t.seamAmount/.85),r=t.growth>1.02;(r||n>.02)&&(e=Math.max(e,t.restH*t.growth*(1+.45*n)*(r?1.15:1))),n>.02&&(e=Math.max(e,Math.min(t.jelly.maxY*1.05,t.restH*t.growth*2)))}o=Math.max(o,e/($p+.85*x/Math.max(.2,i.aspect)))}if(H.wantScale>0&&(o=Math.max(o,H.wantScale)),l){let e=0;for(let t of z){if(!t.visible)continue;let n=t.proxy.center;e=Math.max(e,Math.hypot(n.x-u,n.z-f)+(t.restHalfW*(t.style.dome>0?1.34:1.06)+.05*t.scale)*t.growth)}o=Math.max(o,e/ke())}let S=s===1?De():null;S&&(o=Math.max(o,(S.restHalfW*(S.style.dome>0?1.34:1.06)+.05*S.scale)*S.growth/x));let C=!1,w=0,T=0,E=s===1&&e;if(!l&&s+ +!!e>=2){let e=E?_:p,t=E?v:m,n=E?y:h,r=E?b:g,a=E&&Math.max(c-e,t-c)+.06<=o*x;C=!a,a||(o=Math.max(o,((t-e)/2+(E?.06:.1)+(i.aspect<.9?.12:.35)*(r-n)/2)/x),w=(e+t)/2,T=(n+r)/2)}return G.want=o,G.multi=C,G.mx=w,G.mz=T,G.grp=l,G.gx=u,G.gy=d,G.gz=f,G}function je(e){let t=e?e.scale:1;i.updateMatrixWorld();let n=1/0,r=-1/0,a=1/0,o=-1/0,s=0;if(ge.length=0,Ke.active||!e)n=-.5*t,r=.5*t,a=-.5*t,o=.5*t,ge.push(Ne(n,0,a,r,1.1*t,o,[0,0,0,0]));else{for(let e of z){if(!e.visible)continue;let t=e.jelly,s=sm(e)*Math.max(t.maxX-t.minX,t.maxZ-t.minZ)*.5;n=Math.min(n,t.minX-s),r=Math.max(r,t.maxX+s),a=Math.min(a,t.minZ-s),o=Math.max(o,t.maxZ+s);let c=e.proxy.positions,l=[1/0,1/0,-1/0,-1/0];for(let e=0;e<c.length;e+=3){ve.set(c[e],c[e+1],c[e+2]).project(i);let t=(ve.x*.5+.5)*O,n=(1-(ve.y*.5+.5))*k;t<l[0]&&(l[0]=t),t>l[2]&&(l[2]=t),n<l[1]&&(l[1]=n),n>l[3]&&(l[3]=n)}ge.push(l)}Number.isFinite(n)||(n=-.5*t,r=.5*t,a=-.5*t,o=.5*t),s=e.proxy.center.z}ye=!Ke.active&&!!e;let c=ye?Ae(!1,0,0,1).want:1,l=Math.max(3,2.4/Math.max(.2,i.aspect))*b,u=(n+r)/2,d=r+Up+.14*t,f=s,p=1,m=1/0,h=Gp,g=(e,t,n)=>{let r=0;if(ye){let i=Ae(!0,e,t,n),a=i.want/Math.max(1e-6,c);i.multi&&i.mz>0&&(a*=1+i.mz*.8*Math.cos(v)*Math.cos(y)/(i.want*l)),a>h&&(r=(a-h)*2e3)}let i=Me(e,t,t<s?2:.6,n)+r+(1-n)*4;return i<m-1e-6&&(m=i,d=e,f=t,p=n),i-(1-n)*4<=0};for(let e of ye?[!1,!0]:[!1]){h=e?Kp:Gp;for(let e of Wp){let i=Up*e;for(let a of Zp)for(let o of Yp)for(let c of Xp)if(g(o>0?r+i+a*t:n-i-a*t,s+c*t,e))return{x:d,z:f,size:p}}}for(let e of Wp){let i=Up*e+.14*t;if(g(r+i*.4,a-i,e)||g(n-i*.4,a-i,e))return{x:d,z:f,size:p};for(let[t,a]of Qp)if(g(u+t*(r-n),o+a*i,e))return{x:d,z:f,size:p}}return{x:d,z:f,size:p}}function Me(e,t,n,r){let a=$d*r;ve.set(e,a/2,t).project(i);let o=(ve.x*.5+.5)*O,s=(1-(ve.y*.5+.5))*k;ve.set(e+Up*r,a/2,t).project(i);let c=Math.abs((ve.x*.5+.5)*O-o);ve.set(e,a,t).project(i);let l=Math.abs((1-(ve.y*.5+.5))*k-s),u=_e;u[0]=o-c,u[2]=o+c,u[1]=s-l,u[3]=s+l;let d=O,f=k;ve.set(e,($d/2+Up)*r,t).project(i);let p=Math.max(c,Math.max(20,Math.abs((1-(ve.y*.5+.5))*k-s)*1.35)),m=3*(Math.max(0,de.top+6-u[1])+Math.max(0,u[3]-(f-de.bottom-6)));ye||(m+=3*(Math.max(0,de.left+6-(o-p))+Math.max(0,o+p-(d-de.right-6))));for(let e of ge){let t=Math.min(u[2]+8,e[2])-Math.max(u[0]-8,e[0]);if(t<=0)continue;if(n>=1){let r=Math.min(u[3]+8,e[3])-Math.max(u[1]-8,e[1]);r>0&&(m+=n*Math.sqrt(t*r));continue}let r=e[1]+.65*(e[3]-e[1]),i=Math.min(u[3]+8,r)-Math.max(u[1]-8,e[1]),a=Math.min(u[3]+8,e[3])-Math.max(u[1]-8,r);i>0&&(m+=n*Math.sqrt(t*i)),a>0&&(m+=.2*Math.sqrt(t*a))}return m}function Ne(e,t,n,r,a,o,s){s[0]=1/0,s[1]=1/0,s[2]=-1/0,s[3]=-1/0;for(let c=0;c<8;c++){ve.set(c&1?r:e,c&2?a:t,c&4?o:n).project(i);let l=(ve.x*.5+.5)*O,u=(1-(ve.y*.5+.5))*k;l<s[0]&&(s[0]=l),l>s[2]&&(s[2]=l),u<s[1]&&(s[1]=u),u>s[3]&&(s[3]=u)}return s}function Pe(){t.setPixelRatio(Math.max(Math.min(A,Su[_].dprCap),em/Math.min(O,k))),t.setSize(O,k,!1),i.aspect=O/k,i.updateProjectionMatrix(),Ge(!0)}function Fe(){V&&!Se&&(Ce=we)}function Ie(e,t,r,i,a,o=!1){Fe();let s=new Xd(oe++,e,t,r,Su[_],c,u,i,o);return s.setCalm(I),a&&(s.proxy.setOffset(a.x,a.y,a.z),s.proxy.sync(0,0)),n.add(s.group),z.push(s),ae===null&&(ae=s.id,j=s.scale,!Ke.active&&!Te&&(M=j)),s}function Le(e){Fe();let t=z.indexOf(e);t>=0&&z.splice(t,1),m.bodyRemoved(e),e.dispose(),ae===e.id&&(ae=z.length?z[0].id:null)}function Re(){for(;z.length;)Le(z[z.length-1]);ae=null}function ze(){V&&=(V.dispose(),null),ce=!1,xe=null,Se=!1,Ce=-1}function Be(){let e=V;if(!e||Se||ce||xe||!be||!e.group.visible||e.gone||!e.landed||e.burstT>=0||e.squeezeAmount>.01)return;let t=De(),n=je(t),r=t&&!Ke.active?t.proxy.center.z:0;Me(e.pos.x,e.pos.z,e.pos.z<r?2:.6,e.size)<=.5&&e.size>=n.size-.02||(Math.hypot(n.x-e.pos.x,n.z-e.pos.z)>.03||Math.abs(n.size-e.size)>.04)&&e.glideTo(n.x,n.z,n.size)}function Ve(){se&&=(se.dispose(),null)}function He(e){_=e;let n=Su[e];t.transmissionResolutionScale=n.transmissionScale,l.setLite(e===`low`),Pe();for(let e of z)e.applyQuality(n);V?.applyTier(!n.transmission),se?.applyTier(!n.transmission),g.resetWindow(24)}function We(e,t){let n=1-Math.exp(-e*12);v+=(x-v)*n,y+=(S-y)*n,b+=(C-b)*n,H.on&&be&&!Ke.active&&pe>0?(fe.p0=i.projectionMatrix.elements[0],fe.p5=i.projectionMatrix.elements[5],H.measure(z,fe,O,k,pe,e)):H.clear();let a=N??j,o=!1,s=0,c=0,l=!1,u=0,d=0,f=0;if(!Ke.active){let e=V&&!ce&&V.group.visible?V:null,t=e?Ae(!0,e.pos.x,e.pos.z,e.size):Ae(!1,0,0,1);a=t.want,o=t.multi,s=t.mx,c=t.mz,l=t.grp,u=t.gx,d=t.gy,f=t.gz}let p=!1;if(!I){for(let e of z)if(e.visible&&e.seamAmount>.02){p=!0;break}}H.fresh&&H.bodies>0&&!Ke.active?M=a:M+=(a-M)*(1-Math.exp(-e*(p?14:4)));let m=0,h=$p*M,g=0,_=De();if(o)m=s,g=c*.8,h=$p*j;else if(l&&!Ke.active)m=u*.6,g=f*.6,h=$p*M+Math.max(0,d-$p*M)*.7;else if(_&&!Ke.active){let e=_.proxy.center;m=e.x*.6,g=e.z*.6,h=$p*M+Math.max(0,e.y-$p*M)*.7}let A=1-Math.exp(-e*6);w.x+=(m-w.x)*A,w.y+=(h-w.y)*A,w.z+=(g-w.z)*A;let P=W()*b*T.dist,F=v+T.yaw,L=r(y+T.pitch,.06,1.38),ee=Math.cos(L);i.position.set(w.x+P*Math.sin(F)*ee,w.y+P*Math.sin(L),w.z+P*Math.cos(F)*ee),E=Math.max(0,E-e*1.7);let te=E*E*D;if(te>1e-4){let e=te*.08*P/3;ie.set(Math.sin(t*47.1)+.6*Math.sin(t*71.3+1.3),Math.sin(t*53.7+2.1)+.6*Math.sin(t*83.9+.4),Math.sin(t*41.3+4.2)).multiplyScalar(e),i.position.add(ie)}i.lookAt(w),i.updateMatrixWorld(),pe=M*b*T.dist,H.ease(e),Ge(!1)}function Ge(e){let t=H.lensX,n=H.lensY;if(e||t!==me||n!==he){if(me=t,he=n,t===0&&n===0){i.view&&i.view.enabled&&i.clearViewOffset();return}i.setViewOffset(O,k,-t*O*.5,n*k*.5,O,k)}}let Ke=new ep({flash:p,screen:d,particles:f,cameraFx:T,calm:()=>I,now:()=>R,createOwned(e,t,n){return Ie(t(e),e,n,!0)},allViews:()=>z,removeView:Le,makePrimary(e){ae=e.id,e.owned=!1,j=e.scale,N=null},setFraming(e,t){N=e,t&&(M=e??j)},takeCapsule(){Ve();let e=V;return e||(e=new cf(c,u,!Su[_].transmission),e.calm=I,e.appear(0,.25,void 0,.2),n.add(e.group),ue++),V=null,xe=null,Se=!1,Ce=-1,se=e,e.sizeGoal=1,e},releaseCapsule(e){se===e?Ve():V===e&&ze()},returnCapsule(e){se===e&&(se=null,V&&ze(),V=e,e.setCrack(0,0,tm,!1),e.setSqueeze(0))},parkCapsule(e){if(!V)return;if(e){ce=!0,V.group.visible=!1,V.touchedDown=!1;return}if(!ce)return;ce=!1;let t=je(De()),n=le;le=null,V.setSize(t.size),V.appear(t.x,t.z,n??void 0)},addToScene:e=>{n.add(e)},removeFromScene:e=>{n.remove(e)},crossfade(e,r){L||ee||(t.render(n,i),d.beginCrossfade(t,e,r))},shake(e){I||Ye.shake(e)},framingForHeight:(e,t=.04)=>{let n=Math.tan(i.fov*Math.PI/360),r=Math.max(3,2.4/Math.max(.2,i.aspect))*b,a=Math.cos(y),o=Math.sin(y),s=(1-t)*n,c=a+s*o;return e*c/(s*r+$p*c)},viewHalfWidth:e=>(e===void 0?W():W()*e/M)*Math.tan(i.fov*Math.PI/360)*i.aspect}),qe=e=>{e.preventDefault(),ee=!0},Je=()=>{ee=!1,om(n);try{c.rebuild(t)}catch{}g.resetWindow(30)};e.addEventListener(`webglcontextlost`,qe,!1),e.addEventListener(`webglcontextrestored`,Je,!1),Pe();let Ye={canvas:e,camera:i,onStrand:null,setSafeInsets(e){if(!e)return;let t=!1;for(let n of[`top`,`right`,`bottom`,`left`]){let r=e[n];typeof r==`number`&&Number.isFinite(r)&&Math.max(0,r)!==de[n]&&(de[n]=Math.max(0,r),t=!0)}H.setInsets(e),t&&Fe()},matLayout(e){let t=Math.max(1,Math.min(5,Math.floor(Number.isFinite(e)?e:1))),n=j,r=[],a=i.aspect<.9?Jp:qp;for(let e=0;e<t;e++)r.push({x:a[e][0]*n,y:0,z:a[e][1]*n});return r},setBody(e,t){if(L)return;Ke.abort();let n=z.length>0;Re(),Te=n;let r=Ie(e,t,`common`,!1);Te=!1,ae=r.id,j=r.scale,N=null,n||(M=j,w.set(e.center.x*.6,$p*j,e.center.z*.6),H.fresh=!0),g.resetWindow(24)},addBody(e,t,n){if(L)return-1;for(let t of z)if(t.proxy.inner===e&&!t.isDisposed)return t.id;let r=Ie(e,t,Td(n?.tier),!1,n?.position,!!n?.chunk);return g.resetWindow(24),r.id},removeBody(e){let t=z.find(t=>t.id===e);t&&(Ke.active&&Ke.abort(),z.includes(t)&&Le(t))},clearBodies(){Ke.abort(),Re(),m.clear(),H.reset()},primaryBodyId(){return ae},setPrimaryBody(e){if(L)return;let t=z.find(t=>t.id===e&&!t.isDisposed);t&&(ae=t.id,t.owned=!1,j=t.scale,N=null)},eyeAnchors(e){let t=z.find(t=>t.id===e&&!t.isDisposed);if(!t||t.isPiece||t.chunk)return null;let n=t.face.anchors;return n?{left:{...n.left},right:{...n.right}}:null},setBodyTier(e,t){z.find(t=>t.id===e)?.setTier(Td(t))},setCalmEffects(e){I=!!e,p.calm=I;for(let e of z)e.setCalm(I);f.setTwinkle(!I),V&&(V.calm=I),se&&(se.calm=I),m.calm=I,I&&(T.dist=1,T.yaw=0,T.pitch=0,d.stopRamp())},setCutSeam(e,t,n,r){if(!L){for(let r of z)if(r.id===e){r.setSeam(t,Number.isFinite(n)?n:0);return}}},setLockMarkers(e){L||h.set(e)},partPieces(e,t){if(L)return;let n=Oe(e),r=Oe(t);n&&r&&m.part(n,r)},setBridge(e,t,n){if(L)return;let r=Oe(e),i=Oe(t);r&&i&&m.bridge(r,i,n)},dropCapsule(e){if(L)return rm;ze(),V=new cf(c,u,!Su[_].transmission);let t=V,r=++ue;Se=!!e?.at;let a=()=>{if(V!==t)return;let n=e?.at?{x:e.at.x,z:e.at.z,size:1}:je(De());t.setSize(n.size),t.calm=I,Ke.kind===`merge`?(t.placeStanding(n.x,n.z),t.group.visible=!1,t.touchedDown=!1,ce=!0,le=e?.onLand??null):I?t.appear(n.x,n.z,e?.onLand):t.drop(n.x,n.z,e?.onLand)};be||e?.at?a():(t.calm=I,t.group.visible=!1,xe=a),n.add(t.group);let o={x:0,y:0,r:0};return{id:r,get landed(){return V===t&&t.touchedDown},screenPoint(){return V===t?t.screenPoint(i,O,k,o):null},hitTest(e,n,r=14){let a=V===t?t.screenPoint(i,O,k,o):null;return!!a&&Math.hypot(e-a.x,n-a.y)<=a.r+r},setSqueeze(e){V===t&&t.setSqueeze(e)},wobble(e=1){V===t&&t.wobble(3.5*e)},remove(){V===t&&ze()}}},playCapsuleReveal(e,t){return L?nm:Ke.startCapsule(e,t)},playMergeCeremony(e,t){return L?nm:Ke.startMerge(e,t)},update(e,t){if(L)return;let n=r(Number.isFinite(e)?e:0,0,.1),a=Number.isFinite(t.time)?t.time:0;R=a;let o=Ke.update(n);if(F+=(+!!P-F)*(1-Math.exp(-n*5)),We(n,a),xe&&be){let e=xe;xe=null,e()}else Ce>=0&&(Ce-=n,Ce<0&&!Ke.active?Be():Ce<0&&(Ce=we));l.update(i);for(let e of z)e.clock+=n,e.visible&&e.update(n,e.clock,t.pointerNdc,i,F,e.owned?n*o:0);B.length=0;for(let e of z)e.visible&&B.push(e);for(let e of B){let t=e.proxy.center;e.sortDepth=(i.position.x-t.x)**2+(i.position.y-t.y)**2+(i.position.z-t.z)**2}B.sort(im);for(let e=0;e<B.length;e++)B[e].jelly.mesh.renderOrder=10+Math.min(.99,e*.01);Ee();let s=(I?.5:1)*(p.sinceFlash(a)<1?.35:1);for(let e of z)e.glowK=s;m.update(n,s),h.update(n,De()?.proxy.restRadius??.5,s,I);let c=Ye.onStrand;if(c){for(let e of z){let t=e.strands.events;for(let n=0;n<t.length;n++)try{c(e.id,t[n])}catch{}}for(let e=0;e<m.events.length;e++)try{c(m.eventBody[e],m.events[e])}catch{}}V?.update(n*o,a),se?.update(n*o,a),f.update(n*o,a),d.update(n)},render(){if(L||ee)return;let e=performance.now();if(te>0){let t=g.sample(e-te);t&&He(t)}te=e,t.render(n,i),ne=t.info.render.calls,re=t.info.render.triangles},resize(e,t,n){if(!Number.isFinite(e)||!Number.isFinite(t))return;let r=Math.max(em,Math.floor(e)),i=Math.max(em,Math.floor(t));be&&(r!==O||i!==k)&&Fe(),O=r,k=i,be=!0,A=Number.isFinite(n)&&n>0?n:1,Pe(),g.resetWindow(10)},orbit(e,t){Number.isFinite(e)&&Number.isFinite(t)&&(x-=e,S=r(S+t,.06,1.38))},zoom(e){Number.isFinite(e)&&(C=r(C*Math.exp(e*(Math.abs(e)>4?.0016:.12)),.55,1.9))},shake(e){Number.isFinite(e)&&(E=Math.min(1,E+r(e,0,1)*.85))},setShakeScale(e){D=Number.isFinite(e)?r(e,0,2):1,D===0&&(E=0)},setQuality(e){let t=g.setMode(e);t&&He(t)},setFloatMode(e){P=!!e},spawnFx(e,t,n){De()?.spawnFx(e,t,n)},dispose(){if(!L){for(L=!0,Ke.abort(),e.removeEventListener(`webglcontextlost`,qe,!1),e.removeEventListener(`webglcontextrestored`,Je,!1);z.length;)Le(z[z.length-1]);ze(),Ve(),l.dispose(),u.dispose(),d.dispose(),f.dispose(),m.dispose(),h.dispose(),c.dispose(),t.dispose()}},stats(){return{drawCalls:ne,triangles:re,tier:g.tier,frameMsEma:g.frameMsEma}}};return Ye}function lm(e){return cm(e)}export{lm as createStage};