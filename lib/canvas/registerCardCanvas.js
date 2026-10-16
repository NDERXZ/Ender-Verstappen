'use strict';
const { createCanvas, loadImage } = (() => {
    try { return require('canvas'); } catch {}
    try {
        const skia = require('skia-canvas');
        return {
            createCanvas: (w, h) => new skia.Canvas(w, h),
            loadImage: (src) => skia.loadImage(src)
        };
    } catch {}
    return { createCanvas: null, loadImage: null };
})();
const path = require('path');
const fs   = require('fs');
const https = require('https');
const http  = require('http');

const FALLBACK = path.join(process.cwd(), 'assets', 'profile.jpg');
const h2r = (hex) => { const h=hex.replace('#',''); return {r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16)}; };
const rgba = (hex,a) => { const c=h2r(hex); return `rgba(${c.r},${c.g},${c.b},${a})`; };

function rrect(ctx,x,y,w,h,r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

function trunc(ctx,text,maxW) {
    if (!text) return ''; if (ctx.measureText(text).width<=maxW) return text;
    let t=text; while(ctx.measureText(t+'…').width>maxW&&t.length>0) t=t.slice(0,-1); return t+'…';
}

const clip = (ctx,fn) => { ctx.save(); fn(); ctx.restore(); };
async function fetchImg(src) {
    if (!src) return null;
    if (Buffer.isBuffer(src)) { try { return await loadImage(src); } catch { return null; } }
    if (typeof src === 'string') {
        if (src.startsWith('http')) {
            try { return await loadImage(src); } catch {}
            try {
                const buf = await new Promise((res,rej) => {
                    const mod = src.startsWith('https') ? https : http;
                    mod.get(src,{timeout:15000},r => {
                        const ch=[]; r.on('data',c=>ch.push(c)); r.on('end',()=>res(Buffer.concat(ch))); r.on('error',rej);
                    }).on('error',rej);
                });
                return await loadImage(buf);
            } catch { return null; }
        }
        if (fs.existsSync(src)) { try { return await loadImage(fs.readFileSync(src)); } catch { return null; } }
    }
    return null;
}

async function getAv(src) {
    const img = await fetchImg(src); if (img) return img;
    if (fs.existsSync(FALLBACK)) { try { return await loadImage(fs.readFileSync(FALLBACK)); } catch {} }
    // Generated silhouette
    const c=createCanvas(200,200); const cx=c.getContext('2d');
    const g=cx.createLinearGradient(0,0,200,200); g.addColorStop(0,'#1a1a2e'); g.addColorStop(1,'#16213e');
    cx.fillStyle=g; cx.beginPath(); cx.arc(100,100,100,0,Math.PI*2); cx.fill();
    cx.fillStyle='#2d3561'; cx.beginPath(); cx.arc(100,80,35,0,Math.PI*2); cx.fill();
    cx.beginPath(); cx.ellipse(100,175,50,35,0,Math.PI,0,true); cx.fill();
    return await loadImage(c.toBuffer());
}

async function generateRegisterCard(opts={}) {
    const {
        name='Member', userId='USR-000000', dob=null, age=null,
        bio='new recruit', avatarUrl=null, network='BulterBot',
        cardType='starter', status='active',
    } = opts;

    const W=900, H=480;
    const canvas=createCanvas(W,H); const ctx=canvas.getContext('2d');

    const bg=ctx.createLinearGradient(0,0,W,H);
    bg.addColorStop(0,'#04080F'); bg.addColorStop(0.45,'#080E1A'); bg.addColorStop(1,'#030609');
    ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

    // Ambient orbs
    [{x:160,y:110,r:250,hex:'#7C3AED'},{x:W-130,y:H-90,r:230,hex:'#0EA5E9'},
     {x:W/2,y:H*0.6,r:190,hex:'#10B981'},{x:W*0.72,y:70,r:170,hex:'#F59E0B'}]
    .forEach(o=>{
        const g=ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r);
        g.addColorStop(0,rgba(o.hex,0.09)); g.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,Math.PI*2); ctx.fill();
    });

    // Hex grid
    ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.020)'; ctx.lineWidth=0.5;
    const hs=38, hh=Math.sqrt(3)*hs;
    for(let row=-1;row<H/hh+2;row++) for(let col=-1;col<W/(hs*1.5)+2;col++){
        const cx2=col*hs*1.5+(row%2===0?0:hs*0.75),cy2=row*hh;
        ctx.beginPath();
        for(let k=0;k<6;k++){const a=Math.PI/180*(60*k-30);k===0?ctx.moveTo(cx2+hs*Math.cos(a),cy2+hs*Math.sin(a)):ctx.lineTo(cx2+hs*Math.cos(a),cy2+hs*Math.sin(a));}
        ctx.closePath(); ctx.stroke();
    }
    ctx.restore();

    // Stars
    const rng=(s=42)=>{let v=s;return()=>{v=(v*16807)%2147483647;return(v-1)/2147483646;};};
    const rand=rng(77);
    for(let i=0;i<90;i++){const sx=rand()*W,sy=rand()*H,sr=rand()*1.2+0.2,sa=rand()*0.4+0.05;ctx.beginPath();ctx.arc(sx,sy,sr,0,Math.PI*2);ctx.fillStyle=`rgba(255,255,255,${sa})`;ctx.fill();}

    // Light beams
    const rng2=rng(13);
    ctx.save(); ctx.globalCompositeOperation='screen';
    for(let i=0;i<5;i++){
        const x1=rng2()*W*0.5,y1=-20,x2=x1+rng2()*W*0.7,y2=H+20;
        const w2=rng2()*70+20,a2=rng2()*0.03+0.008;
        const g2=ctx.createLinearGradient(x1,y1,x2,y2);
        g2.addColorStop(0,'rgba(124,58,237,0)'); g2.addColorStop(0.5,`rgba(124,58,237,${a2})`); g2.addColorStop(1,'rgba(124,58,237,0)');
        ctx.fillStyle=g2;
        const ang=Math.atan2(y2-y1,x2-x1),nx=Math.cos(ang+Math.PI/2)*w2/2,ny=Math.sin(ang+Math.PI/2)*w2/2;
        ctx.beginPath(); ctx.moveTo(x1-nx,y1-ny); ctx.lineTo(x1+nx,y1+ny); ctx.lineTo(x2+nx,y2+ny); ctx.lineTo(x2-nx,y2-ny); ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation='source-over'; ctx.restore();

    // Scanlines
    ctx.save(); ctx.globalAlpha=0.015; ctx.fillStyle='rgba(0,0,0,0.6)';
    for(let y=0;y<H;y+=2) ctx.fillRect(0,y,W,1);
    ctx.restore();


    const cx3=22,cy3=22,cw=W-44,ch=H-44,cr=20;
    ctx.save(); ctx.shadowColor='rgba(124,58,237,0.28)'; ctx.shadowBlur=44; ctx.shadowOffsetY=9;
    rrect(ctx,cx3,cy3,cw,ch,cr);
    const cbg=ctx.createLinearGradient(cx3,cy3,cx3+cw,cy3+ch);
    cbg.addColorStop(0,'rgba(11,16,30,0.97)'); cbg.addColorStop(0.5,'rgba(13,20,36,0.95)'); cbg.addColorStop(1,'rgba(9,14,26,0.97)');
    ctx.fillStyle=cbg; ctx.fill(); ctx.restore();

    // Top rim + glow
    clip(ctx,()=>{
        rrect(ctx,cx3,cy3,cw,ch,cr); ctx.clip();
        const rim=ctx.createLinearGradient(cx3+50,cy3,cx3+cw-50,cy3);
        rim.addColorStop(0,'rgba(0,0,0,0)'); rim.addColorStop(0.25,'rgba(124,58,237,0.7)');
        rim.addColorStop(0.5,'rgba(14,165,233,0.95)'); rim.addColorStop(0.75,'rgba(16,185,129,0.7)'); rim.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=rim; ctx.fillRect(cx3,cy3,cw,2.5);
        const gr2=ctx.createLinearGradient(cx3+80,cy3,cx3+cw-80,cy3+20);
        gr2.addColorStop(0,'rgba(0,0,0,0)'); gr2.addColorStop(0.5,'rgba(124,58,237,0.12)'); gr2.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=gr2; ctx.fillRect(cx3,cy3+2.5,cw,18);
    });

    // Card border
    rrect(ctx,cx3,cy3,cw,ch,cr);
    const cbd=ctx.createLinearGradient(cx3,cy3,cx3+cw,cy3+ch);
    cbd.addColorStop(0,'rgba(124,58,237,0.60)'); cbd.addColorStop(0.3,'rgba(14,165,233,0.15)');
    cbd.addColorStop(0.7,'rgba(16,185,129,0.15)'); cbd.addColorStop(1,'rgba(124,58,237,0.60)');
    ctx.strokeStyle=cbd; ctx.lineWidth=1.2; ctx.stroke();

    // Left accent bar
    const lb=ctx.createLinearGradient(cx3+2,cy3+50,cx3+2,cy3+ch-50);
    lb.addColorStop(0,'rgba(0,0,0,0)'); lb.addColorStop(0.4,'rgba(124,58,237,0.85)');
    lb.addColorStop(0.6,'rgba(14,165,233,0.85)'); lb.addColorStop(1,'rgba(0,0,0,0)');
    ctx.save(); ctx.strokeStyle=lb; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.moveTo(cx3+2,cy3+50); ctx.lineTo(cx3+2,cy3+ch-50); ctx.stroke(); ctx.restore();

    // HUD brackets
    [[32,32,1,1],[W-32,32,-1,1],[32,H-32,1,-1],[W-32,H-32,-1,-1]].forEach(([x,y,sx,sy])=>{
        ctx.save(); ctx.strokeStyle='rgba(124,58,237,0.32)'; ctx.lineWidth=1.6; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(x,y+sy*26); ctx.lineTo(x,y); ctx.lineTo(x+sx*26,y); ctx.stroke();
        ctx.restore();
    });


    ctx.save(); ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font='bold 10px sans-serif'; ctx.fillStyle='rgba(167,139,250,0.85)';
    ctx.shadowColor='rgba(124,58,237,0.8)'; ctx.shadowBlur=16;
    ctx.fillText('P R O F I L E   R E G I S T E R E D', W/2, 50); ctx.restore();

    const sep=(x1,x2,y,colors)=>{const g=ctx.createLinearGradient(x1,y,x2,y);g.addColorStop(0,'rgba(0,0,0,0)');colors.forEach((c,i)=>g.addColorStop(0.1+i*0.8/(colors.length-1),c));g.addColorStop(1,'rgba(0,0,0,0)');ctx.save();ctx.strokeStyle=g;ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke();ctx.restore();};
    sep(W/2-130,W/2+130,64,['rgba(124,58,237,0.45)','rgba(14,165,233,0.45)']);


    const avCx=W/2, avCy=168, avR=64;
    const avImg=await getAv(avatarUrl);

    // Halo
    const halo=ctx.createRadialGradient(avCx,avCy,avR*0.5,avCx,avCy,avR+55);
    halo.addColorStop(0,'rgba(124,58,237,0.20)'); halo.addColorStop(0.5,'rgba(14,165,233,0.07)'); halo.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=halo; ctx.beginPath(); ctx.arc(avCx,avCy,avR+55,0,Math.PI*2); ctx.fill();

    // Dashed orbit
    ctx.save(); ctx.setLineDash([4,10]); ctx.lineWidth=0.8; ctx.strokeStyle='rgba(124,58,237,0.22)';
    ctx.beginPath(); ctx.arc(avCx,avCy,avR+18,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]); ctx.restore();

    // Orbital dots
    for(let i=0;i<8;i++){const a=(Math.PI*2/8)*i,dx=avCx+Math.cos(a)*(avR+18),dy=avCy+Math.sin(a)*(avR+18);const dg=ctx.createRadialGradient(dx,dy,0,dx,dy,4);dg.addColorStop(0,'rgba(167,139,250,0.9)');dg.addColorStop(1,'rgba(167,139,250,0)');ctx.beginPath();ctx.arc(dx,dy,3.2,0,Math.PI*2);ctx.fillStyle=dg;ctx.fill();}

    // Ring gradient
    ctx.save();
    const rg=ctx.createLinearGradient(avCx-avR,avCy-avR,avCx+avR,avCy+avR);
    rg.addColorStop(0,'#A78BFA'); rg.addColorStop(0.33,'#38BDF8'); rg.addColorStop(0.66,'#34D399'); rg.addColorStop(1,'#A78BFA');
    ctx.strokeStyle=rg; ctx.lineWidth=3.5; ctx.shadowColor='rgba(167,139,250,0.8)'; ctx.shadowBlur=20;
    ctx.beginPath(); ctx.arc(avCx,avCy,avR+5,0,Math.PI*2); ctx.stroke(); ctx.restore();

    // Inner white ring
    ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(avCx,avCy,avR+2,0,Math.PI*2); ctx.stroke(); ctx.restore();

    // Avatar clip
    clip(ctx,()=>{
        ctx.beginPath(); ctx.arc(avCx,avCy,avR,0,Math.PI*2); ctx.clip();
        ctx.drawImage(avImg,avCx-avR,avCy-avR,avR*2,avR*2);
        const vig=ctx.createRadialGradient(avCx,avCy,avR*0.35,avCx,avCy,avR);
        vig.addColorStop(0,'rgba(0,0,0,0)'); vig.addColorStop(1,'rgba(0,0,0,0.38)');
        ctx.fillStyle=vig; ctx.fillRect(avCx-avR,avCy-avR,avR*2,avR*2);
    });

    // Status badge
    const bx=avCx+avR*0.72, by=avCy+avR*0.72;
    ctx.beginPath(); ctx.arc(bx,by,13,0,Math.PI*2); ctx.fillStyle='#080E1A'; ctx.fill();
    const bg2=ctx.createRadialGradient(bx-2,by-2,0,bx,by,10);
    bg2.addColorStop(0,'#34D399'); bg2.addColorStop(1,'#10B981');
    ctx.beginPath(); ctx.arc(bx,by,10,0,Math.PI*2);
    ctx.shadowColor='rgba(52,211,153,0.8)'; ctx.shadowBlur=14; ctx.fillStyle=bg2; ctx.fill(); ctx.shadowBlur=0;
    ctx.fillStyle='#fff'; ctx.font='bold 11px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('✓',bx,by);


    const nameY=256;
    ctx.save(); ctx.font='bold 30px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    const nw=ctx.measureText(name).width;
    const ng=ctx.createLinearGradient(W/2-nw/2,nameY,W/2+nw/2,nameY);
    ng.addColorStop(0,'#FFFFFF'); ng.addColorStop(0.5,'#E0E7FF'); ng.addColorStop(1,'#A78BFA');
    ctx.shadowColor='rgba(124,58,237,0.55)'; ctx.shadowBlur=22;
    ctx.fillStyle=ng; ctx.fillText(trunc(ctx,name,cw-180),W/2,nameY); ctx.restore();

    // Name underline
    ctx.font='bold 30px sans-serif';
    const uw=Math.min(ctx.measureText(name).width*0.5,165);
    const ul=ctx.createLinearGradient(W/2-uw/2,nameY+20,W/2+uw/2,nameY+20);
    ul.addColorStop(0,'rgba(0,0,0,0)'); ul.addColorStop(0.5,'rgba(167,139,250,0.75)'); ul.addColorStop(1,'rgba(0,0,0,0)');
    ctx.save(); ctx.strokeStyle=ul; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(W/2-uw/2,nameY+20); ctx.lineTo(W/2+uw/2,nameY+20); ctx.stroke(); ctx.restore();

    // userId + bio
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font='11px sans-serif'; ctx.fillStyle='rgba(167,139,250,0.85)'; ctx.fillText(userId,W/2,nameY+36);
    if (bio) { ctx.font='italic 12px sans-serif'; ctx.fillStyle='rgba(148,163,184,0.72)'; ctx.fillText('"'+trunc(ctx,bio,cw-240)+'"',W/2,nameY+56); }

    // Sep
    sep(W/2-230,W/2+230,nameY+78,['rgba(124,58,237,0.22)','rgba(14,165,233,0.22)','rgba(16,185,129,0.22)']);

    const pillY=nameY+118;
    const pills=[
        {icon:'🎂',label:'TANGGAL LAHIR',val:dob||'-',hex:'#7C3AED'},
        {icon:'🎯',label:'USIA',val:age!=null?`${age} tahun`:'-',hex:'#10B981'},
        {icon:'🌐',label:'NETWORK',val:network,hex:'#0EA5E9'},
        {icon:'🃏',label:'CARD TYPE',val:cardType.toUpperCase(),hex:'#F59E0B'},
    ];
    const pw=190, ph=52, pgap=(cw-pw*pills.length)/(pills.length+1);
    pills.forEach((p,i)=>{
        const px=cx3+pgap+(pw+pgap)*i, py=pillY-ph/2, c2=h2r(p.hex);
        rrect(ctx,px,py,pw,ph,10);
        const pb=ctx.createLinearGradient(px,py,px+pw,py+ph);
        pb.addColorStop(0,`rgba(${c2.r},${c2.g},${c2.b},0.11)`); pb.addColorStop(1,`rgba(${c2.r},${c2.g},${c2.b},0.05)`);
        ctx.fillStyle=pb; ctx.fill();
        rrect(ctx,px,py,pw,ph,10); ctx.strokeStyle=`rgba(${c2.r},${c2.g},${c2.b},0.38)`; ctx.lineWidth=0.7; ctx.stroke();
        clip(ctx,()=>{rrect(ctx,px,py,pw,ph,10);ctx.clip();const r2=ctx.createLinearGradient(px,py,px+pw,py);r2.addColorStop(0,'rgba(0,0,0,0)');r2.addColorStop(0.5,'rgba(255,255,255,0.09)');r2.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=r2;ctx.fillRect(px,py,pw,1.5);});
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.font='12px sans-serif'; ctx.fillStyle=p.hex; ctx.fillText(p.icon,px+pw/2,py+13);
        ctx.font='7px sans-serif'; ctx.fillStyle='rgba(148,163,184,0.65)'; ctx.fillText(p.label,px+pw/2,py+27);
        ctx.font='bold 12px sans-serif'; ctx.fillStyle='#E2E8F0';
        ctx.shadowColor=p.hex; ctx.shadowBlur=7;
        ctx.fillText(trunc(ctx,p.val,pw-18),px+pw/2,py+41); ctx.shadowBlur=0;
    });


    const fy=H-36;
    ctx.beginPath(); ctx.arc(cx3+18,fy,4,0,Math.PI*2);
    ctx.fillStyle='#34D399'; ctx.shadowColor='rgba(52,211,153,0.8)'; ctx.shadowBlur=9; ctx.fill(); ctx.shadowBlur=0;
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.font='10px sans-serif'; ctx.fillStyle='rgba(52,211,153,0.9)'; ctx.fillText('● '+status,cx3+26,fy);
    ctx.textAlign='right'; ctx.font='9px sans-serif'; ctx.fillStyle='rgba(71,85,105,0.58)';
    ctx.fillText(`Powered by ${network} • ${new Date().toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}`,cx3+cw-16,fy);

    return canvas.toBuffer('image/png');
}

module.exports = { generateRegisterCard };
