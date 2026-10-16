'use strict';

const { createCanvas, loadImage } = require('canvas');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const http  = require('http');

const FALLBACK = path.join(process.cwd(), 'assets', 'profile.jpg');
const W = 800, H = 800;

function rng(s) { let v=s||42; return ()=>{ v=(v*16807)%2147483647; return (v-1)/2147483646; }; }
function rrect(ctx,x,y,w,h,r) {
    ctx.beginPath(); ctx.moveTo(x+r,y);
    ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();
}
function lerp(a,b,t) { return {r:Math.round(a.r+(b.r-a.r)*t),g:Math.round(a.g+(b.g-a.g)*t),b:Math.round(a.b+(b.b-a.b)*t)}; }
function rgba(c,a=1) { return `rgba(${c.r},${c.g},${c.b},${a})`; }
function trunc(ctx,text,maxW) {
    if (!text) return '';
    if (ctx.measureText(text).width<=maxW) return text;
    let t=text;
    while (ctx.measureText(t+'…').width>maxW&&t.length>0) t=t.slice(0,-1);
    return t+'…';
}
function fmtSz(bytes) {
    if (bytes>=1024*1024) return (bytes/(1024*1024)).toFixed(1)+' MB';
    return (bytes/1024).toFixed(0)+' KB';
}

async function _fetch(url,timeout=12000) {
    return new Promise((res,rej)=>{
        const mod=url.startsWith('https')?https:http;
        const req=mod.get(url,{timeout},(r)=>{
            if (r.statusCode===301||r.statusCode===302) { req.destroy(); return _fetch(r.headers.location,timeout).then(res).catch(rej); }
            if (r.statusCode!==200) { req.destroy(); return rej(new Error('HTTP '+r.statusCode)); }
            const ch=[]; r.on('data',c=>ch.push(c)); r.on('end',()=>res(Buffer.concat(ch))); r.on('error',rej);
        });
        req.on('error',rej); req.on('timeout',()=>{ req.destroy(); rej(new Error('Timeout')); });
    });
}
async function fetchImg(src) {
    if (!src) return null;
    if (Buffer.isBuffer(src)) { try { const i=await loadImage(src); if(i&&i.width>=80) return i; } catch {} return null; }
    if (/^https?:\/\//.test(src)) {
        try { const buf=await _fetch(src); if(!buf||buf.length<2000) return null; const i=await loadImage(buf); if(i&&i.width>=80) return i; } catch {}
        return null;
    }
    if (fs.existsSync(src)) { try { return await loadImage(fs.readFileSync(src)); } catch { return null; } }
    return null;
}
function extractYtId(url) {
    if (!url) return null;
    const m=url.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
    return m?m[1]:null;
}
async function fetchYtThumbnail(idOrUrl) {
    const id=/^[A-Za-z0-9_-]{11}$/.test(idOrUrl)?idOrUrl:extractYtId(idOrUrl);
    if (!id) return null;
    for (const q of ['maxresdefault','sddefault','hqdefault','mqdefault','0']) {
        const img=await fetchImg(`https://img.youtube.com/vi/${id}/${q}.jpg`);
        if (img&&img.width>=120) return img;
    }
    return null;
}
function extractPalette(img) {
    const c=createCanvas(40,40),cx=c.getContext('2d');
    cx.drawImage(img,0,0,40,40);
    const d=cx.getImageData(0,0,40,40).data,bk={};
    for (let i=0;i<d.length;i+=4) {
        if (d[i+3]<128) continue;
        const k=`${Math.round(d[i]/28)*28},${Math.round(d[i+1]/28)*28},${Math.round(d[i+2]/28)*28}`;
        bk[k]=(bk[k]||0)+1;
    }
    const sorted=Object.entries(bk).sort((a,b)=>b[1]-a[1]).slice(0,10)
        .map(([k])=>{ const [r,g,b]=k.split(',').map(Number); return {r,g,b}; });
    const vibrant=sorted.find(c=>{ const mx=Math.max(c.r,c.g,c.b),mn=Math.min(c.r,c.g,c.b); return mx>0&&(mx-mn)/mx>0.28&&(c.r+c.g+c.b)>90; })
        ||sorted[0]||{r:230,g:45,b:45};
    const dark={r:Math.round(vibrant.r*.10),g:Math.round(vibrant.g*.10),b:Math.round(vibrant.b*.10)};
    return { vibrant, dark, mid: lerp(dark,vibrant,0.25), accent: lerp(vibrant,{r:255,g:255,b:255},0.35) };
}
function stackBlur(id,W,H,radius) {
    if (radius<1) return;
    const px=id.data,div=2*radius+1,wm=W-1,hm=H-1,rp1=radius+1;
    const mul=1/(rp1*(rp1+1)/2*2+radius+1);
    const stk=Array.from({length:div},()=>[0,0,0]);
    for (let y=0;y<H;y++) {
        let ri=0,gi=0,bi=0,ro=0,go=0,bo=0,rs=0,gs=0,bs=0,sIn=radius,sOut=0;
        for (let i=-radius;i<=radius;i++) {
            const si=(y*W+Math.min(wm,Math.max(0,i)))*4,s2=i+radius;
            stk[s2]=[px[si],px[si+1],px[si+2]]; const rb=rp1-Math.abs(i);
            rs+=px[si]*rb; gs+=px[si+1]*rb; bs+=px[si+2]*rb;
            if(i>0){ri+=px[si];gi+=px[si+1];bi+=px[si+2];}
            else   {ro+=px[si];go+=px[si+1];bo+=px[si+2];}
        }
        for (let x=0;x<W;x++) {
            const idx=(y*W+x)*4;
            px[idx]=Math.round(rs*mul); px[idx+1]=Math.round(gs*mul); px[idx+2]=Math.round(bs*mul);
            rs-=ro; gs-=go; bs-=bo;
            const os=stk[sOut]; ro-=os[0]; go-=os[1]; bo-=os[2];
            const sx=Math.min(wm,x+radius+1),sid=(y*W+sx)*4;
            os[0]=px[sid]; os[1]=px[sid+1]; os[2]=px[sid+2];
            ri+=os[0]; gi+=os[1]; bi+=os[2]; rs+=ri; gs+=gi; bs+=bi;
            sIn=(sIn+1)%div; const is=stk[sIn];
            ro+=is[0]; go+=is[1]; bo+=is[2]; ri-=is[0]; gi-=is[1]; bi-=is[2];
            sOut=(sOut+1)%div;
        }
    }
    for (let x=0;x<W;x++) {
        let ri=0,gi=0,bi=0,ro=0,go=0,bo=0,rs=0,gs=0,bs=0,sIn=radius,sOut=0;
        for (let i=-radius;i<=radius;i++) {
            const sy=Math.min(hm,Math.max(0,i)),sid=(sy*W+x)*4,s2=i+radius;
            stk[s2]=[px[sid],px[sid+1],px[sid+2]]; const rb=rp1-Math.abs(i);
            rs+=px[sid]*rb; gs+=px[sid+1]*rb; bs+=px[sid+2]*rb;
            if(i>0){ri+=px[sid];gi+=px[sid+1];bi+=px[sid+2];}
            else   {ro+=px[sid];go+=px[sid+1];bo+=px[sid+2];}
        }
        for (let y=0;y<H;y++) {
            const idx=(y*W+x)*4;
            px[idx]=Math.round(rs*mul); px[idx+1]=Math.round(gs*mul); px[idx+2]=Math.round(bs*mul);
            rs-=ro; gs-=go; bs-=bo;
            const os=stk[sOut]; ro-=os[0]; go-=os[1]; bo-=os[2];
            const sy=Math.min(hm,y+radius+1),sid=(sy*W+x)*4;
            os[0]=px[sid]; os[1]=px[sid+1]; os[2]=px[sid+2];
            ri+=os[0]; gi+=os[1]; bi+=os[2]; rs+=ri; gs+=gi; bs+=bi;
            sIn=(sIn+1)%div; const is=stk[sIn];
            ro+=is[0]; go+=is[1]; bo+=is[2]; ri-=is[0]; gi-=is[1]; bi-=is[2];
            sOut=(sOut+1)%div;
        }
    }
}

function icoMusicNote(ctx,cx,cy,s,color,alpha=1) {
    ctx.save(); ctx.globalAlpha=alpha; ctx.fillStyle=color; ctx.strokeStyle=color;
    ctx.lineWidth=s*0.12; ctx.lineCap='round';
    ctx.beginPath(); ctx.ellipse(cx-s*0.20,cy+s*0.40,s*0.22,s*0.16,Math.PI*0.15,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx+s*0.30,cy+s*0.20,s*0.22,s*0.16,Math.PI*0.15,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx-s*0.20+s*0.14,cy+s*0.32); ctx.lineTo(cx+s*0.30+s*0.14,cy+s*0.12);
    ctx.lineTo(cx+s*0.30+s*0.14,cy-s*0.46); ctx.lineTo(cx-s*0.20+s*0.14,cy-s*0.26); ctx.closePath();
    ctx.fillStyle=color; ctx.fill();
    ctx.restore();
}

function icoPlay(ctx,cx,cy,s,color) {
    ctx.save(); ctx.fillStyle=color;
    ctx.beginPath(); ctx.moveTo(cx-s*0.30,cy-s*0.48); ctx.lineTo(cx+s*0.52,cy); ctx.lineTo(cx-s*0.30,cy+s*0.48); ctx.closePath();
    ctx.fill(); ctx.restore();
}

function icoClock(ctx,cx,cy,s,color) {
    ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=s*0.14; ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(cx,cy,s*0.45,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx,cy-s*0.25); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+s*0.20,cy+s*0.10); ctx.stroke();
    ctx.restore();
}

function icoPackage(ctx,cx,cy,s,color) {
    ctx.save(); ctx.strokeStyle=color; ctx.fillStyle='transparent'; ctx.lineWidth=s*0.12; ctx.lineJoin='round';
    const hs=s*0.44;
    ctx.beginPath();
    ctx.moveTo(cx,cy-hs); ctx.lineTo(cx+hs*0.88,cy-hs*0.5);
    ctx.lineTo(cx+hs*0.88,cy+hs*0.5); ctx.lineTo(cx,cy+hs);
    ctx.lineTo(cx-hs*0.88,cy+hs*0.5); ctx.lineTo(cx-hs*0.88,cy-hs*0.5); ctx.closePath(); ctx.stroke();
    ctx.lineWidth=s*0.09;
    ctx.beginPath(); ctx.moveTo(cx,cy-hs); ctx.lineTo(cx,cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx-hs*0.44,cy-hs*0.75); ctx.lineTo(cx+hs*0.44,cy-hs*0.25); ctx.stroke();
    ctx.restore();
}

function icoDownload(ctx,cx,cy,s,color) {
    ctx.save(); ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=s*0.14; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.beginPath(); ctx.moveTo(cx,cy-s*0.48); ctx.lineTo(cx,cy+s*0.10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx-s*0.35,cy-s*0.05); ctx.lineTo(cx,cy+s*0.30); ctx.lineTo(cx+s*0.35,cy-s*0.05); ctx.fill();
    ctx.lineWidth=s*0.12;
    ctx.beginPath(); ctx.moveTo(cx-s*0.52,cy+s*0.46); ctx.lineTo(cx+s*0.52,cy+s*0.46); ctx.stroke();
    ctx.restore();
}

function icoYouTube(ctx,cx,cy,s,color) {
    ctx.save();
    const rw=s*0.88, rh=s*0.62, rr=s*0.16;
    rrect(ctx,cx-rw/2,cy-rh/2,rw,rh,rr);
    ctx.fillStyle=color; ctx.fill();
    ctx.fillStyle='#ffffff';
    ctx.beginPath(); ctx.moveTo(cx-s*0.18,cy-s*0.22); ctx.lineTo(cx+s*0.32,cy); ctx.lineTo(cx-s*0.18,cy+s*0.22); ctx.closePath(); ctx.fill();
    ctx.restore();
}

function drawHexGrid(ctx,W,H,color,alpha,size) {
    ctx.save(); ctx.strokeStyle=`rgba(${color.r},${color.g},${color.b},${alpha})`; ctx.lineWidth=0.5;
    const s=size, hw=s*2, hh=Math.sqrt(3)*s;
    for (let row=-1;row<H/hh+2;row++)
        for (let col=-1;col<W/hw+2;col++) {
            const ccx=col*hw*1.5+(row%2===0?0:hw*0.75), ccy=row*hh;
            ctx.beginPath();
            for (let k=0;k<6;k++) { const a=Math.PI/180*(60*k-30); k===0?ctx.moveTo(ccx+s*Math.cos(a),ccy+s*Math.sin(a)):ctx.lineTo(ccx+s*Math.cos(a),ccy+s*Math.sin(a)); }
            ctx.closePath(); ctx.stroke();
        }
    ctx.restore();
}

function drawCircleGrid(ctx,W,H,color,alpha,spacing) {
    ctx.save(); ctx.fillStyle=`rgba(${color.r},${color.g},${color.b},${alpha})`;
    for (let y=spacing;y<H;y+=spacing)
        for (let x=spacing;x<W;x+=spacing) {
            ctx.beginPath(); ctx.arc(x,y,1.4,0,Math.PI*2); ctx.fill();
        }
    ctx.restore();
}

function drawWaveform(ctx,x,y,w,h,colorActive,colorInactive,seed) {
    const r=rng(seed), bars=56, bw=(w/bars)*0.52, gap=(w/bars)*0.48;
    const progress=0.58;
    ctx.save();
    for (let i=0;i<bars;i++) {
        const rand=r();
        const bh=( rand*0.65+0.18)*h*(i<bars*progress?1:0.7);
        const bx=x+i*(bw+gap), by=y+h/2-bh/2;
        const isActive=i<bars*progress;
        if (isActive) {
            const gr=ctx.createLinearGradient(bx,by,bx,by+bh);
            gr.addColorStop(0,colorActive.replace(/[\d.]+\)$/,'0.55)'));
            gr.addColorStop(0.5,colorActive);
            gr.addColorStop(1,colorActive.replace(/[\d.]+\)$/,'0.55)'));
            ctx.fillStyle=gr;
        } else {
            ctx.fillStyle=colorInactive;
        }
        rrect(ctx,bx,by,bw,bh,bw/2); ctx.fill();
    }
    const progressX=x+bars*progress*(bw+gap)-gap/2;
    ctx.save();
    ctx.shadowBlur=20; ctx.shadowColor=colorActive;
    ctx.beginPath(); ctx.arc(progressX,y+h/2,7,0,Math.PI*2);
    ctx.fillStyle='#fff'; ctx.fill();
    ctx.restore();
    ctx.restore();
}

function drawEqDecor(ctx,cx,cy,w,h,color,seed) {
    const r=rng(seed), bars=14, bw=w/(bars*2-1), gap=bw;
    ctx.save();
    for (let i=0;i<bars;i++) {
        const bh=(r()*0.68+0.18)*h, bx=cx-w/2+i*(bw+gap), by=cy+h-bh;
        const gr=ctx.createLinearGradient(bx,by+bh,bx,by);
        gr.addColorStop(0,color); gr.addColorStop(1,color.replace(/[\d.]+\)$/,'0.20)'));
        ctx.fillStyle=gr; rrect(ctx,bx,by,bw,bh,bw/2); ctx.fill();
    }
    ctx.restore();
}

function drawScanlines(ctx,W,H,alpha) {
    ctx.save(); ctx.globalAlpha=alpha;
    for (let y=0;y<H;y+=3) {
        ctx.fillStyle='rgba(0,0,0,1)'; ctx.fillRect(0,y,W,1);
    }
    ctx.restore();
}

function drawGlassCard(ctx,x,y,w,h,r,vibrant,bgAlpha=0.18) {
    const c=vibrant;
    ctx.save();
    ctx.shadowColor=`rgba(${c.r},${c.g},${c.b},0.35)`; ctx.shadowBlur=30; ctx.shadowOffsetY=8;
    rrect(ctx,x,y,w,h,r); ctx.fillStyle=`rgba(0,0,0,0.01)`; ctx.fill();
    ctx.restore();
    rrect(ctx,x,y,w,h,r);
    const bg=ctx.createLinearGradient(x,y,x+w,y+h);
    bg.addColorStop(0,`rgba(255,255,255,${bgAlpha*0.9})`);
    bg.addColorStop(0.5,`rgba(255,255,255,${bgAlpha*0.6})`);
    bg.addColorStop(1,`rgba(255,255,255,${bgAlpha*0.8})`);
    ctx.fillStyle=bg; ctx.fill();
    rrect(ctx,x,y,w,h,r);
    const border=ctx.createLinearGradient(x,y,x+w,y+h);
    border.addColorStop(0,`rgba(${c.r},${c.g},${c.b},0.60)`);
    border.addColorStop(0.3,`rgba(255,255,255,0.25)`);
    border.addColorStop(0.7,`rgba(${c.r},${c.g},${c.b},0.25)`);
    border.addColorStop(1,`rgba(255,255,255,0.40)`);
    ctx.strokeStyle=border; ctx.lineWidth=1.5; ctx.stroke();
    ctx.save(); rrect(ctx,x,y,w,h,r); ctx.clip();
    const shim=ctx.createLinearGradient(x+40,y,x+w-40,y);
    shim.addColorStop(0,'rgba(255,255,255,0)'); shim.addColorStop(0.45,'rgba(255,255,255,0.28)'); shim.addColorStop(0.55,'rgba(255,255,255,0.28)'); shim.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=shim; ctx.fillRect(x,y,w,2.5); ctx.restore();
}

async function createYtmp3Thumb(opts={}) {
    const title     = (opts.title   ||'YouTube Audio').slice(0,100);
    const channel   = (opts.channel ||'YouTube').slice(0,60);
    const durasiStr = opts.durasiStr||'0:00';
    const fileSize  = opts.fileSize ||0;

    let coverImg=null;
    for (const src of [opts.thumbnail,opts.image,opts.cover,opts.thumb].filter(Boolean)) {
        coverImg=await fetchImg(src); if (coverImg&&coverImg.width>=80) break;
    }
    if (!coverImg&&opts.ytUrl) coverImg=await fetchYtThumbnail(opts.ytUrl);
    if (!coverImg&&opts.thumbnail&&typeof opts.thumbnail==='string') {
        const m=opts.thumbnail.match(/\/vi\/([A-Za-z0-9_-]{11})\//); if (m) coverImg=await fetchYtThumbnail(m[1]);
    }
    if (!coverImg&&fs.existsSync(FALLBACK)) { try { coverImg=await loadImage(fs.readFileSync(FALLBACK)); } catch {} }

    const pal=coverImg?extractPalette(coverImg):{vibrant:{r:220,g:50,b:50},dark:{r:18,g:4,b:4},mid:{r:50,g:10,b:10},accent:{r:240,g:120,b:120}};
    const {vibrant,dark,mid,accent}=pal;

    const canvas=createCanvas(W,H);
    const ctx=canvas.getContext('2d');

    if (coverImg) {
        const bc=createCanvas(W,H), bx=bc.getContext('2d');
        const sc=Math.max(W/coverImg.width,H/coverImg.height);
        bx.drawImage(coverImg,(W-coverImg.width*sc)/2,(H-coverImg.height*sc)/2,coverImg.width*sc,coverImg.height*sc);
        const id=bx.getImageData(0,0,W,H); stackBlur(id,W,H,38); bx.putImageData(id,0,0);
        ctx.drawImage(bc,0,0);
    } else {
        const g=ctx.createLinearGradient(0,0,W,H);
        g.addColorStop(0,rgba(dark)); g.addColorStop(0.5,rgba(mid)); g.addColorStop(1,rgba(dark));
        ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    }

    ctx.fillStyle='rgba(0,0,0,0.76)'; ctx.fillRect(0,0,W,H);

    const ra1=ctx.createRadialGradient(W*0.22,H*0.28,0,W*0.22,H*0.28,W*0.60);
    ra1.addColorStop(0,rgba(vibrant,0.22)); ra1.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=ra1; ctx.fillRect(0,0,W,H);
    const ra2=ctx.createRadialGradient(W*0.82,H*0.78,0,W*0.82,H*0.78,W*0.50);
    ra2.addColorStop(0,rgba(vibrant,0.12)); ra2.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=ra2; ctx.fillRect(0,0,W,H);

    drawHexGrid(ctx,W,H,vibrant,0.04,38);
    drawCircleGrid(ctx,W,H,vibrant,0.07,52);
    drawScanlines(ctx,W,H,0.012);

    const pr=rng(31337);
    for (let i=0;i<160;i++) {
        ctx.beginPath(); ctx.arc(pr()*W,pr()*H,pr()*1.1+0.3,0,Math.PI*2);
        ctx.fillStyle=`rgba(255,255,255,${pr()*0.06+0.01})`; ctx.fill();
    }

    icoMusicNote(ctx,W*0.84,H*0.11,28,rgba(vibrant,1),0.14);
    icoMusicNote(ctx,W*0.91,H*0.32,16,rgba(accent,1),0.09);
    icoMusicNote(ctx,W*0.75,H*0.90,20,rgba(vibrant,1),0.08);
    icoMusicNote(ctx,W*0.10,H*0.82,15,'rgba(255,255,255,1)',0.06);
    icoMusicNote(ctx,W*0.06,H*0.18,12,'rgba(255,255,255,1)',0.05);

    const MAINW=W*0.86, MAINH=H*0.92;
    const MAINX=(W-MAINW)/2, MAINY=(H-MAINH)/2;
    drawGlassCard(ctx,MAINX,MAINY,MAINW,MAINH,28,vibrant,0.10);

    const COVS=MAINW*0.50, COVX=MAINX+(MAINW-COVS)/2, COVY=MAINY+32;

    ctx.save();
    ctx.shadowColor=rgba(vibrant,0.60); ctx.shadowBlur=60; ctx.shadowOffsetY=20;
    rrect(ctx,COVX,COVY,COVS,COVS,24); ctx.fillStyle='rgba(0,0,0,0.01)'; ctx.fill();
    ctx.restore();

    const ringR=COVS*0.54+8;
    const ringGrad=ctx.createLinearGradient(COVX+COVS/2-ringR,COVY+COVS/2-ringR,COVX+COVS/2+ringR,COVY+COVS/2+ringR);
    ringGrad.addColorStop(0,rgba(accent,0.85)); ringGrad.addColorStop(0.5,rgba(vibrant,0.40)); ringGrad.addColorStop(1,rgba(accent,0.85));
    ctx.save(); ctx.strokeStyle=ringGrad; ctx.lineWidth=3;
    ctx.shadowColor=rgba(vibrant,0.80); ctx.shadowBlur=20;
    ctx.beginPath(); ctx.arc(COVX+COVS/2,COVY+COVS/2,ringR,0,Math.PI*2); ctx.stroke(); ctx.restore();

    ctx.save(); rrect(ctx,COVX,COVY,COVS,COVS,24); ctx.clip();
    if (coverImg) {
        const sc=Math.max(COVS/coverImg.width,COVS/coverImg.height);
        ctx.drawImage(coverImg,COVX+(COVS-coverImg.width*sc)/2,COVY+(COVS-coverImg.height*sc)/2,coverImg.width*sc,coverImg.height*sc);
    } else {
        const g=ctx.createLinearGradient(COVX,COVY,COVX+COVS,COVY+COVS);
        g.addColorStop(0,rgba(lerp(dark,vibrant,0.65))); g.addColorStop(1,rgba(dark));
        ctx.fillStyle=g; ctx.fillRect(COVX,COVY,COVS,COVS);
        icoMusicNote(ctx,COVX+COVS/2,COVY+COVS/2,COVS*0.26,'#fff',0.32);
    }
    const vig=ctx.createRadialGradient(COVX+COVS/2,COVY+COVS/2,COVS*0.18,COVX+COVS/2,COVY+COVS/2,COVS*0.74);
    vig.addColorStop(0,'rgba(0,0,0,0)'); vig.addColorStop(1,'rgba(0,0,0,0.45)');
    ctx.fillStyle=vig; ctx.fillRect(COVX,COVY,COVS,COVS);
    ctx.restore();

    rrect(ctx,COVX,COVY,COVS,COVS,24);
    const cb=ctx.createLinearGradient(COVX,COVY,COVX+COVS,COVY+COVS);
    cb.addColorStop(0,rgba(vibrant,0.85)); cb.addColorStop(0.5,'rgba(255,255,255,0.22)'); cb.addColorStop(1,rgba(vibrant,0.40));
    ctx.strokeStyle=cb; ctx.lineWidth=2.5; ctx.stroke();

    const BDW=70,BDH=26,BDX=COVX+12,BDY=COVY+12;
    drawGlassCard(ctx,BDX,BDY,BDW,BDH,BDH/2,vibrant,0.22);
    ctx.save(); ctx.font='bold 13px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='#fff'; ctx.shadowColor=rgba(vibrant,1); ctx.shadowBlur=10;
    ctx.fillText('MP3',BDX+BDW/2,BDY+BDH/2); ctx.restore();

    drawEqDecor(ctx,COVX+COVS-14,COVY+COVS-4,68,30,rgba(vibrant,0.75),9911);

    const WAVEY=COVY+COVS+30, WAVEW=MAINW-60, WAVEH=46;
    const WAVEX=MAINX+30;
    drawWaveform(ctx,WAVEX,WAVEY,WAVEW,WAVEH,rgba(vibrant,0.92),'rgba(255,255,255,0.12)',5544);

    ctx.save(); ctx.font='bold 11px sans-serif'; ctx.textBaseline='top';
    ctx.shadowColor=rgba(vibrant,0.50); ctx.shadowBlur=6;
    ctx.fillStyle=rgba(vibrant,0.85);
    ctx.textAlign='left';  ctx.fillText('0:00',WAVEX,WAVEY+WAVEH+7);
    ctx.textAlign='right'; ctx.fillText(durasiStr,WAVEX+WAVEW,WAVEY+WAVEH+7);
    ctx.restore();

    const TY=WAVEY+WAVEH+38;
    ctx.save(); ctx.font='bold 30px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.shadowColor=rgba(vibrant,0.60); ctx.shadowBlur=20;
    const maxTW=MAINW-60, words=title.split(' ');
    let l1='',l2='';
    for (const w of words) {
        const test=l1?l1+' '+w:w;
        if (ctx.measureText(test).width<=maxTW) l1=test; else l2+=(l2?' ':'')+w;
    }
    const gradT=ctx.createLinearGradient(W/2-maxTW/2,TY,W/2+maxTW/2,TY);
    gradT.addColorStop(0,'#ffffff'); gradT.addColorStop(0.5,rgba(accent,1)); gradT.addColorStop(1,'#ffffff');
    ctx.fillStyle=gradT; ctx.fillText(l1,W/2,TY);
    if (l2) {
        let tl2=l2;
        ctx.font='bold 28px sans-serif';
        while (ctx.measureText(tl2+'…').width>maxTW&&tl2.length>0) tl2=tl2.slice(0,-1);
        if (tl2!==l2) tl2+='…';
        ctx.fillStyle=gradT; ctx.fillText(tl2,W/2,TY+38);
    }
    ctx.restore();

    const CY2=TY+(l2?84:48);
    const dotX=W/2-ctx.measureText(channel).width/2-14;
    ctx.save(); ctx.beginPath(); ctx.arc(dotX+6,CY2+7,4,0,Math.PI*2);
    ctx.fillStyle=rgba(vibrant,0.90); ctx.shadowColor=rgba(vibrant,1); ctx.shadowBlur=8; ctx.fill(); ctx.restore();
    ctx.save(); ctx.font='14px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillStyle=rgba(vibrant,0.82);
    ctx.fillText(channel,dotX+16,CY2); ctx.restore();

    const CHIPY=CY2+34, CHIPW=MAINW*0.27, CHIPH=52, CHIPGAP=MAINW*0.025;
    const chipTW=3*CHIPW+2*CHIPGAP, chipSX=MAINX+(MAINW-chipTW)/2;

    const chipDefs=[
        { draw:(cx,cy,s,col)=>icoClock(ctx,cx,cy,s,col),    label:'DURASI',   value:durasiStr },
        { draw:(cx,cy,s,col)=>icoPackage(ctx,cx,cy,s,col),  label:'UKURAN',   value:fileSize>0?fmtSz(fileSize):'MP3' },
        { draw:(cx,cy,s,col)=>icoYouTube(ctx,cx,cy,s,col),  label:'SUMBER',   value:'YouTube' },
    ];

    chipDefs.forEach((chip,i)=>{
        const cx=chipSX+i*(CHIPW+CHIPGAP), cy=CHIPY;
        drawGlassCard(ctx,cx,cy,CHIPW,CHIPH,14,vibrant,0.14);
        const icoCx=cx+CHIPW*0.28, icoCy=cy+CHIPH*0.42;
        chip.draw(icoCx,icoCy,11,rgba(vibrant,0.90));
        ctx.save();
        ctx.font='bold 13px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
        ctx.fillStyle='rgba(255,255,255,0.90)';
        const valX=cx+CHIPW*0.46;
        ctx.fillText(trunc(ctx,chip.value,CHIPW*0.50),valX,cy+CHIPH*0.38);
        ctx.font='9px sans-serif'; ctx.fillStyle='rgba(255,255,255,0.40)';
        ctx.fillText(chip.label,valX,cy+CHIPH*0.70);
        ctx.restore();
    });

    const DOWY=CHIPY+CHIPH+26;
    const DOWW=MAINW*0.60, DOWH=46, DOWX=MAINX+(MAINW-DOWW)/2;
    drawGlassCard(ctx,DOWX,DOWY,DOWW,DOWH,DOWH/2,vibrant,0.16);
    ctx.save(); ctx.shadowColor=rgba(vibrant,0.80); ctx.shadowBlur=16;
    icoDownload(ctx,DOWX+28,DOWY+DOWH/2,14,rgba(vibrant,1));
    ctx.font='bold 14px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillStyle='#ffffff'; ctx.fillText('Download Audio',DOWX+50,DOWY+DOWH/2);
    ctx.restore();

    ctx.save(); ctx.font='11px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='bottom';
    ctx.fillStyle='rgba(255,255,255,0.18)';
    ctx.fillText(`${global?.namaBot||'BulterBot'}  ✦  YouTube MP3 Downloader`,W/2,H-14);
    ctx.restore();

    const fr=ctx.createLinearGradient(0,0,W,H);
    fr.addColorStop(0,rgba(vibrant,0.70)); fr.addColorStop(0.25,'rgba(255,255,255,0.12)');
    fr.addColorStop(0.5,rgba(vibrant,0.35)); fr.addColorStop(0.75,'rgba(255,255,255,0.08)');
    fr.addColorStop(1,rgba(vibrant,0.70));
    rrect(ctx,2,2,W-4,H-4,14); ctx.strokeStyle=fr; ctx.lineWidth=2.5; ctx.stroke();

    [[20,20],[W-20,20],[20,H-20],[W-20,H-20]].forEach(([px,py])=>{
        ctx.save(); ctx.fillStyle=rgba(vibrant,0.60); ctx.shadowColor=rgba(vibrant,0.80); ctx.shadowBlur=10;
        ctx.beginPath(); ctx.arc(px,py,3.5,0,Math.PI*2); ctx.fill(); ctx.restore();
    });

    return canvas.toBuffer('image/jpeg',{quality:0.95});
}

module.exports = { createYtmp3Thumb };
