'use strict';
const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs   = require('fs');
const axios= require('axios');

const BG_PATH  = path.join(process.cwd(), 'assets', 'image', 'canvas', 'iqc.jpg');
const EMOJI_RE = /(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Modifier_Base}\p{Emoji_Modifier}|\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*|[\u{1F1E0}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3/gu;
const _ec = new Map();

function _cp(e){const p=[];let i=0;while(i<e.length){const c=e.codePointAt(i);if(c!==undefined&&c!==0xFE0F&&c!==0x200D)p.push(c.toString(16));i+=(c&&c>0xFFFF)?2:1;}return p.join('-');}
function _cpf(e){const p=[];let i=0;while(i<e.length){const c=e.codePointAt(i);if(c!==undefined&&c!==0xFE0F)p.push(c.toString(16));i+=(c&&c>0xFFFF)?2:1;}return p.join('-');}

async function _fe(emoji){
    const k=_cp(emoji);if(_ec.has(k))return _ec.get(k);
    const kf=_cpf(emoji),ks=_cp(emoji.replace(/\uFE0F/g,'')),enc=encodeURIComponent(emoji);
    for(const u of[
        'https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160/'+k+'.png',
        'https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160/'+kf+'.png',
        'https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-160/'+ks+'.png',
        'https://raw.githubusercontent.com/iamcal/emoji-data/master/img-apple-160/'+k+'.png',
        'https://emojicdn.elk.sh/'+enc+'?style=apple',
    ]){try{const r=await axios.get(u,{responseType:'arraybuffer',timeout:8000});if(r.data?.byteLength>200){const img=await loadImage(Buffer.from(r.data));if(img?.width>0){_ec.set(k,img);return img;}}}catch{}}
    _ec.set(k,null);return null;
}

async function _pf(str,extras=[]){
    const re=new RegExp(EMOJI_RE.source,'gu');const em=[];let m;
    while((m=re.exec(str)))em.push(m[0]);
    await Promise.all([...new Set([...em,...extras].filter(Boolean))].map(e=>_fe(e)));
}

function _tok(str){
    const t=[];let last=0,re=new RegExp(EMOJI_RE.source,'gu'),m;
    while((m=re.exec(str))!==null){if(m.index>last)t.push({type:'text',value:str.slice(last,m.index)});t.push({type:'emoji',value:m[0]});last=m.index+m[0].length;}
    if(last<str.length)t.push({type:'text',value:str.slice(last)});return t;
}

function _wrap(ctx,str,maxW,eSz){
    const toks=_tok(str),sp=ctx.measureText(' ').width,lines=[],words=[];
    for(const tk of toks){if(tk.type==='emoji'){words.push({t:'emoji',v:tk.value});}else{for(const p of tk.value.split(/(\s+)/)){if(!p)continue;if(/^\s+$/.test(p))words.push({t:'sp'});else words.push({t:'text',v:p});}}}
    let cur=[],curW=0;
    for(const w of words){if(w.t==='sp')continue;const ww=w.t==='emoji'?eSz:ctx.measureText(w.v).width,gap=cur.length>0?sp:0;if(curW+gap+ww>maxW&&cur.length>0){lines.push({words:cur,width:curW});cur=[w];curW=ww;}else{if(cur.length>0)curW+=gap;cur.push(w);curW+=ww;}}
    if(cur.length>0)lines.push({words:cur,width:curW});return lines;
}

async function _dl(ctx,lines,x,y,fSz,eSz,color){
    const sp=ctx.measureText(' ').width,lh=fSz*1.35;
    for(let i=0;i<lines.length;i++){const line=lines[i];let tx=x;const bl=y+i*lh+fSz*0.82;ctx.fillStyle=color;
        for(const w of line.words){if(w.t==='emoji'){const img=_ec.get(_cp(w.v));if(img)ctx.drawImage(img,tx,bl-eSz*0.82,eSz,eSz);tx+=eSz+sp*0.2;}else{ctx.fillText(w.v,tx,bl);tx+=ctx.measureText(w.v).width+sp;}}}
}

function rr(ctx,x,y,w,h,r){
    const tl=typeof r==='object'?r.tl:r,tr=typeof r==='object'?r.tr:r,br=typeof r==='object'?r.br:r,bl=typeof r==='object'?r.bl:r;
    ctx.beginPath();ctx.moveTo(x+tl,y);ctx.lineTo(x+w-tr,y);ctx.quadraticCurveTo(x+w,y,x+w,y+tr);ctx.lineTo(x+w,y+h-br);ctx.quadraticCurveTo(x+w,y+h,x+w-br,y+h);ctx.lineTo(x+bl,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-bl);ctx.lineTo(x,y+tl);ctx.quadraticCurveTo(x,y,x+tl,y);ctx.closePath();
}

function _blur(d,W,H,rad){
    if(rad<1)return;const wm=W-1,hm=H-1,div=2*rad+1,rp1=rad+1,mul=1/(rp1*(rp1+1)/2*2+rad+1);
    const stk=Array.from({length:div},()=>[0,0,0]);
    for(let y=0;y<H;y++){let ri=0,gi=0,bi=0,ro=0,go=0,bo=0,rs=0,gs=0,bs=0,sI=rad,sO=0;for(let i=-rad;i<=rad;i++){const si=(y*W+Math.min(wm,Math.max(0,i)))*4,s2=i+rad;stk[s2]=[d[si],d[si+1],d[si+2]];const rb=rp1-Math.abs(i);rs+=d[si]*rb;gs+=d[si+1]*rb;bs+=d[si+2]*rb;if(i>0){ri+=d[si];gi+=d[si+1];bi+=d[si+2];}else{ro+=d[si];go+=d[si+1];bo+=d[si+2];}}for(let x=0;x<W;x++){const idx=(y*W+x)*4;d[idx]=Math.round(rs*mul);d[idx+1]=Math.round(gs*mul);d[idx+2]=Math.round(bs*mul);rs-=ro;gs-=go;bs-=bo;const os=stk[sO];ro-=os[0];go-=os[1];bo-=os[2];const sx=Math.min(wm,x+rad+1),sid=(y*W+sx)*4;os[0]=d[sid];os[1]=d[sid+1];os[2]=d[sid+2];ri+=os[0];gi+=os[1];bi+=os[2];rs+=ri;gs+=gi;bs+=bi;sI=(sI+1)%div;const is=stk[sI];ro+=is[0];go+=is[1];bo+=is[2];ri-=is[0];gi-=is[1];bi-=is[2];sO=(sO+1)%div;}}
    for(let x=0;x<W;x++){let ri=0,gi=0,bi=0,ro=0,go=0,bo=0,rs=0,gs=0,bs=0,sI=rad,sO=0;for(let i=-rad;i<=rad;i++){const sy=Math.min(hm,Math.max(0,i)),sid=(sy*W+x)*4,s2=i+rad;stk[s2]=[d[sid],d[sid+1],d[sid+2]];const rb=rp1-Math.abs(i);rs+=d[sid]*rb;gs+=d[sid+1]*rb;bs+=d[sid+2]*rb;if(i>0){ri+=d[sid];gi+=d[sid+1];bi+=d[sid+2];}else{ro+=d[sid];go+=d[sid+1];bo+=d[sid+2];}}for(let y=0;y<H;y++){const idx=(y*W+x)*4;d[idx]=Math.round(rs*mul);d[idx+1]=Math.round(gs*mul);d[idx+2]=Math.round(bs*mul);rs-=ro;gs-=go;bs-=bo;const os=stk[sO];ro-=os[0];go-=os[1];bo-=os[2];const sy=Math.min(hm,y+rad+1),sid=(sy*W+x)*4;os[0]=d[sid];os[1]=d[sid+1];os[2]=d[sid+2];ri+=os[0];gi+=os[1];bi+=os[2];rs+=ri;gs+=gi;bs+=bi;sI=(sI+1)%div;const is=stk[sI];ro+=is[0];go+=is[1];bo+=is[2];ri-=is[0];gi-=is[1];bi-=is[2];sO=(sO+1)%div;}}
}

function _drawBg(ctx,img,W,H){
    const t=createCanvas(W,H),tc=t.getContext('2d');
    if(img){const sc=Math.max(W/img.width,H/img.height),dw=img.width*sc,dh=img.height*sc;tc.drawImage(img,(W-dw)/2,(H-dh)/2,dw,dh);}
    else{tc.fillStyle='#111418';tc.fillRect(0,0,W,H);}
    const id=tc.getImageData(0,0,W,H);_blur(id.data,W,H,32);tc.putImageData(id,0,0);
    ctx.drawImage(t,0,0);
    ctx.fillStyle='rgba(0,0,0,0.42)';ctx.fillRect(0,0,W,H);
}

function _drawStatus(ctx,W,S){
    const cy = Math.round(22*S);
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + Math.round(16*S) + 'px -apple-system, Arial';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText('8:25', Math.round(24*S), cy);
    const rX = W - Math.round(18*S);
    const bW=Math.round(27*S), bH=Math.round(13*S), bR=Math.round(3*S), bCap=Math.round(2*S), bCapH=Math.round(7*S);
    const bX = rX - bW;
    ctx.strokeStyle = 'rgba(255,255,255,0.88)'; ctx.lineWidth = Math.round(1.5*S);
    rr(ctx, bX, cy-bH/2, bW, bH, bR); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(rX, cy-bCapH/2, bCap, bCapH);
    rr(ctx, bX+Math.round(2*S), cy-bH/2+Math.round(2*S), Math.round((bW-4*S)*0.24), bH-Math.round(4*S), bR-1);
    ctx.fillStyle = '#FFD60A'; ctx.fill();
    const wCX = bX - Math.round(20*S);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.round(2*S); ctx.lineCap = 'round';
    [[Math.round(5*S), Math.PI*1.28, Math.PI*1.72],
     [Math.round(9*S), Math.PI*1.22, Math.PI*1.78],
     [Math.round(13*S), Math.PI*1.16, Math.PI*1.84]].forEach(([r,s,e]) => {
        ctx.beginPath(); ctx.arc(wCX, cy+Math.round(4*S), r, s, e); ctx.stroke();
    });
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(wCX, cy+Math.round(8*S), Math.round(2.5*S), 0, Math.PI*2); ctx.fill();
    const sgX = wCX - Math.round(28*S);
    const bw = Math.round(4*S), bgap = Math.round(2*S);
    ctx.fillStyle = '#ffffff';
    for(let i=0;i<4;i++){
        const bh = Math.round((5+i*4)*S);
        const bx2 = sgX + i*(bw+bgap);
        const by2 = cy + Math.round(8*S) - bh;
        rr(ctx, bx2, by2, bw, bh, Math.round(1.2*S)); ctx.fill();
    }
    const carrX = sgX - Math.round(6*S);
    ctx.font = Math.round(12*S) + 'px -apple-system, Arial';
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'right';
    ctx.fillText('by.U LTE', carrX, cy);

    ctx.restore();
}
function _icoStar(ctx,cx,cy,s,c){ctx.save();ctx.strokeStyle=c;ctx.lineWidth=s*0.13;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();for(let i=0;i<5;i++){const a1=(Math.PI*2*i)/5-Math.PI/2,a2=a1+Math.PI/5,ox=cx+Math.cos(a1)*s,oy=cy+Math.sin(a1)*s,ix=cx+Math.cos(a2)*s*0.42,iy=cy+Math.sin(a2)*s*0.42;i===0?ctx.moveTo(ox,oy):ctx.lineTo(ox,oy);ctx.lineTo(ix,iy);}ctx.closePath();ctx.stroke();ctx.restore();}

function _icoReply(ctx,cx,cy,s,c){
    ctx.save();ctx.strokeStyle=c;ctx.fillStyle=c;ctx.lineWidth=s*0.14;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.beginPath();ctx.moveTo(cx+s*0.6,cy-s*0.5);ctx.lineTo(cx-s*0.3,cy-s*0.5);ctx.quadraticCurveTo(cx-s*0.85,cy-s*0.5,cx-s*0.85,cy);ctx.lineTo(cx-s*0.85,cy+s*0.5);ctx.stroke();
    ctx.beginPath();ctx.moveTo(cx+s*0.12,cy-s*0.92);ctx.lineTo(cx+s*0.62,cy-s*0.5);ctx.lineTo(cx+s*0.12,cy-s*0.08);ctx.closePath();ctx.fill();
    ctx.restore();
}

function _icoForward(ctx,cx,cy,s,c){
    // curved arrow pointing right (forward)
    ctx.save();ctx.strokeStyle=c;ctx.fillStyle=c;ctx.lineWidth=s*0.14;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.beginPath();ctx.moveTo(cx-s*0.6,cy-s*0.5);ctx.lineTo(cx+s*0.3,cy-s*0.5);ctx.quadraticCurveTo(cx+s*0.85,cy-s*0.5,cx+s*0.85,cy);ctx.lineTo(cx+s*0.85,cy+s*0.5);ctx.stroke();
    ctx.beginPath();ctx.moveTo(cx-s*0.12,cy-s*0.92);ctx.lineTo(cx-s*0.62,cy-s*0.5);ctx.lineTo(cx-s*0.12,cy-s*0.08);ctx.closePath();ctx.fill();
    ctx.restore();
}

function _icoCopy(ctx,cx,cy,s,c){ctx.save();ctx.strokeStyle=c;ctx.lineWidth=s*0.13;ctx.lineCap='round';ctx.lineJoin='round';rr(ctx,cx-s*0.62,cy-s*0.38,s*0.80,s*0.88,s*0.10);ctx.stroke();rr(ctx,cx-s*0.22,cy-s*0.82,s*0.80,s*0.88,s*0.10);ctx.stroke();ctx.restore();}

function _icoBubble(ctx,cx,cy,s,c){ctx.save();ctx.strokeStyle=c;ctx.lineWidth=s*0.13;ctx.lineCap='round';ctx.lineJoin='round';rr(ctx,cx-s*0.72,cy-s*0.62,s*1.44,s*1.05,s*0.20);ctx.stroke();ctx.beginPath();ctx.moveTo(cx-s*0.25,cy+s*0.43);ctx.lineTo(cx-s*0.55,cy+s*0.80);ctx.lineTo(cx+s*0.15,cy+s*0.43);ctx.stroke();ctx.restore();}

function _icoWarn(ctx,cx,cy,s,c){ctx.save();ctx.strokeStyle=c;ctx.fillStyle=c;ctx.lineWidth=s*0.12;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(cx,cy-s*0.85);ctx.lineTo(cx+s*0.76,cy+s*0.52);ctx.lineTo(cx-s*0.76,cy+s*0.52);ctx.closePath();ctx.stroke();ctx.beginPath();ctx.arc(cx,cy+s*0.24,s*0.09,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(cx,cy-s*0.26);ctx.lineTo(cx,cy+s*0.04);ctx.stroke();ctx.restore();}

function _icoTrash(ctx,cx,cy,s,c){ctx.save();ctx.strokeStyle=c;ctx.lineWidth=s*0.12;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(cx-s*0.78,cy-s*0.46);ctx.lineTo(cx+s*0.78,cy-s*0.46);ctx.stroke();rr(ctx,cx-s*0.55,cy-s*0.38,s*1.10,s*1.22,s*0.09);ctx.stroke();ctx.beginPath();ctx.moveTo(cx-s*0.22,cy-s*0.46);ctx.lineTo(cx-s*0.22,cy-s*0.70);ctx.lineTo(cx+s*0.22,cy-s*0.70);ctx.lineTo(cx+s*0.22,cy-s*0.46);ctx.stroke();for(const ox of[-0.20,0,0.20]){ctx.beginPath();ctx.moveTo(cx+s*ox,cy-s*0.08);ctx.lineTo(cx+s*ox,cy+s*0.54);ctx.stroke();}ctx.restore();}

async function generateIQC(opts){
    opts=opts||{};
    const message   = opts.message   || 'kayaa ginii';
    const timestamp = opts.timestamp  || '8:25';
    const reactions = opts.reactions  || ['👍','❤️','😂','😮','😢','🙏'];

    const S    = 3;
    const CW   = 390*S;
    const F    = sz => sz+'px -apple-system,\'SF Pro Text\',Arial,sans-serif';

    // Panel ukuran lebih kecil dari canvas supaya background terlihat
    const MSG_FSZ = 15*S, TS_FSZ=10*S, E_SZ=Math.round(MSG_FSZ*1.05);
    const BPAD_X=11*S, BPAD_Y=9*S, BMAX_W=224*S;
    const LEFT_X=14*S;
    const BUB_R={tl:5*S,tr:16*S,br:16*S,bl:16*S};

    // Emoji bar — lebih kecil
    const EI_SZ=34*S, EP_X=10*S, EB_H=50*S, EB_R=EB_H/2;
    const EB_TW=reactions.length*(EI_SZ+EP_X)+EP_X;

    // Menu — lebih kecil, item lebih slim
    const MNU_W=336*S, MNU_R=13*S, ITEM_H=48*S;
    const ITEMS=[
        {label:'Beri Bintang',fn:_icoStar},
        {label:'Balas',       fn:_icoReply},
        {label:'Teruskan',    fn:_icoForward},
        {label:'Salin',       fn:_icoCopy},
        {label:'Ucapkan',     fn:_icoBubble},
        {label:'Laporkan',    fn:_icoWarn},
        {label:'Hapus',       fn:_icoTrash,red:true},
    ];

    await _pf(message,reactions);

    const mC=createCanvas(CW,100),mX=mC.getContext('2d');
    mX.font=F(MSG_FSZ);mX.textBaseline='alphabetic';
    const lines=_wrap(mX,message,BMAX_W-BPAD_X*2,E_SZ);
    const lineH=MSG_FSZ*1.35;
    const tsW=mX.measureText(timestamp).width+4*S;
    const lastLW=lines.length>0?lines[lines.length-1].width:0;
    let innerW=Math.max(...lines.map(l=>l.width),lastLW+tsW);
    innerW=Math.min(innerW,BMAX_W-BPAD_X*2);
    const innerH=lines.length*lineH;
    const bubW=Math.max(innerW+BPAD_X*2,60*S);
    const bubH=innerH+BPAD_Y*2+TS_FSZ+8*S;
    const MNU_H=ITEMS.length*ITEM_H;

    // Layout (matching reference exactly):
    // status bar → space → emoji bar (LEFT) → gap → bubble (LEFT) → gap → menu (LEFT full)
    const STATUS_H=44*S;
    const TOP_PAD=STATUS_H+120*S; // banyak background terlihat di atas
    const GAP=8*S;
    const BOT_PAD=48*S;           // space bawah lebih panjang
    const ebarY=TOP_PAD;
    const bubY=ebarY+EB_H+GAP;
    const mnuY=bubY+bubH+GAP;
    const CH=mnuY+MNU_H+BOT_PAD;

    const canvas=createCanvas(CW,CH);
    const ctx=canvas.getContext('2d');

    // Background
    let bgImg=null;
    if(fs.existsSync(BG_PATH)){try{bgImg=await loadImage(fs.readFileSync(BG_PATH));}catch{}}
    _drawBg(ctx,bgImg,CW,CH);

    // Status bar
    _drawStatus(ctx,CW,S);

    // ── EMOJI BAR — frosted glass pill ────────────────────────────────────
    {
        const _ebFC = createCanvas(EB_TW + 1, EB_H + 1), _ebFX = _ebFC.getContext('2d');
        _ebFX.drawImage(canvas, LEFT_X, ebarY, EB_TW, EB_H, 0, 0, EB_TW, EB_H);
        const _ebID = _ebFX.getImageData(0, 0, EB_TW, EB_H);
        _blur(_ebID.data, EB_TW, EB_H, 22);
        _ebFX.putImageData(_ebID, 0, 0);

        ctx.save();
        ctx.shadowColor='rgba(0,0,0,0.50)';ctx.shadowBlur=20*S;ctx.shadowOffsetY=4*S;
        rr(ctx,LEFT_X,ebarY,EB_TW,EB_H,EB_R);ctx.fillStyle='rgba(0,0,0,0.01)';ctx.fill();
        ctx.restore();

        ctx.save();
        rr(ctx,LEFT_X,ebarY,EB_TW,EB_H,EB_R);ctx.clip();
        ctx.drawImage(_ebFC, LEFT_X, ebarY);
        ctx.fillStyle='rgba(26,30,28,0.75)';ctx.fillRect(LEFT_X,ebarY,EB_TW,EB_H);
        ctx.restore();
        ctx.save();rr(ctx,LEFT_X,ebarY,EB_TW,EB_H,EB_R);ctx.strokeStyle='rgba(255,255,255,0.10)';ctx.lineWidth=0.7;ctx.stroke();ctx.restore();
    }

    for(let i=0;i<reactions.length;i++){
        const ex=LEFT_X+EP_X+i*(EI_SZ+EP_X);
        const ey=ebarY+(EB_H-EI_SZ)/2;
        const img=_ec.get(_cp(reactions[i]));
        if(img)ctx.drawImage(img,ex,ey,EI_SZ,EI_SZ);
    }

    // ── BUBBLE — LEFT side, frosted glass (lebih gelap) ──────────────────
    {
        const _bubFC = createCanvas(bubW + 1, bubH + 1), _bubFX = _bubFC.getContext('2d');
        _bubFX.drawImage(canvas, LEFT_X, bubY, bubW, bubH, 0, 0, bubW, bubH);
        const _bubID = _bubFX.getImageData(0, 0, bubW, bubH);
        _blur(_bubID.data, bubW, bubH, 20);
        _bubFX.putImageData(_bubID, 0, 0);

        ctx.save();
        ctx.shadowColor='rgba(0,0,0,0.40)';ctx.shadowBlur=12*S;ctx.shadowOffsetY=3*S;
        rr(ctx,LEFT_X,bubY,bubW,bubH,BUB_R);ctx.fillStyle='rgba(0,0,0,0.01)';ctx.fill();
        ctx.restore();

        ctx.save();
        rr(ctx,LEFT_X,bubY,bubW,bubH,BUB_R);ctx.clip();
        ctx.drawImage(_bubFC, LEFT_X, bubY);
        ctx.fillStyle='rgba(20,28,26,0.82)';ctx.fillRect(LEFT_X,bubY,bubW,bubH);
        ctx.restore();
        ctx.save();rr(ctx,LEFT_X,bubY,bubW,bubH,BUB_R);ctx.strokeStyle='rgba(255,255,255,0.08)';ctx.lineWidth=0.6;ctx.stroke();ctx.restore();
    }

    ctx.save();
    ctx.font=F(MSG_FSZ);ctx.textBaseline='alphabetic';
    await _dl(ctx,lines,LEFT_X+BPAD_X,bubY+BPAD_Y,MSG_FSZ,E_SZ,'#ffffff');
    const lastLine=lines[lines.length-1];
    const tsX=LEFT_X+BPAD_X+(lastLine?lastLine.width:0)+5*S;
    const tsY=bubY+BPAD_Y+innerH+BPAD_Y+TS_FSZ-2*S;
    ctx.font=F(TS_FSZ);ctx.fillStyle='rgba(255,255,255,0.45)';ctx.textBaseline='alphabetic';
    ctx.fillText(timestamp,tsX,tsY);
    ctx.restore();

    // ── MENU PANEL — true frosted glass (manual backdrop blur) ───────────
    // Ambil pixel background canvas yang sudah ada (blurred bg), blur lagi
    const _mnuFrostC = createCanvas(MNU_W + 1, MNU_H + 1);
    const _mnuFrostX = _mnuFrostC.getContext('2d');
    // Crop region dari canvas utama sebelum panel digambar
    _mnuFrostX.drawImage(canvas, LEFT_X, mnuY, MNU_W, MNU_H, 0, 0, MNU_W, MNU_H);
    const _mnuID = _mnuFrostX.getImageData(0, 0, MNU_W, MNU_H);
    _blur(_mnuID.data, MNU_W, MNU_H, 22);
    _mnuFrostX.putImageData(_mnuID, 0, 0);

    ctx.save();
    // Shadow dulu sebelum clip
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur  = 28 * S;
    ctx.shadowOffsetY = 6 * S;
    rr(ctx, LEFT_X, mnuY, MNU_W, MNU_H, MNU_R);
    ctx.fillStyle = 'rgba(0,0,0,0.01)'; // dummy agar shadow tergambar
    ctx.fill();
    ctx.restore();

    // Clip dan gambar frost + overlay
    ctx.save();
    rr(ctx, LEFT_X, mnuY, MNU_W, MNU_H, MNU_R);
    ctx.clip();
    // Gambar region background yang sudah di-blur
    ctx.drawImage(_mnuFrostC, LEFT_X, mnuY);
    // Overlay teal-green-dark seperti warna background WA di referensi
    ctx.fillStyle = 'rgba(28,36,34,0.72)';
    ctx.fillRect(LEFT_X, mnuY, MNU_W, MNU_H);
    // Highlight top border tipis
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(LEFT_X, mnuY, MNU_W, 1);
    ctx.restore();

    // Border kiri kanan (subtle)
    ctx.save();
    rr(ctx, LEFT_X, mnuY, MNU_W, MNU_H, MNU_R);
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();

    const inset=16*S,icoX=LEFT_X+MNU_W-42*S,icoS=10*S;
    for(let i=0;i<ITEMS.length;i++){
        const item=ITEMS[i],itemY=mnuY+i*ITEM_H,cy=itemY+ITEM_H/2;
        const tc=item.red?'#FF453A':'#ffffff';
        const ic=item.red?'#FF453A':'rgba(255,255,255,0.62)';

        if(i>0){
            ctx.save();
            const dg=ctx.createLinearGradient(LEFT_X+inset,itemY,LEFT_X+MNU_W-inset,itemY);
            dg.addColorStop(0,'rgba(255,255,255,0)');dg.addColorStop(0.08,'rgba(255,255,255,0.12)');dg.addColorStop(0.92,'rgba(255,255,255,0.12)');dg.addColorStop(1,'rgba(255,255,255,0)');
            ctx.fillStyle=dg;ctx.fillRect(LEFT_X+inset,itemY-0.5,MNU_W-inset*2,1);
            ctx.restore();
        }

        ctx.save();
        ctx.font=F(17*S);ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle=tc;
        ctx.fillText(item.label,LEFT_X+inset,cy);
        ctx.restore();

        item.fn(ctx,icoX,cy,icoS,ic);
    }

    // home indicator
    ctx.save();
    rr(ctx,CW/2-65*S,CH-16*S,130*S,5*S,3*S);
    ctx.fillStyle='rgba(255,255,255,0.40)';ctx.fill();
    ctx.restore();

    return canvas.toBuffer('image/png');
}

module.exports = { generateIQC };