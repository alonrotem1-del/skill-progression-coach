/*
 * Skill Progression Coach — UI orchestration (standalone app).
 * STRICTLY ADDITIVE: reads puc_* read-only via CoachStore; writes only spc_c_*;
 * registers NO service worker. Renders entirely from CoachData.
 */
(function () {
  'use strict';
  var Data = window.CoachData, Engine = window.CoachEngine, Progress = window.CoachProgress;
  var Duration = window.CoachDuration, Adapt = window.CoachAdapt, Settings = window.CoachSettings;
  var Store = window.CoachStore.makeStore();

  var app = document.getElementById('app');
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function h(html){var d=document.createElement('div');d.innerHTML=html;return d.firstElementChild;}
  function on(sel,ev,fn,root){(root||document).querySelectorAll(sel).forEach(function(n){n.addEventListener(ev,fn);});}
  function clone(o){return JSON.parse(JSON.stringify(o));}

  // ---- settings + resolved prescription -------------------------------------
  var _settings=null;
  function settings(){ if(!_settings){ _settings=Settings.migrate(Store.getSettings()); } return _settings; }
  function saveSettings(){ Store.setSettings(settings()); }
  // Today-only workout edits live in memory, keyed by templateId; they never
  // touch the saved defaults unless the user explicitly saves them.
  var todayEdits={};
  function prescriptionFor(t){ return t?Settings.resolvePrescription(t,settings(),todayEdits[t.id]):t; }

  function durationText(t){
    var r=Duration.calcDurationRange(prescriptionFor(t));
    if(!r) return '—';
    return 'About '+(r.minMin===r.maxMin?r.minMin:r.minMin+'–'+r.maxMin)+' min';
  }

  var ICON = {
    muscleup:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><circle cx="12" cy="10.5" r="2.2" fill="currentColor" stroke="none"/><path d="M8 6v3M16 6v3M12 12.5v5M9 17.5h6"/></svg>',
    boulder:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 20 L9 8 L13 15 L17 5 L21 20 Z"/><circle cx="9" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="17" cy="5" r="1" fill="currentColor" stroke="none"/></svg>',
    check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
    lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    star:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.7 1.4 6.8L12 17.8 5.9 21.2l1.4-6.8L2.2 9.7l6.9-.7z"/></svg>',
    today:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>',
    map:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="7" r="2.4"/><circle cx="12" cy="17" r="2.4"/><path d="M8 7l3 8M16 8l-3 7"/></svg>',
    chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    person:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>',
    center:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>'
  };

  // ---- audio ----------------------------------------------------------------
  var audioCtx = null;
  function unlockAudio(){
    if(audioCtx) return;
    try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){}
  }
  function playBeep(){
    try{
      if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==='suspended') audioCtx.resume();
      var beeps=[{freq:660,start:0,dur:.14},{freq:770,start:.18,dur:.14},{freq:880,start:.36,dur:.24}];
      var t0=audioCtx.currentTime;
      beeps.forEach(function(b){
        var osc=audioCtx.createOscillator(),gain=audioCtx.createGain();
        osc.connect(gain);gain.connect(audioCtx.destination);
        osc.frequency.value=b.freq;osc.type='triangle';
        gain.gain.setValueAtTime(0.45,t0+b.start);
        gain.gain.exponentialRampToValueAtTime(0.001,t0+b.start+b.dur);
        osc.start(t0+b.start);osc.stop(t0+b.start+b.dur);
      });
    }catch(e){}
  }
  function playCountdownTick(){
    try{
      if(!audioCtx) return;
      if(audioCtx.state==='suspended') audioCtx.resume();
      var osc=audioCtx.createOscillator(),gain=audioCtx.createGain();
      osc.connect(gain);gain.connect(audioCtx.destination);
      osc.frequency.value=440;osc.type='sine';
      var t=audioCtx.currentTime;
      gain.gain.setValueAtTime(0.25,t);gain.gain.exponentialRampToValueAtTime(0.001,t+0.1);
      osc.start(t);osc.stop(t+0.1);
    }catch(e){}
  }
  function vibrate(ms){try{if(navigator.vibrate)navigator.vibrate(ms);}catch(e){}}
  document.addEventListener('touchstart',unlockAudio,{once:true});
  document.addEventListener('click',unlockAudio,{once:true});

  // ---- app/session state ----------------------------------------------------
  var UI = { screen:'today', worldId:null, sheet:null, workout:null, climb:null, timer:null, timerPaused:false, timerLeft:0, readiness:null, readinessOpen:false };

  function worldsById(id){return Data.worldsById[id];}
  function activeWorld(){return worldsById(UI.worldId);}
  function contentMap(world){var c={};world.nodes.forEach(function(n){c[n.id]=n;});return c;}

  function WS(worldId){
    var st=Store.getState();
    if(!st[worldId]){ st[worldId]={nodes:{},focus:null}; Store.setState(st); }
    return Store.getState()[worldId];
  }
  function saveWS(worldId,ws){ var st=Store.getState(); st[worldId]=ws; Store.setState(st); }

  function statusOf(world,node,ws){ return Engine.statusOf(node,ws.nodes,contentMap(world),ws.focus); }
  function recomputeFocus(world,ws){ if(!ws.focus||!ws.focus.manual){ var f=Engine.autoFocus(world,ws.nodes); ws.focus={primary:f.primary,supporting:f.supporting,manual:false}; } return ws; }

  // ---- canonical world view -------------------------------------------------
  // THE single source of derived user state. Today, Map, and Node Detail all
  // consume this so they can never diverge. If a world has no seeded node state
  // yet (fresh install, or state cleared) but benchmarks exist, node progress is
  // derived here from the stored benchmark fixture — so the map always reflects
  // the same evidence Today does. Non-empty (onboarded) state is preserved.
  function worldView(worldId){
    var world=worldsById(worldId);
    var ws=WS(worldId);
    if(!ws.nodes||!Object.keys(ws.nodes).length){
      ws.nodes=window.CoachStore.seedStates(world,Store.getBench());
      ws.focus=null;
    }
    recomputeFocus(world,ws); saveWS(worldId,ws);
    var cm=contentMap(world);
    var ews=Engine._withContent(ws.nodes,cm);
    var primary=ws.focus.primary?cm[ws.focus.primary]:null;
    var supporting=ws.focus.supporting?cm[ws.focus.supporting]:null;
    var completed=world.nodes.filter(function(n){return Engine.isComplete(n,ews);}).length;
    return {world:world,ws:ws,cm:cm,ews:ews,focus:ws.focus,primary:primary,supporting:supporting,
      completed:completed,total:world.nodes.length};
  }

  // ---- workout state persistence --------------------------------------------
  var WK_KEY = 'spc_c_workout';
  function saveWorkoutState(){
    if(UI.workout) Store.set(WK_KEY, {type:'strength',data:UI.workout});
    else if(UI.climb) Store.set(WK_KEY, {type:'climbing',data:UI.climb});
    else Store.del(WK_KEY);
  }
  function restoreWorkoutState(){
    var saved = Store.get(WK_KEY);
    if(!saved) return false;
    if(saved.type==='strength'){UI.workout=saved.data;renderStrength();return true;}
    if(saved.type==='climbing'){UI.climb=saved.data;renderClimbing();return true;}
    return false;
  }

  // ---- boot -----------------------------------------------------------------
  function boot(){
    var p=Store.getProfile();
    if(!p||!p.onboarded){ return renderOnboarding(); }
    UI.worldId=p.activeWorld||Data.worlds[0].id;
    if(restoreWorkoutState()) return;
    setScreen('today');
  }

  // ---- shell / nav ----------------------------------------------------------
  function shell(inner,active){
    app.innerHTML='';
    var wrap=h('<div></div>');
    wrap.appendChild(h('<div class="scr">'+inner+'</div>'));
    var nav=h('<div class="nav">'+
      navBtn('today','Today',ICON.today,active)+
      navBtn('map','Map',ICON.map,active)+
      navBtn('progress','Progress',ICON.chart,active)+
      navBtn('profile','Profile',ICON.person,active)+'</div>');
    wrap.appendChild(nav);
    app.appendChild(wrap);
    on('.nav button','click',function(e){ setScreen(e.currentTarget.getAttribute('data-s')); },nav);
    return wrap;
  }
  function navBtn(id,label,ic,active){return '<button data-s="'+id+'" class="'+(active===id?'on':'')+'"><span class="ic">'+ic+'</span>'+label+'</button>';}

  function setScreen(name){
    UI.screen=name;
    window.scrollTo(0,0); // a full screen swap always starts at the top — the
                           // browser does not reset scroll on innerHTML replacement
    if(name==='today') renderToday();
    else if(name==='map') renderMap();
    else if(name==='progress') renderProgress();
    else if(name==='profile') renderProfile();
  }

  // ---- onboarding -----------------------------------------------------------
  var OB=null;
  function renderOnboarding(step){
    if(!OB){ OB={step:0, worldId:null, ans:{}, days:[], climbDays:[], duration:'normal'}; }
    if(step!=null) OB.step=step;
    var s=OB.step;
    app.innerHTML='';
    var html;
    if(s===0){
      html='<div class="scr"><div class="hero" style="text-align:center;padding-top:30px">'+
        '<div class="badge" style="background:rgba(56,189,248,.15);color:var(--accent);margin-bottom:10px">First Usable Version</div>'+
        '<h1>Skill Progression Coach</h1>'+
        '<p class="muted">Choose the goal you want to work toward. We\'ll build a progression map and a workout recommendation for today.</p></div>'+
        '<div class="section">Choose a Goal World</div>'+
        Data.worlds.map(function(w){return worldChoice(w);}).join('')+'</div>';
      app.appendChild(h(html));
      on('[data-world]','click',function(e){ OB.worldId=e.currentTarget.getAttribute('data-world'); renderOnboarding(1); });
    } else if(s===1){
      html=stepLevel();
      app.appendChild(h('<div class="scr">'+html+'</div>'));
      wireLevel();
    } else if(s===2){
      var dayLabels=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      html='<div class="scr"><button class="link" data-back>&lsaquo; Back</button><h2 class="sp">Training Availability</h2>'+
        '<div class="section">Training Days per Week</div><div class="opts" id="days">'+dayLabels.map(function(d,i){return '<button class="pill '+(OB.days.indexOf(i)>=0?'on':'')+'" data-d="'+i+'">'+d+'</button>';}).join('')+'</div>'+
        (OB.worldId==='boulder'?'<div class="section">Climbing Days</div><div class="opts" id="cdays">'+dayLabels.map(function(d,i){return '<button class="pill '+(OB.climbDays.indexOf(i)>=0?'on':'')+'" data-d="'+i+'">'+d+'</button>';}).join('')+'</div>':'')+
        '<div class="section">Preferred Session Length</div><div class="opts" id="dur">'+
        durPill('short','Short (25-35 min)')+durPill('normal','Normal (40-55 min)')+durPill('long','Long (60+ min)')+'</div>'+
        '<button class="btn primary sp" data-next>Continue</button></div>';
      app.appendChild(h(html));
      on('#days .pill','click',function(e){toggleArr(OB.days,+e.currentTarget.dataset.d);e.currentTarget.classList.toggle('on');});
      on('#cdays .pill','click',function(e){toggleArr(OB.climbDays,+e.currentTarget.dataset.d);e.currentTarget.classList.toggle('on');});
      on('#dur .pill','click',function(e){OB.duration=e.currentTarget.dataset.v;document.querySelectorAll('#dur .pill').forEach(function(p){p.classList.remove('on');});e.currentTarget.classList.add('on');});
      on('[data-back]','click',function(){renderOnboarding(1);});
      on('[data-next]','click',function(){ finishOnboarding(); });
    }
  }
  function worldChoice(w){
    return '<div class="card" data-world="'+w.id+'" style="cursor:pointer;display:flex;gap:14px;align-items:center">'+
      '<div class="world-ic" style="--world-accent:'+w.theme.accent+'">'+ICON[w.icon]+'</div>'+
      '<div><div style="font-weight:800;font-size:17px">'+esc(w.name)+'</div>'+
      '<div class="muted small" style="margin-top:2px">'+esc(w.goal)+'</div></div></div>';
  }
  function stepLevel(){
    var back='<button class="link" data-back>&lsaquo; Back</button>';
    if(OB.worldId==='muscleup'){
      return back+'<h2 class="sp">Starting Level — Bar Muscle-Up</h2><p class="muted small">Just what we need to place you on the map.</p>'+
        numQ('pmax','How many strict pull-ups in a row?','0','e.g. 9')+
        yesnoQ('c2b','Can you do Chest-to-Bar?')+
        numQ('dips','How many straight-bar dips in a row?','0','e.g. 8')+
        yesnoQ('sbdip','Dips on a straight bar?')+
        yesnoQ('banded','Tried a banded muscle-up?')+
        painQ()+
        '<button class="btn primary sp" data-next>Continue</button>';
    }
    return back+'<h2 class="sp">Starting Level — Bouldering</h2><p class="muted small">Indoor gym grades are rough estimates.</p>'+
      gradeQ('comfort','Current comfortable grade')+
      gradeQ('highest','Highest grade recently sent')+
      numQ('perweek','Climbing sessions per week','2','e.g. 2')+
      numQ('expmonths','Climbing experience (months)','0','e.g. 6')+
      painQ()+
      '<button class="btn primary sp" data-next>Continue</button>';
  }
  function numQ(k,label,def,ph){return '<div class="section">'+esc(label)+'</div><input class="input" type="number" inputmode="numeric" id="q_'+k+'" placeholder="'+ph+'" value="">';}
  function yesnoQ(k,label){return '<div class="section">'+esc(label)+'</div><div class="opts" data-yn="'+k+'"><button class="pill" data-v="yes">Yes</button><button class="pill" data-v="no">Not yet</button></div>';}
  function gradeQ(k,label){var g=['V0','V1','V2','V3','V4','V5'];return '<div class="section">'+esc(label)+'</div><div class="opts" data-grade="'+k+'">'+g.map(function(v){return '<button class="pill" data-v="'+v+'">'+v+'</button>';}).join('')+'</div>';}
  function painQ(){var a=[['none','None'],['elbow','Elbow'],['shoulder','Shoulder'],['wrist','Wrist'],['finger','Finger']];return '<div class="section">Current pain / discomfort?</div><div class="opts" data-pain="1">'+a.map(function(p){return '<button class="pill" data-v="'+p[0]+'">'+p[1]+'</button>';}).join('')+'</div>';}
  function wireLevel(){
    on('[data-yn] .pill','click',function(e){var g=e.currentTarget.closest('[data-yn]');g.querySelectorAll('.pill').forEach(function(p){p.classList.remove('on');});e.currentTarget.classList.add('on');OB.ans[g.dataset.yn]=e.currentTarget.dataset.v;});
    on('[data-grade] .pill','click',function(e){var g=e.currentTarget.closest('[data-grade]');g.querySelectorAll('.pill').forEach(function(p){p.classList.remove('on');});e.currentTarget.classList.add('on');OB.ans[g.dataset.grade]=e.currentTarget.dataset.v;});
    on('[data-pain] .pill','click',function(e){var g=e.currentTarget.closest('[data-pain]');g.querySelectorAll('.pill').forEach(function(p){p.classList.remove('on');});e.currentTarget.classList.add('on');OB.ans.pain=e.currentTarget.dataset.v;});
    on('[data-back]','click',function(){renderOnboarding(0);});
    on('[data-next]','click',function(){
      ['pmax','dips','perweek','expmonths','comfort','highest'].forEach(function(k){var el=document.getElementById('q_'+k);if(el&&el.value!=='')OB.ans[k]=el.value;});
      renderOnboarding(2);
    });
  }
  function durPill(v,label){return '<button class="pill '+(OB.duration===v?'on':'')+'" data-v="'+v+'">'+esc(label)+'</button>';}
  function toggleArr(a,v){var i=a.indexOf(v);if(i>=0)a.splice(i,1);else a.push(v);}

  function finishOnboarding(){
    var worldId=OB.worldId, world=worldsById(worldId), a=OB.ans;
    var bench=Store.getBench();
    var legacy=Store.readLegacy(); var derived=window.CoachStore.deriveBench(legacy);
    Object.keys(derived).forEach(function(k){bench[k]=Math.max(bench[k]||0,derived[k]);});
    if(a.pmax) bench.pullup_max=Math.max(bench.pullup_max||0,+a.pmax);
    if(a.dips) bench.dips_max=Math.max(bench.dips_max||0,+a.dips);
    Store.setBench(bench);
    var seeded=window.CoachStore.seedStates(world,bench);
    function setCrit(nodeId,token,val){var n=world.nodes.filter(function(x){return x.id===nodeId;})[0];if(!n)return;var c=n.criteria.filter(function(c){return c.unit.indexOf(token)>=0;})[0]||n.criteria[0];if(!seeded[nodeId])seeded[nodeId]={criteria:{}};seeded[nodeId].criteria[c.id]=val;}
    function complete(nodeId){var n=world.nodes.filter(function(x){return x.id===nodeId;})[0];if(!n)return;if(!seeded[nodeId])seeded[nodeId]={criteria:{}};n.criteria.forEach(function(c){seeded[nodeId].criteria[c.id]=c.target;});}
    if(worldId==='muscleup'){
      if(a.c2b==='yes'){complete('mu_fastpull');complete('mu_c2b');}
      if(a.banded==='yes'){complete('mu_bandmu');}
    } else {
      var order=['V0','V1','V2','V3','V4','V5']; var ci=order.indexOf(a.comfort||'V0');
      for(var i=0;i<ci;i++){complete('b_v'+i);}
      if(ci>=0){
        var gn='b_v'+ci; var node=world.nodes.filter(function(x){return x.id===gn;})[0];
        if(node){ setCrit(gn,'problem',1); }
      }
    }
    var ws={nodes:seeded,focus:null}; recomputeFocus(world,ws); saveWS(worldId,ws);
    Data.worlds.forEach(function(w){ if(w.id!==worldId){ var other={nodes:window.CoachStore.seedStates(w,bench),focus:null}; recomputeFocus(w,other); saveWS(w.id,other); }});
    Store.setProfile({onboarded:true, activeWorld:worldId, worlds:{}, ans:a, days:OB.days, climbDays:OB.climbDays, duration:OB.duration, painArea:(a.pain&&a.pain!=='none')?a.pain:null});
    OB=null; UI.worldId=worldId; setScreen('today');
  }

  // ---- readiness defaults ---------------------------------------------------
  function readiness(){
    if(!UI.readiness){
      var p=Store.getProfile()||{};
      UI.readiness={energy:2, upperFatigue:2, fingerSkin:2, pain:!!p.painArea, time:p.duration||'normal'};
    }
    return UI.readiness;
  }

  // ---- Today ----------------------------------------------------------------
  function renderToday(){
    var v=worldView(UI.worldId), world=v.world, ws=v.ws;
    var r=readiness();
    var rec=Engine.recommend({world:world,states:ws.nodes,focus:ws.focus,templates:Data.templates,readiness:r,recent:recentForRec()});
    var t=Data.templates[rec.sessionTemplateId], alt=Data.templates[rec.alternativeTemplateId];
    var primary=v.primary, supporting=v.supporting;
    var greet=greeting();

    // Path summary
    var pathSummary='';
    if(primary){
      pathSummary='<div class="path-summary">'+
        '<span>'+v.completed+'/'+v.total+' skills</span>'+
        ' &middot; <b>Focus:</b> '+esc(primary.name)+' ('+esc(Engine.progressText(primary,ws.nodes))+')'+
        '</div>';
    }

    // Two landscape columns: left = active goal, current milestone, recommended
    // workout, full exercise preview, Start (the dominant element); right =
    // lighter alternative, readiness adjustment, upcoming/progress summary. In
    // portrait the two wrapper divs simply stack in this same order, so the
    // reading order and behavior are unchanged there.
    var left=''+
      '<div class="hero"><div class="between"><div><div class="goal">'+esc(world.name)+'</div>'+
      '<h1>'+greet+'</h1></div></div>'+
      pathSummary+'</div>'+
      recCard(t,world,rec,primary,supporting,false);
    var right=''+
      (alt&&alt.id!==t.id?'<div class="section">Alternative</div>'+recCard(alt,world,{why:'Lighter option if today is heavy',reasons:[]},primary,supporting,true):'')+
      readinessCard(r,world)+
      upcomingCard();
    var html='<div class="today-grid"><div class="today-left">'+left+'</div><div class="today-right">'+right+'</div></div>';
    var wrap=shell(html,'today');
    on('[data-rk]','click',function(e){var k=e.currentTarget.dataset.rk,v=e.currentTarget.dataset.rv;if(k==='pain'){r.pain=!r.pain;}else if(k==='time'){r.time=v;}else{r[k]=+v;}renderToday();},wrap);
    on('[data-start]','click',function(e){ startSession(e.currentTarget.dataset.start); },wrap);
    on('[data-goto]','click',function(){ setScreen('map'); },wrap);
    on('[data-toggle-readiness]','click',function(){ UI.readinessOpen=!UI.readinessOpen; renderToday(); },wrap);
    on('[data-exdetail]','click',function(e){ openExerciseSheet(e.currentTarget.dataset.exdetail); },wrap);
    on('[data-editwk]','click',function(e){ openWorkoutEditor(e.currentTarget.dataset.editwk,'today'); },wrap);
    on('[data-resettoday]','click',function(e){ delete todayEdits[e.currentTarget.dataset.resettoday]; renderToday(); },wrap);
  }
  function greeting(){var hh=new Date().getHours();return hh<12?'Good Morning':hh<18?'Good Afternoon':'Good Evening';}
  function readinessCard(r,world){
    var isClimb=world.id==='boulder';
    var open=UI.readinessOpen;
    return '<div class="card tight"><div class="between" style="cursor:pointer" data-toggle-readiness>'+
      '<div class="section" style="margin:0">Readiness Check</div>'+
      '<span class="muted small">'+(open?'collapse':'expand')+'</span></div>'+
      (open?
        seg('energy','Energy',r.energy,['Low','Medium','High'])+
        seg('upperFatigue','Upper Body Fatigue',r.upperFatigue,['Low','Medium','High'])+
        (isClimb?seg('fingerSkin','Fingers / Skin',r.fingerSkin,['Sensitive','OK','Good']):'')+
        '<div class="rdy-row"><span class="lbl">Pain / Discomfort</span><div class="seg warn"><button data-rk="pain" class="'+(r.pain?'on':'')+'">'+(r.pain?'Yes':'No')+'</button></div></div>'+
        '<div class="rdy-row"><span class="lbl">Available Time</span><div class="seg">'+
          timeBtn('short','Short',r)+timeBtn('normal','Normal',r)+timeBtn('long','Long',r)+'</div></div>'
      :'')+'</div>';
  }
  function seg(k,label,val,opts){return '<div class="rdy-row"><span class="lbl">'+esc(label)+'</span><div class="seg">'+opts.map(function(o,i){return '<button data-rk="'+k+'" data-rv="'+(i+1)+'" class="'+(val===i+1?'on':'')+'">'+esc(o)+'</button>';}).join('')+'</div></div>';}
  function timeBtn(v,label,r){return '<button data-rk="time" data-rv="'+v+'" class="'+(r.time===v?'on':'')+'">'+esc(label)+'</button>';}

  function recCard(t,world,rec,primary,supporting,isAlt){
    if(!t) return '';
    var rt=prescriptionFor(t);
    var foci='';
    if(!isAlt){
      if(primary) foci+='<span class="tag gold">'+ICON.star+' '+esc(primary.name)+'</span>';
      if(supporting) foci+='<span class="tag">'+esc(supporting.name)+'</span>';
    }
    var modified=!isAlt&&Settings.isModifiedForToday(t,settings(),todayEdits[t.id]);
    var hasBlocks=rt.blocks&&rt.blocks.length;
    var body=hasBlocks?'<div class="preview wk-list">'+workoutExerciseList(rt)+'</div>'
      :(t.focus?'<div class="preview"><div class="prev-line"><b>Focus:</b> '+esc(t.focus)+'</div></div>':'');
    return '<div class="rec">'+
      '<div class="kick">'+(isAlt?'Alternative':'Recommended for Today')+' &middot; '+esc(world.name)+'</div>'+
      '<div class="name">'+esc(t.name)+'</div>'+
      '<div class="meta"><span>'+durationText(t)+'</span><span>Intensity: '+esc(t.difficulty||'—')+'</span>'+(t.targetGrade?'<span>Target: '+esc(t.targetGrade)+'</span>':'')+'</div>'+
      (foci?'<div class="foci">'+foci+'</div>':'')+
      (modified?'<div class="modified-flag">&#9679; Modified for today &middot; <button class="link" data-resettoday="'+esc(t.id)+'">Reset to default</button></div>':'')+
      body+
      (rec.why?'<div class="why">'+esc(rec.why)+'</div>':'')+
      (rec.caution?'<div class="caution">'+esc(rec.caution)+'</div>':'')+
      (!isAlt&&hasBlocks?'<button class="btn ghost sm inline-edit" data-editwk="'+esc(t.id)+'">Edit Workout</button>':'')+
      '<button class="btn primary" data-start="'+esc(t.id)+'">Start Workout</button>'+
      '</div>';
  }

  // The full, numbered exercise list for a resolved workout. Each exercise is
  // tappable to open its details (technique, benchmark, alternatives).
  function workoutExerciseList(rt){
    return rt.blocks.map(function(b,i){
      var exObj=Data.exercises[b.exId]||{};
      return '<div class="wk-ex" data-exdetail="'+esc(b.exId||'')+'">'+
        '<div class="wk-ex-h"><span class="wk-ex-n">'+(i+1)+'</span>'+
        '<span class="wk-ex-nm">'+esc(b.label||exObj.name||b.exId)+'</span>'+
        '<span class="wk-ex-info">Details &rsaquo;</span></div>'+
        '<div class="wk-ex-struct">'+esc(blockStructureText(b))+'</div>'+
        (blockRestText(b)?'<div class="wk-ex-rest muted small">'+esc(blockRestText(b))+'</div>':'')+
        '</div>';
    }).join('');
  }
  function blockStructureText(b){
    if(b.scheme==='ladder') return Settings.stepsText(b.steps)+' × '+b.rounds+' complete rounds';
    if(b.scheme==='pyramid') return 'Pyramid '+(b.steps||[]).join('-')+(b.rounds>1?' × '+b.rounds+' rounds':'');
    if(b.scheme==='amrap') return 'Max reps (1 set)';
    if(b.scheme==='hold') return b.sets+' × '+b.seconds+' sec hold';
    return b.sets+' × '+b.reps+' reps';
  }
  function blockRestText(b){
    if(b.scheme==='ladder') return fmt(b.restBetweenStepsSec)+' between steps · '+fmt(b.restBetweenRoundsSec)+' between rounds';
    if(b.scheme==='amrap') return '';
    return fmt(b.restSecs)+' rest';
  }

  function upcomingCard(){
    return '<div class="card tight between"><div><div class="section" style="margin:0">Skill Map</div><div class="muted small">View the full path and switch worlds</div></div><button class="btn sm primary" data-goto>View Map</button></div>';
  }
  function recentForRec(){
    return (Store.getSessions()||[]).slice(-3).reverse().map(function(s){return {kind:s.kind,date:s.date,hardPull:!!s.hardPull};});
  }

  // ---- Map ------------------------------------------------------------------
  var COLW=150,ROWH=112,PADX=72,PADY=60,NODEW=118;
  function renderMap(){
    var v=worldView(UI.worldId), world=v.world, ws=v.ws, cm=v.cm;
    var maxCol=0,maxRow=0; world.nodes.forEach(function(n){maxCol=Math.max(maxCol,n.col);maxRow=Math.max(maxRow,n.row);});
    var W=PADX*2+maxCol*COLW, H=PADY*2+maxRow*ROWH;
    var primary=v.primary;
    var completed=v.completed;

    var edges='';
    world.nodes.forEach(function(n){
      var reqs=[]; if(n.prereq){(n.prereq.all||[]).forEach(function(id){reqs.push([id,false]);});(n.prereq.any||[]).forEach(function(id){reqs.push([id,true]);});}
      reqs.forEach(function(pr){ edges+=edgePath(cm[pr[0]],n,ws,world,false); });
    });
    (world.supports||[]).forEach(function(e){ if(cm[e[0]]&&cm[e[1]]) edges+=edgePath(cm[e[0]],cm[e[1]],ws,world,true); });

    var nodes=world.nodes.map(function(n){return nodeCard(world,n,ws);}).join('');

    var rail=Data.worlds.slice().sort(function(a,b){return a.order-b.order;}).map(function(w){
      return '<div class="world-ic '+(w.id===UI.worldId?'active':'')+'" data-world="'+w.id+'" style="--world-accent:'+w.theme.accent+'" role="button" aria-label="'+esc(w.name)+'" aria-pressed="'+(w.id===UI.worldId)+'">'+ICON[w.icon]+'</div>';
    }).join('');

    var pathSummary='<div class="path-summary">'+completed+'/'+world.nodes.length+' skills'+
      (primary?' &middot; Focus: <b>'+esc(primary.name)+'</b>':'')+
      (world.note?' &middot; '+esc(world.note):'')+'</div>';

    var html=''+
      '<div class="map-head"><div><div class="map-title">'+esc(world.name)+'</div>'+
      pathSummary+'</div>'+
      '<button class="btn sm" data-center title="Center on Focus">'+ICON.center+'</button></div>'+
      '<div class="map-frame"><div class="rail" id="rail">'+rail+'</div>'+
      '<div class="canvas-wrap"><div class="canvas-scroll" id="cscroll"><div class="canvas" style="width:'+W+'px;height:'+H+'px">'+
      '<svg class="edges" width="'+W+'" height="'+H+'">'+edges+'</svg>'+nodes+'</div></div></div></div>'+
      legend();
    var wrap=shell(html,'map');
    on('#rail .world-ic','click',function(e){ switchWorld(e.currentTarget.dataset.world); },wrap);
    on('.node','click',function(e){ if(wrap.__dragged)return; openSheet(e.currentTarget.dataset.node); },wrap);
    on('[data-center]','click',function(){ centerOnFocus(wrap); },wrap);
    setupPan(wrap.querySelector('#cscroll'),wrap);
    centerOnFocus(wrap);
  }
  function centerOnFocus(wrap){
    var world=activeWorld(), ws=WS(UI.worldId), cm=contentMap(world);
    var primary=ws.focus.primary?cm[ws.focus.primary]:null;
    var sc=wrap.querySelector('#cscroll');
    if(primary&&sc){
      sc.scrollLeft = Math.max(0, (PADX+primary.col*COLW) - sc.clientWidth*0.5);
      sc.scrollTop = Math.max(0, (PADY+primary.row*ROWH) - sc.clientHeight*0.5);
    }
  }
  function nodeXY(n){return {x:PADX+n.col*COLW, y:PADY+n.row*ROWH};}
  function edgePath(src,tgt,ws,world,isSupport){
    if(!src||!tgt) return '';
    var a=nodeXY(src),b=nodeXY(tgt);
    var srcDone=Engine.isComplete(src,ews(ws,world)), tgtStatus=statusOf(world,tgt,ws);
    var lit = srcDone && (tgtStatus==='completed'||tgtStatus==='current'||tgtStatus==='maintenance');
    var toCurrent = srcDone && tgtStatus==='current';
    var locked = tgtStatus==='locked';
    var color, w, dash, opacity, glow='';
    if(isSupport){ color='#22d3a6'; w=2; dash='2,7'; opacity=locked?.25:.5; }
    else if(toCurrent){ color='#f4b740'; w=4.5; dash=''; opacity=1; glow=' filter="url(#glow)"'; }
    else if(lit){ color='#38bdf8'; w=4; dash=''; opacity=.95; }
    else if(locked){ color='#3a5674'; w=2.5; dash='4,7'; opacity=.5; }
    else { color='#4b7aa6'; w=3; dash=''; opacity=.8; }
    var midx=(a.x+b.x)/2;
    var d='M '+a.x+' '+a.y+' C '+midx+' '+a.y+' '+midx+' '+b.y+' '+b.x+' '+b.y;
    return '<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="'+w+'" '+(dash?'stroke-dasharray="'+dash+'"':'')+' stroke-linecap="round" opacity="'+opacity+'"'+glow+'/>';
  }
  function ews(ws,world){ return Engine._withContent(ws.nodes,contentMap(world)); }
  function nodeCard(world,n,ws){
    var st=statusOf(world,n,ws);
    var xy=nodeXY(n);
    var pr=Engine.progressText(n,ws.nodes);
    var dot='';
    if(st==='completed'||st==='maintenance') dot='<div class="dot" style="background:var(--accent);color:#04121f">'+ICON.check+'</div>';
    else if(st==='locked') dot='<div class="dot" style="background:#22364f;color:#8fa5c2">'+ICON.lock+'</div>';
    var focLbl = st==='current'?'<div class="foc-lbl">Current Focus</div>':'';
    var isSupportBranch = (n.type==='support'||n.type==='skill');
    var cls='node '+st+(isSupportBranch&&st==='available'?' spt-mark':'');
    return '<div class="'+cls+'" data-node="'+n.id+'" style="left:'+xy.x+'px;top:'+xy.y+'px" role="button" aria-label="'+esc(n.name)+' — '+esc(statusLabel(st))+'" tabindex="0">'+
      focLbl+dot+
      '<div class="nm">'+esc(n.name)+'</div>'+
      '<div class="sub">'+esc(n.subtitle||'')+'</div>'+
      (pr?'<div class="pr">'+esc(pr)+'</div>':'')+
      '</div>';
  }
  function legend(){
    var items=[['current','Focus','var(--focus)'],['completed','Done','var(--accent)'],['available','Available','#2f5b82'],['supporting','Supporting','var(--accent2)'],['locked','Locked','#3a5674']];
    return '<div class="legend">'+items.map(function(i){return '<span class="lg"><span class="sw" style="border-color:'+i[2]+'"></span>'+i[1]+'</span>';}).join('')+'</div>';
  }
  var STATUS_LABEL={completed:'Completed',current:'Current Focus',available:'Available',supporting:'Supporting Skill',locked:'Locked',maintenance:'Maintenance'};
  function statusLabel(s){return STATUS_LABEL[s]||s;}

  function setupPan(sc,wrap){
    var down=false,sx,sl,st,moved;
    sc.addEventListener('pointerdown',function(e){ if(e.target.closest('.node'))return; down=true;moved=false;sx=e.clientX;sl=sc.scrollLeft;st=sc.scrollTop;sc.classList.add('drag'); e.preventDefault(); });
    sc.addEventListener('pointermove',function(e){ if(!down)return; var dx=e.clientX-sx; if(Math.abs(dx)>4){moved=true;wrap.__dragged=true;} sc.scrollLeft=sl-dx; });
    function up(){ down=false;sc.classList.remove('drag'); setTimeout(function(){wrap.__dragged=false;},30); }
    sc.addEventListener('pointerup',up); sc.addEventListener('pointerleave',up); sc.addEventListener('pointercancel',up);
  }
  function switchWorld(worldId){ if(worldId===UI.worldId)return; UI.worldId=worldId; var p=Store.getProfile()||{}; p.activeWorld=worldId; Store.setProfile(p); UI.readiness=null; renderMap(); }

  // ---- node detail sheet ----------------------------------------------------
  function openSheet(nodeId){
    var v=worldView(UI.worldId), world=v.world, ws=v.ws, cm=v.cm, n=cm[nodeId];
    if(!n) return;
    var st=statusOf(world,n,ws);
    var crits=(n.criteria||[]).map(function(c){var cur=(ws.nodes[nodeId]&&ws.nodes[nodeId].criteria&&ws.nodes[nodeId].criteria[c.id])||0;var done=cur>=c.target;return '<div class="crit '+(done?'done':'')+'"><span class="ck">'+(done?ICON.check:'')+'</span><span>'+esc(c.label)+' — <b>'+cur+'/'+c.target+' '+esc(c.unit)+'</b></span></div>';}).join('');
    var missP=Engine.missingPrereqs(n,ews(ws,world),cm);
    var supports=(world.supports||[]).filter(function(e){return e[1]===nodeId;}).map(function(e){return cm[e[0]];}).filter(Boolean);
    var tmpls=(n.templates||[]).map(function(id){var t=Data.templates[id];if(!t)return '';return '<button class="btn" data-start="'+t.id+'">'+esc(t.name)+' &middot; '+durationText(t)+'</button>';}).join('');
    var canFocus = (st==='available'||st==='supporting') && n.type!=='maintenance';

    var lockNote='';
    if(st==='locked'){
      var lockReasons=missP.map(function(p){return esc(p.name);}).join(', ');
      lockNote='<div class="needs"><b>Locked</b> — complete first: '+lockReasons;
      if(n.prereq&&n.prereq.any){
        var anyNames=n.prereq.any.map(function(id){return esc(cm[id]?cm[id].name:id);}).join(', ');
        lockNote+=' &middot; At least one of: '+anyNames;
      }
      lockNote+='</div>';
    }
    if(n.prereq&&n.prereq.noPain){ lockNote+='<div class="needs small">Requires no active pain.</div>'; }

    var body='<div class="grip"></div>'+
      '<div class="between"><h2>'+esc(n.name)+'</h2><span class="badge" style="background:rgba(56,189,248,.15);color:var(--accent)">'+esc(statusLabel(st))+'</span></div>'+
      '<div class="muted small" style="margin-bottom:8px">'+esc(n.subtitle||'')+'</div>'+
      '<p class="muted">'+esc(n.why||'')+'</p>'+
      '<div class="section">Mastery Criteria</div>'+(crits||'<p class="muted small">&mdash;</p>')+
      lockNote+
      (supports.length?'<div class="section">Supporting Skills</div><p class="muted small">'+supports.map(function(s){return esc(s.name);}).join(' &middot; ')+'</p>':'')+
      '<div class="section">Recommended Workouts</div>'+(tmpls||'<p class="muted small">&mdash;</p>')+
      (canFocus?'<button class="btn ghost" data-focus="'+n.id+'">Set as Current Focus</button>':'')+
      '<button class="btn ghost" data-close>Close</button>';
    showSheet(body,function(sheet){
      on('[data-start]','click',function(e){ closeSheet(); startSession(e.currentTarget.dataset.start); },sheet);
      on('[data-focus]','click',function(e){ setFocus(e.currentTarget.dataset.focus); },sheet);
      on('[data-close]','click',closeSheet,sheet);
    });
  }
  function setFocus(nodeId){
    var world=activeWorld(), ws=WS(UI.worldId);
    var auto=Engine.autoFocus(world,ws.nodes);
    ws.focus={primary:nodeId, supporting:(auto.supporting!==nodeId?auto.supporting:null), manual:true};
    saveWS(UI.worldId,ws); closeSheet();
    toast('Focus updated — recommendation will adjust. You can change it anytime.');
    if(UI.screen==='map') renderMap(); else renderToday();
  }
  function showSheet(body,wire){
    closeSheet();
    var back=h('<div class="sheet-back"><div class="sheet">'+body+'</div></div>');
    back.addEventListener('click',function(e){ if(e.target===back) closeSheet(); });
    document.body.appendChild(back); UI.sheet=back; if(wire) wire(back);
  }
  function closeSheet(){ if(UI.sheet){UI.sheet.remove();UI.sheet=null;} }
  function toast(msg){ var t=h('<div style="position:fixed;bottom:calc(var(--nav-h) + 14px);left:50%;transform:translateX(-50%);background:var(--card2);border:1px solid var(--border);color:var(--text);padding:10px 16px;border-radius:12px;font-size:13px;z-index:95;max-width:90%;text-align:center;box-shadow:0 6px 20px rgba(0,0,0,.4)">'+esc(msg)+'</div>'); document.body.appendChild(t); setTimeout(function(){t.style.transition='opacity .3s';t.style.opacity='0';setTimeout(function(){t.remove();},300);},2600); }

  // ---- session start --------------------------------------------------------
  function startSession(templateId){
    var t=Data.templates[templateId]; if(!t) return;
    if(t.kind==='climbing') startClimbing(t); else startStrength(t);
  }

  // ---- strength runner ------------------------------------------------------
  // Workout model: each block is either a LADDER (N complete rounds of a step
  // sequence, e.g. 1-2-3 × 5) or a STRAIGHT block (independent sets/holds). The
  // runner is current-action-first: one target at a time, a compact overview of
  // rounds/sets, difficulty asked at the natural unit boundary (per ROUND for
  // ladders, per SET otherwise), and adaptation applied to the NEXT unit.
  // Build a workout from a RESOLVED prescription. The workout owns this snapshot
  // for its lifetime — later changes to saved defaults never touch it.
  function buildWorkout(rt){
    var blocks=rt.blocks.map(function(b){
      var sets=Duration.genSets(b);
      if(b.scheme==='ladder'){
        var rounds=[];
        sets.forEach(function(s){
          var ri=s.round-1;
          if(!rounds[ri]) rounds[ri]={steps:[],rated:false,difficulty:null,adaptedNote:'',reduced:false};
          rounds[ri].steps.push({target:s.target,actual:s.actual,doneFlag:false});
        });
        return {kind:'ladder',label:b.label,exId:b.exId,note:b.note||'',
          restStepSec:(b.restBetweenStepsSec!=null?b.restBetweenStepsSec:Duration.LADDER_STEP_REST),
          restRoundSec:(b.restBetweenRoundsSec!=null?b.restBetweenRoundsSec:Duration.LADDER_ROUND_REST),
          adaptEnabled:b.adaptEnabled!==false,
          origSteps:(b.steps||[1,2,3]).slice(), rounds:rounds};
      }
      return {kind:'straight',label:b.label,exId:b.exId,note:b.note||'',
        restSecs:(b.restSecs!=null?b.restSecs:Duration.restForType(rt.type)),
        adaptEnabled:b.adaptEnabled!==false,
        sets:sets.map(function(s){return {target:s.target,actual:s.actual,unit:s.unit,amrap:!!s.amrap,doneFlag:false,adapted:''};})};
    });
    return {templateId:rt.id,worldId:UI.worldId,blocks:blocks,started:Date.now(),pain:false,
      adaptations:[],lastRound:null,lastSet:null,pendingOverride:null};
  }
  function startStrength(t){
    UI.workout=buildWorkout(prescriptionFor(t));   // resolve defaults + today edit into a snapshot
    delete todayEdits[t.id];                         // the edit is now baked into the snapshot
    saveWorkoutState();
    window.scrollTo(0,0); // the Start button may have been below the fold — open at the top
    renderStrength();
  }

  function workoutCounts(w){
    var total=0,done=0;
    w.blocks.forEach(function(bl){
      if(bl.kind==='ladder') bl.rounds.forEach(function(rd){rd.steps.forEach(function(st){total++;if(st.doneFlag)done++;});});
      else bl.sets.forEach(function(s){total++;if(s.doneFlag)done++;});
    });
    return {total:total,done:done};
  }
  // First undone step/set across the whole workout, or null when finished.
  function locateCurrent(w){
    for(var bi=0;bi<w.blocks.length;bi++){
      var bl=w.blocks[bi];
      if(bl.kind==='ladder'){
        for(var ri=0;ri<bl.rounds.length;ri++){
          var rd=bl.rounds[ri];
          for(var si=0;si<rd.steps.length;si++){ if(!rd.steps[si].doneFlag) return {bi:bi,ri:ri,si:si,kind:'ladder'}; }
        }
      } else {
        for(var k=0;k<bl.sets.length;k++){ if(!bl.sets[k].doneFlag) return {bi:bi,si:k,kind:'straight'}; }
      }
    }
    return null;
  }

  function renderStrength(){
    var w=UI.workout, t=Data.templates[w.templateId];
    var counts=workoutCounts(w);
    var pct=counts.total?Math.round(counts.done/counts.total*100):0;
    var cur=locateCurrent(w);
    var allDone=!cur;
    // While a round/set rating is pending, the difficulty prompt takes over — the
    // next action card is hidden so the athlete answers before moving on.
    var ratingPending=(w.lastRound&&!w.lastRound.rated)||(w.lastSet&&!w.lastSet.rated);

    // Each block renders into its own wrapper. In landscape, the CURRENT
    // block's "what to do now" (label, cues, target/stepper/done) goes into
    // an explicit left column, while its "supporting info" (next action,
    // round/set overview) and every other block's compact overview go into
    // an explicit right column alongside the rest timer and adaptation
    // prompt — two independently-stacking wrapper divs (like Today's
    // .today-left/.today-right), not a CSS-grid row-sharing trick, so a
    // tall rest timer on the right can never push the left column down.
    // In portrait these two wrappers simply stack, and within .wk-body every
    // block (current or not) still renders in its original document order.
    var body='', side='';
    w.blocks.forEach(function(bl,bi){
      var ex=Data.exercises[bl.exId]||{};
      var isCur=cur&&cur.bi===bi;
      var label='<div class="section">'+esc(bl.label)+(bl.note?' <span class="muted tiny">&middot; '+esc(bl.note)+'</span>':'')+'</div>';
      var overview=(bl.kind==='ladder')?ladderOverview(bl,isCur?cur.ri:-1):straightOverview(bl,isCur?cur.si:-1);
      if(isCur){
        var chunk=label;
        if(!ratingPending&&ex.cues) chunk+='<p class="wk-cues muted small" style="margin:-4px 2px 8px">'+esc(ex.cues)+'</p>';
        if(!ratingPending) chunk+=renderCurCard(w,cur,bl);
        body+='<div class="wk-block-wrap wk-block-current">'+chunk+'</div>';
        side+='<div class="wk-block-wrap wk-block-current">'+(ratingPending?'':curNextHtml(bl,cur))+overview+'</div>';
      } else {
        side+='<div class="wk-block-wrap">'+label+overview+'</div>';
      }
    });

    var html=''+
      '<div class="wk-top"><div class="between"><button class="link" data-cancel>&lsaquo; Cancel</button><b>'+esc(t.name)+'</b><span class="muted small">'+counts.done+'/'+counts.total+'</span></div>'+
      '<div class="prog"><i style="width:'+pct+'%"></i></div></div>'+
      '<div class="wk-runner-body">'+
      '<div class="wk-body">'+body+'</div>'+
      '<div class="wk-side"><div id="rest"></div>'+renderAdaptPrompt(w)+side+'</div>'+
      '<div class="flag"><label class="pill '+(w.pain?'on warnbtn':'')+'" data-painflag><input type="checkbox" style="display:none" '+(w.pain?'checked':'')+'>Pain / Discomfort</label></div>'+
      (allDone?'<button class="btn primary sp" data-finish>Finish &amp; Save Workout</button>':'')+
      '</div>';
    app.innerHTML=''; app.appendChild(h('<div class="scr wk-runner">'+html+'</div>'));
    wireStrength(w);
  }

  // The target/stepper/Done card ONLY — the "next action" line is a separate
  // sibling (curNextHtml) so landscape can place it in the right column while
  // the card itself stays in the left column.
  function renderCurCard(w,cur,bl){
    if(cur.kind==='ladder'){
      var rd=bl.rounds[cur.ri], st=rd.steps[cur.si];
      return '<div class="cur-card" data-cur-round="'+(cur.ri+1)+'" data-cur-step="'+(cur.si+1)+'">'+
        '<div class="cur-meta">Round '+(cur.ri+1)+' of '+bl.rounds.length+' &middot; Step '+(cur.si+1)+' of '+rd.steps.length+'</div>'+
        '<div class="cur-target">Target <b>'+st.target+'</b> reps</div>'+
        '<div class="set" data-bi="'+cur.bi+'" data-kind="ladder" data-ri="'+cur.ri+'" data-si="'+cur.si+'">'+
          '<div class="stepper big"><button data-step="-1">&minus;</button><span class="num">'+st.actual+'</span><button data-step="1">+</button></div>'+
          '<button class="btn primary cur-done" data-done>Done</button>'+
        '</div>'+
      '</div>';
    }
    var s=bl.sets[cur.si], unit=s.unit==='sec'?'sec':'reps';
    return '<div class="cur-card" data-cur-set="'+(cur.si+1)+'">'+
      '<div class="cur-meta">Set '+(cur.si+1)+' of '+bl.sets.length+'</div>'+
      '<div class="cur-target">'+(s.amrap?'Max reps':'Target <b>'+(s.target==null?'—':s.target)+'</b> '+unit)+'</div>'+
      '<div class="set" data-bi="'+cur.bi+'" data-kind="straight" data-si="'+cur.si+'">'+
        '<div class="stepper big"><button data-step="-1">&minus;</button><span class="num">'+s.actual+'</span><button data-step="1">+</button></div>'+
        '<button class="btn primary cur-done" data-done>Done</button>'+
      '</div>'+
      (s.adapted?'<div class="adapt-note muted small">'+esc(s.adapted)+'</div>':'')+
    '</div>';
  }
  // The "next action" line, kept as its own sibling element (see above).
  function curNextHtml(bl,cur){
    var nxt=nextStepText(bl,cur);
    if(nxt) return '<div class="cur-next muted small">Next: '+esc(nxt)+'</div>';
    if(cur.kind==='ladder') return '<div class="cur-next muted small">Last step of the ladder</div>';
    return '';
  }
  function nextStepText(bl,cur){
    if(cur.kind==='ladder'){
      var rd=bl.rounds[cur.ri];
      if(cur.si+1<rd.steps.length) return rd.steps[cur.si+1].target+' reps';
      if(cur.ri+1<bl.rounds.length){
        var nr=bl.rounds[cur.ri+1];
        return 'Round '+(cur.ri+2)+' — '+nr.steps.map(function(s){return s.target;}).join('–');
      }
      return '';
    }
    if(cur.si+1<bl.sets.length){
      var ns=bl.sets[cur.si+1], unit=ns.unit==='sec'?'sec':'reps';
      return ns.amrap?'Max reps':(ns.target==null?'':ns.target+' '+unit);
    }
    return '';
  }
  function ladderOverview(bl,curRi){
    var chips=bl.rounds.map(function(rd,ri){
      var stepsTxt=rd.steps.map(function(s){return s.target;}).join('–');
      var allDone=rd.steps.every(function(s){return s.doneFlag;});
      var cls=allDone?'done':(ri===curRi?'current':'upcoming');
      var mark=allDone?'&#10003; ':(ri===curRi?'&#9679; ':'');
      return '<div class="round-chip '+cls+'"><span class="rc-lbl">Round '+(ri+1)+'</span><span class="rc-steps">'+mark+stepsTxt+'</span></div>';
    }).join('');
    return '<div class="round-overview">'+chips+'</div>';
  }
  function straightOverview(bl,curSi){
    var chips=bl.sets.map(function(s,si){
      var done=s.doneFlag, unit=s.unit==='sec'?'s':'', val=s.amrap?'Max':(s.target==null?'—':s.target+unit);
      var cls=done?'done':(si===curSi?'current':'upcoming');
      var mark=done?'&#10003; ':(si===curSi?'&#9679; ':'');
      return '<div class="round-chip '+cls+'"><span class="rc-lbl">Set '+(si+1)+'</span><span class="rc-steps">'+mark+val+'</span></div>';
    }).join('');
    return '<div class="round-overview">'+chips+'</div>';
  }

  function renderAdaptPrompt(w){
    var out='';
    if((w.lastRound&&!w.lastRound.rated)||(w.lastSet&&!w.lastSet.rated)){
      var label=w.lastRound?'How did that round feel?':'How did that set feel?';
      out+='<div class="adapt-card"><div class="section" style="margin-top:0">'+label+'</div>'+
        '<div class="opts adapt-opts">'+
        '<button class="pill" data-diff="easy">Easy</button>'+
        '<button class="pill" data-diff="appropriate">Right</button>'+
        '<button class="pill" data-diff="hard">Hard</button>'+
        '<button class="pill" data-diff="failed">Failed</button></div></div>';
    }
    if(w.pendingOverride){
      var full=w.pendingOverride.full.join('–');
      out+='<div class="adapt-card override"><div class="adapt-note">Next round was reduced. Prefer to keep the full round?</div>'+
        '<button class="btn ghost sm" data-keepfull>Keep full round ('+full+')</button></div>';
    }
    return out;
  }

  function wireStrength(w){
    on('[data-cancel]','click',function(){ if(confirm('Cancel workout? Progress won\'t be saved.')){stopTimer();UI.workout=null;saveWorkoutState();setScreen('today');} });
    on('.set [data-step]','click',function(e){
      var set=e.currentTarget.closest('.set'), ref=stepTargetRef(w,set);
      if(ref){ ref.actual=Math.max(0,ref.actual+(+e.currentTarget.dataset.step)); saveWorkoutState(); renderStrengthKeepScroll(); }
    });
    on('.set [data-done]','click',function(e){ markDone(w,e.currentTarget.closest('.set')); });
    on('[data-diff]','click',function(e){ rateCurrent(w,e.currentTarget.dataset.diff); });
    on('[data-keepfull]','click',function(){ overrideKeepFull(w); });
    on('[data-painflag]','click',function(){ w.pain=!w.pain; saveWorkoutState(); renderStrengthKeepScroll(); });
    on('[data-finish]','click',finishStrength);
  }
  function stepTargetRef(w,set){
    var bl=w.blocks[+set.dataset.bi];
    if(set.dataset.kind==='ladder') return bl.rounds[+set.dataset.ri].steps[+set.dataset.si];
    return bl.sets[+set.dataset.si];
  }
  // Mark the current step/set done. Inter-STEP rest starts immediately (no
  // prompt). At a unit boundary (a ladder round's last step, or any straight
  // set) we ask difficulty FIRST; the rest starts only after the rating, so the
  // rest reflects any adaptation and the countdown never fights a re-render.
  function markDone(w,set){
    stopTimer();
    var bi=+set.dataset.bi, bl=w.blocks[bi];
    if(set.dataset.kind==='ladder'){
      var ri=+set.dataset.ri, si=+set.dataset.si, rd=bl.rounds[ri];
      rd.steps[si].doneFlag=true;
      if(w.pendingOverride&&w.pendingOverride.bi===bi&&w.pendingOverride.ri===ri) w.pendingOverride=null;
      var lastStep=si===rd.steps.length-1;
      saveWorkoutState();
      if(lastStep&&bl.adaptEnabled){ w.lastRound={bi:bi,ri:ri,rated:false}; renderStrength(); }  // ask, then rest on rate
      else { renderStrength(); if(locateCurrent(w)) startRest(lastStep?bl.restRoundSec:bl.restStepSec); }
    } else {
      bl.sets[+set.dataset.si].doneFlag=true;
      if(bl.adaptEnabled){ w.lastSet={bi:bi,si:+set.dataset.si,rated:false}; saveWorkoutState(); renderStrength(); }  // ask, then rest
      else { saveWorkoutState(); renderStrength(); if(locateCurrent(w)) startRest(bl.restSecs); }
    }
  }
  function firstFailedStep(rd){
    for(var i=0;i<rd.steps.length;i++){ if(rd.steps[i].actual<rd.steps[i].target) return i+1; }
    return rd.steps.length;
  }
  function applyRoundPrescription(rd,steps){
    rd.steps=steps.map(function(tg){return {target:tg,actual:tg,doneFlag:false};});
  }
  function rateCurrent(w,diff){
    if(w.lastRound&&!w.lastRound.rated){
      var bl=w.blocks[w.lastRound.bi], rd=bl.rounds[w.lastRound.ri];
      rd.rated=true; rd.difficulty=diff; w.lastRound.rated=true;
      var steps=rd.steps.map(function(s){return s.target;});
      var failedAt=diff===Adapt.FAILED?firstFailedStep(rd):null;
      var result=Adapt.adaptNextRound(diff,steps,failedAt);
      w.adaptations.push({type:'round',bi:w.lastRound.bi,ri:w.lastRound.ri,difficulty:diff,result:result});
      var nextRd=bl.rounds[w.lastRound.ri+1];
      if(nextRd){
        applyRoundPrescription(nextRd,result.steps);
        nextRd.adaptedNote=result.explanation; nextRd.reduced=result.reduced;
        w.pendingOverride=result.reduced?{bi:w.lastRound.bi,ri:w.lastRound.ri+1,full:steps.slice()}:null;
      } else { w.pendingOverride=null; }
      if(result.roundRestDelta) bl.restRoundSec=Adapt.applyRestDelta(bl.restRoundSec,result.roundRestDelta);
      w.lastRound=null;
      saveWorkoutState(); renderStrength();
      if(locateCurrent(w)) startRest(bl.restRoundSec);   // inter-round rest AFTER the rating
    } else if(w.lastSet&&!w.lastSet.rated){
      var bl2=w.blocks[w.lastSet.bi], lastSet=bl2.sets[w.lastSet.si];
      var res=Adapt.adaptNext(diff,lastSet);
      w.adaptations.push({type:'set',bi:w.lastSet.bi,si:w.lastSet.si,difficulty:diff,result:res});
      var nx=findNextUndoneSet(bl2,w.lastSet.si);
      if(nx!=null){
        var ns=bl2.sets[nx];
        if(res.targetDelta!==0){ ns.target=Adapt.applyTargetDelta(ns.target,res.targetDelta,ns.unit); ns.actual=ns.target||ns.actual; }
        ns.adapted=res.explanation;
      }
      if(res.restDelta!==0) bl2.restSecs=Adapt.applyRestDelta(bl2.restSecs,res.restDelta);
      w.lastSet.rated=true; w.lastSet=null;
      saveWorkoutState(); renderStrength();
      if(locateCurrent(w)) startRest(bl2.restSecs);       // rest AFTER the rating
    }
  }
  function overrideKeepFull(w){
    if(!w.pendingOverride) return;
    var bl=w.blocks[w.pendingOverride.bi], rd=bl.rounds[w.pendingOverride.ri];
    applyRoundPrescription(rd,w.pendingOverride.full);
    rd.adaptedNote='Kept the full round ('+w.pendingOverride.full.join('–')+') by your choice.'; rd.reduced=false;
    w.pendingOverride=null;
    saveWorkoutState(); renderStrengthKeepScroll();
  }
  function findNextUndoneSet(bl,fromSi){
    for(var si=fromSi+1;si<bl.sets.length;si++){ if(!bl.sets[si].doneFlag) return si; }
    return null;
  }
  function renderStrengthKeepScroll(){var y=window.scrollY;renderStrength();window.scrollTo(0,y);}

  // ---- rest timer with audio, countdown, pause, +30s ------------------------
  function startRest(secs){
    stopTimer();
    var el=document.getElementById('rest'); if(!el)return;
    UI.timerPaused=false; UI.timerLeft=secs;
    render();
    UI.timer=setInterval(function(){
      if(UI.timerPaused) return;
      UI.timerLeft--;
      if(UI.timerLeft<=3&&UI.timerLeft>0&&settings().timer.countdown) playCountdownTick();
      if(UI.timerLeft<=0){
        stopTimer();
        if(settings().timer.sound) playBeep();
        if(settings().timer.vibrate) vibrate([100,50,100,50,200]);
        el.innerHTML='<div class="timer"><div class="muted small">Rest complete!</div><div class="t ready-pulse">GO</div></div>';
        return;
      }
      render();
    },1000);
    function render(){
      el.innerHTML='<div class="timer"><div class="muted small">Rest</div><div class="t">'+fmt(UI.timerLeft)+'</div>'+
        '<div class="timer-btns">'+
        '<button class="link" data-tpause>'+(UI.timerPaused?'Resume':'Pause')+'</button>'+
        '<button class="link" data-t30>+30s</button>'+
        '<button class="link" data-tskip>Skip</button></div></div>';
      wireTimerBtns(el);
    }
  }
  function wireTimerBtns(el){
    var pauseBtn=el.querySelector('[data-tpause]');
    var addBtn=el.querySelector('[data-t30]');
    var skipBtn=el.querySelector('[data-tskip]');
    if(pauseBtn) pauseBtn.onclick=function(){
      UI.timerPaused=!UI.timerPaused;
      pauseBtn.textContent=UI.timerPaused?'Resume':'Pause';
    };
    if(addBtn) addBtn.onclick=function(){
      UI.timerLeft+=30;
      var t=el.querySelector('.t'); if(t) t.textContent=fmt(UI.timerLeft);
    };
    if(skipBtn) skipBtn.onclick=function(){stopTimer();el.innerHTML='';};
  }
  function stopTimer(){ if(UI.timer){clearInterval(UI.timer);UI.timer=null;} }
  function fmt(s){if(s<0)s=0;var m=Math.floor(s/60),ss=s%60;return m+':'+(ss<10?'0':'')+ss;}

  function collectExResults(w){
    var exRes={};
    function record(id,actual,unit,doneFlag){
      if(!doneFlag&&!actual) return;
      if(!exRes[id]) exRes[id]={};
      if(unit==='sec') exRes[id].bestSeconds=Math.max(exRes[id].bestSeconds||0,actual);
      else exRes[id].bestReps=Math.max(exRes[id].bestReps||0,actual);
    }
    w.blocks.forEach(function(bl){
      if(bl.kind==='ladder') bl.rounds.forEach(function(rd){rd.steps.forEach(function(st){record(bl.exId,st.actual,'reps',st.doneFlag);});});
      else bl.sets.forEach(function(s){record(bl.exId,s.actual,s.unit,s.doneFlag);});
    });
    return exRes;
  }
  function finishStrength(){
    stopTimer(); var w=UI.workout, world=worldsById(w.worldId), t=Data.templates[w.templateId];
    var exRes=collectExResults(w);
    var ws=WS(w.worldId);
    var session={id:'cs_'+Date.now(),kind:'strength',templateId:t.id,worldId:w.worldId,date:new Date().toISOString(),
      exResults:exRes,targetNodeIds:[ws.focus.primary,ws.focus.supporting].filter(Boolean),pain:w.pain,
      hardPull:(t.type==='strength'||t.type==='power'),difficulty:t.difficulty,adaptations:w.adaptations};
    var res=Progress.applyStrength(world,ws.nodes,session,Data.exercises);
    ws.nodes=res.states; recomputeFocus(world,ws); saveWS(w.worldId,ws);
    var bench=Store.getBench(); Object.keys(res.bench||{}).forEach(function(k){bench[k]=Math.max(bench[k]||0,res.bench[k]);}); Store.setBench(bench);
    var sessions=Store.getSessions(); sessions.push(session); Store.setSessions(sessions);
    UI.workout=null; saveWorkoutState();
    showSummary(world,res,session);
  }

  // ---- climbing logger ------------------------------------------------------
  function startClimbing(t){
    var world=activeWorld(), ws=WS(UI.worldId), cm=contentMap(world);
    var techFocus=[ws.focus.primary,ws.focus.supporting].filter(Boolean).filter(function(id){var n=cm[id];return n&&(n.type==='skill'||n.type==='foundation'||n.type==='strength');});
    UI.climb={templateId:t.id,worldId:UI.worldId,warm:false,problems:[],rpe:3,finger:2,skin:2,techFocus:techFocus,cur:{grade:'V2',style:null,result:null}};
    saveWorkoutState();
    window.scrollTo(0,0); // the Start button may have been below the fold — open at the top
    renderClimbing();
  }
  function renderClimbing(){
    var c=UI.climb, t=Data.templates[c.templateId], world=worldsById(c.worldId), cm=contentMap(world);
    var grades=['V0','V1','V2','V3','V4','V5','V6'];
    var probList=c.problems.map(function(p,i){return '<div class="prob"><div class="ph"><b>'+esc(p.grade)+' &middot; '+esc(styleLabel(p.style))+'</b><span class="badge" style="background:rgba(56,189,248,.15);color:var(--accent)">'+esc(resultLabel(p.result))+'</span></div>'+(p.note?'<div class="muted small">'+esc(p.note)+'</div>':'')+'<div><button class="link" data-del="'+i+'">Delete</button></div></div>';}).join('');
    var focusNames=c.techFocus.map(function(id){return cm[id]?cm[id].name:id;});
    // Left = session objective + current problem (the active task): goal,
    // warmup, grade/style/result pickers. Right = logged problems/attempts,
    // rest timer, finger/skin checks + finish. In portrait the two wrapper
    // divs stack in this same order, unchanged from before.
    var left=''+
      '<div class="rec"><div class="kick">Session Goal</div><div class="name" style="font-size:17px">'+esc(t.focus||'')+'</div>'+
      '<div class="meta"><span>Target: '+esc(t.targetGrade||'—')+'</span><span>'+durationText(t)+'</span></div>'+
      (focusNames.length?'<div class="foci"><span class="tag gold">'+ICON.star+' '+esc(focusNames.join(' &middot; '))+'</span></div>':'')+'</div>'+
      '<label class="pill '+(c.warm?'on':'')+'" data-warm style="margin:6px 0">'+(c.warm?'&#10003; ':'')+'Gradual warmup completed</label>'+
      '<div class="section">Current Problem</div><div class="card tight">'+
      '<div class="muted small">Grade</div><div class="grade-pick" data-grades>'+grades.map(function(g){return '<button class="pill '+(c.cur.grade===g?'on':'')+'" data-g="'+g+'">'+g+'</button>';}).join('')+'</div>'+
      '<div class="muted small sp">Style</div><div class="opts" data-styles>'+Data.climbStyles.map(function(s){return '<button class="pill '+(c.cur.style===s.v?'on':'')+'" data-s="'+s.v+'">'+esc(s.label)+'</button>';}).join('')+'</div>'+
      '<div class="muted small sp">Result</div><div class="opts" data-results>'+Data.climbResults.map(function(r){return '<button class="pill '+(c.cur.result===r.v?'on':'')+'" data-r="'+r.v+'">'+esc(r.label)+'</button>';}).join('')+'</div>'+
      '<button class="btn primary sp" data-add '+(c.cur.result?'':'disabled')+'>Add Problem to Log</button></div>';
    var right=''+
      (probList?'<div class="section">Logged Problems</div>'+probList:'')+
      '<div id="rest"></div>'+
      '<div class="section">Session Summary</div><div class="card tight">'+
      seg2('rpe','Overall Effort (RPE)',c.rpe,['1','2','3','4','5'])+
      seg2('finger','Fingers',c.finger,['Sensitive','OK','Good'])+
      seg2('skin','Skin',c.skin,['Sensitive','OK','Good'])+'</div>'+
      '<button class="btn primary" data-finish '+(c.problems.length?'':'disabled')+'>Finish &amp; Save Session</button>';
    var html=''+
      '<div class="wk-top"><div class="between"><button class="link" data-cancel>&lsaquo; Cancel</button><b>'+esc(t.name)+'</b><span class="muted small">'+c.problems.length+' problems</span></div></div>'+
      '<div class="climb-grid"><div class="climb-left">'+left+'</div><div class="climb-right">'+right+'</div></div>';
    app.innerHTML=''; app.appendChild(h('<div class="scr">'+html+'</div>'));
    on('[data-cancel]','click',function(){ if(confirm('Cancel session? Progress won\'t be saved.')){UI.climb=null;saveWorkoutState();setScreen('today');} });
    on('[data-warm]','click',function(){c.warm=!c.warm;saveWorkoutState();renderClimbing();});
    on('[data-grades] .pill','click',function(e){c.cur.grade=e.currentTarget.dataset.g;renderClimbing();});
    on('[data-styles] .pill','click',function(e){c.cur.style=e.currentTarget.dataset.s;renderClimbing();});
    on('[data-results] .pill','click',function(e){c.cur.result=e.currentTarget.dataset.r;renderClimbing();});
    on('[data-add]','click',function(){ if(!c.cur.result)return; c.problems.push({grade:c.cur.grade,style:c.cur.style||'vertical',result:c.cur.result}); c.cur={grade:c.cur.grade,style:null,result:null}; saveWorkoutState();renderClimbing(); });
    on('[data-del]','click',function(e){ c.problems.splice(+e.currentTarget.dataset.del,1); saveWorkoutState();renderClimbing(); });
    on('[data-seg]','click',function(e){c[e.currentTarget.dataset.seg]=+e.currentTarget.dataset.v;saveWorkoutState();renderClimbing();});
    on('[data-finish]','click',finishClimbing);
  }
  function seg2(k,label,val,opts){return '<div class="rdy-row"><span class="lbl">'+esc(label)+'</span><div class="seg">'+opts.map(function(o,i){return '<button data-seg="'+k+'" data-v="'+(i+1)+'" class="'+(val===i+1?'on':'')+'">'+esc(o)+'</button>';}).join('')+'</div></div>';}
  function styleLabel(v){var s=Data.climbStyles.filter(function(x){return x.v===v;})[0];return s?s.label:v;}
  function resultLabel(v){var r=Data.climbResults.filter(function(x){return x.v===v;})[0];return r?r.label:v;}
  function finishClimbing(){
    stopTimer(); var c=UI.climb, world=worldsById(c.worldId), t=Data.templates[c.templateId], ws=WS(c.worldId);
    var hardPull=c.problems.some(function(p){return ['V3','V4','V5','V6'].indexOf(p.grade)>=0;})||t.type==='project'||t.type==='power';
    var session={id:'cc_'+Date.now(),kind:'climbing',templateId:t.id,worldId:c.worldId,date:new Date().toISOString(),
      problems:c.problems,techniqueFocus:c.techFocus,targetNodeIds:[ws.focus.primary,ws.focus.supporting].filter(Boolean),
      rpe:c.rpe,finger:c.finger,skin:c.skin,hardPull:hardPull,difficulty:t.difficulty};
    var res=Progress.applyClimbing(world,ws.nodes,session);
    ws.nodes=res.states; recomputeFocus(world,ws); saveWS(c.worldId,ws);
    var sessions=Store.getSessions(); sessions.push(session); Store.setSessions(sessions);
    UI.climb=null; saveWorkoutState();
    showSummary(world,res,session);
  }

  // ---- post-session summary + unlock ----------------------------------------
  function showSummary(world,res,session){
    var cm=contentMap(world);
    var unlocked=(res.unlocked||[]).map(function(id){return cm[id];}).filter(Boolean);
    function proceed(){
      var ws=WS(UI.worldId);
      var rec=Engine.recommend({world:world,states:ws.nodes,focus:ws.focus,templates:Data.templates,readiness:readiness(),recent:recentForRec()});
      var nt=Data.templates[rec.sessionTemplateId];
      var affected=(session.targetNodeIds||[]).map(function(id){return cm[id];}).filter(Boolean);
      var html='<div class="hero" style="text-align:center;padding-top:20px"><div class="badge" style="background:rgba(61,220,151,.15);color:var(--good);margin-bottom:8px">Workout Saved</div><h1>Nice Work!</h1></div>'+
        '<div class="card"><div class="section" style="margin-top:0">Progress</div>'+
        (affected.length?affected.map(function(n){return '<div class="crit"><span>'+esc(n.name)+' — '+esc(Engine.progressText(n,ws.nodes))+'</span></div>';}).join(''):'<p class="muted small">Data updated.</p>')+'</div>'+
        (unlocked.length?'<div class="card ok" style="border-color:var(--focus)"><div class="section" style="margin-top:0">New Skills Unlocked</div>'+unlocked.map(function(n){return '<div class="crit done"><span class="ck">'+ICON.check+'</span><span>'+esc(n.name)+'</span></div>';}).join('')+'</div>':'')+
        (nt?'<div class="section">Recommended Next</div><div class="rec"><div class="name" style="font-size:18px">'+esc(nt.name)+'</div><div class="why">'+esc(rec.why||'')+'</div></div>':'')+
        '<button class="btn primary" data-map>View Map</button><button class="btn ghost" data-today>Back to Today</button>';
      window.scrollTo(0,0);
      app.innerHTML=''; app.appendChild(h('<div class="scr">'+html+'</div>'));
      on('[data-map]','click',function(){setScreen('map');});
      on('[data-today]','click',function(){setScreen('today');});
    }
    if(unlocked.length){
      var box=h('<div class="unlock"><div class="box"><div class="ring">'+ICON.star+'</div><h2>New Skill Unlocked!</h2><p class="muted">'+esc(unlocked[0].name)+(unlocked.length>1?' and '+(unlocked.length-1)+' more':'')+'</p><button class="btn primary" data-ok>Continue</button></div></div>');
      document.body.appendChild(box); box.querySelector('[data-ok]').onclick=function(){box.remove();proceed();};
    } else proceed();
  }

  // ---- Progress -------------------------------------------------------------
  function renderProgress(){
    var world=activeWorld(), ws=WS(UI.worldId), cm=contentMap(world);
    var sessions=(Store.getSessions()||[]).filter(function(s){return s.worldId===UI.worldId;});
    var completed=world.nodes.filter(function(n){return Engine.isComplete(n,ews(ws,world));});
    var primary=ws.focus.primary?cm[ws.focus.primary]:null;
    var weekAgo=Date.now()-7*864e5; var thisWeek=sessions.filter(function(s){return new Date(s.date).getTime()>=weekAgo;}).length;
    var chart='';
    if(world.id==='muscleup'){
      var pts=sessions.filter(function(s){return s.exResults&&s.exResults.pullup&&s.exResults.pullup.bestReps;}).map(function(s){return {v:s.exResults.pullup.bestReps,d:s.date};});
      if(pts.length){var mx=Math.max.apply(null,pts.map(function(p){return p.v;}));chart='<div class="section">Pull-Up Max Over Time</div><div class="chart">'+pts.slice(-8).map(function(p){return '<div class="bar" style="height:'+Math.round(p.v/mx*80)+'px"><span>'+p.v+'</span><em>'+new Date(p.d).toLocaleDateString('en-US',{day:'numeric',month:'numeric'})+'</em></div>';}).join('')+'</div>';}
    } else {
      var byGrade={}; sessions.forEach(function(s){(s.problems||[]).forEach(function(p){if(p.result==='send'||p.result==='flash'){byGrade[p.grade]=(byGrade[p.grade]||0)+1;}});});
      var gs=Object.keys(byGrade).sort(); if(gs.length){var gm=Math.max.apply(null,gs.map(function(g){return byGrade[g];}));chart='<div class="section">Sends by Grade</div><div class="chart">'+gs.map(function(g){return '<div class="bar" style="height:'+Math.round(byGrade[g]/gm*80)+'px"><span>'+byGrade[g]+'</span><em>'+g+'</em></div>';}).join('')+'</div>';}
    }
    var bench=Store.getBench();
    var left=''+
      '<div class="card tight" style="margin-top:12px"><div class="between"><div><div style="font-size:26px;font-weight:900;color:var(--accent)">'+completed.length+'</div><div class="muted small">Skills Completed</div></div>'+
      '<div><div style="font-size:26px;font-weight:900">'+sessions.length+'</div><div class="muted small">Sessions in World</div></div>'+
      '<div><div style="font-size:26px;font-weight:900">'+thisWeek+'</div><div class="muted small">This Week</div></div></div></div>'+
      chart;
    var right=''+
      '<div class="section">Recently Completed</div>'+
      (completed.length?completed.slice(-6).reverse().map(function(n){return '<div class="crit done"><span class="ck">'+ICON.check+'</span><span>'+esc(n.name)+'</span></div>';}).join(''):'<p class="muted small">None yet — finish a workout to progress.</p>')+
      (world.id==='muscleup'&&bench.pullup_max?'<div class="section">Personal Records</div><table class="kv"><tr><td>Pull-Up Max</td><td>'+bench.pullup_max+'</td></tr>'+(bench.dips_max?'<tr><td>Dip Max</td><td>'+bench.dips_max+'</td></tr>':'')+'</table>':'')+
      '<p class="footnote muted tiny sp">Data is based on completed workouts and Pull-Up Coach history (read-only).</p>';
    var html=''+
      '<h1>Progress</h1><p class="muted small">'+esc(world.name)+(primary?' &middot; Focus: '+esc(primary.name):'')+'</p>'+
      '<div class="progress-grid"><div class="progress-left">'+left+'</div><div class="progress-right">'+right+'</div></div>';
    shell(html,'progress');
  }

  // ---- Profile / Settings ---------------------------------------------------
  // The Profile tab is a small settings hub with focused sub-screens rather than
  // one long page. `settingsView` selects the current sub-screen.
  var settingsView='home';
  function renderProfile(){
    if(UI.editor) return renderWorkoutEditor();
    if(settingsView==='goals') return renderGoalsSettings();
    if(settingsView==='workoutDefaults') return renderWorkoutDefaultsList();
    if(settingsView==='timer') return renderTimerSettings();
    if(settingsView==='exercises') return renderExerciseLibrary();
    if(settingsView==='data') return renderDataSettings();
    return renderSettingsHome();
  }
  function settingsBackHeader(title){
    return '<div class="wk-top"><div class="between"><button class="link" data-sback>&lsaquo; Settings</button><b>'+esc(title)+'</b><span style="width:60px"></span></div></div>';
  }
  function settingsRow(view,title,sub){
    return '<button class="settings-row" data-sview="'+view+'"><div class="sr-main"><div class="sr-title">'+esc(title)+'</div><div class="muted small">'+esc(sub)+'</div></div><span class="sr-arrow">&rsaquo;</span></button>';
  }
  function renderSettingsHome(){
    var html='<h1>Profile &amp; Settings</h1>'+
      '<div class="settings-list">'+
      settingsRow('goals','Active Goals','Goal world, training days, session length')+
      settingsRow('workoutDefaults','Workout Defaults','Rounds, reps and rests per workout')+
      settingsRow('timer','Timer & Alerts','Sound, vibration, countdown ticks')+
      settingsRow('exercises','Exercise Library','Every exercise, benchmark and alternative')+
      settingsRow('data','Data & History','Legacy data, reset, re-run onboarding')+
      '</div>';
    var wrap=shell(html,'profile');
    on('[data-sview]','click',function(e){ settingsView=e.currentTarget.dataset.sview; renderProfile(); },wrap);
  }
  function wireSettingsBack(wrap){ on('[data-sback]','click',function(){ settingsView='home'; renderProfile(); },wrap); }

  function renderGoalsSettings(){
    var p=Store.getProfile()||{};
    var dayLabels=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], days=p.days||[];
    var html=settingsBackHeader('Active Goals')+
      '<div class="section">Active Goal World</div><div class="opts" id="worlds">'+Data.worlds.map(function(w){return '<button class="pill '+(w.id===UI.worldId?'on':'')+'" data-world="'+w.id+'">'+esc(w.name)+'</button>';}).join('')+'</div>'+
      '<div class="section">Training Days</div><div class="opts" id="days">'+dayLabels.map(function(d,i){return '<button class="pill '+(days.indexOf(i)>=0?'on':'')+'" data-d="'+i+'">'+d+'</button>';}).join('')+'</div>'+
      '<div class="section">Preferred Session Length</div><div class="opts" id="dur">'+['short','normal','long'].map(function(v){return '<button class="pill '+(p.duration===v?'on':'')+'" data-v="'+v+'">'+({short:'Short',normal:'Normal',long:'Long'}[v])+'</button>';}).join('')+'</div>';
    var wrap=shell(html,'profile'); wireSettingsBack(wrap);
    on('#worlds .pill','click',function(e){switchWorldProfile(e.currentTarget.dataset.world);},wrap);
    on('#days .pill','click',function(e){var i=+e.currentTarget.dataset.d;var a=(p.days||[]).slice();var k=a.indexOf(i);if(k>=0)a.splice(k,1);else a.push(i);p.days=a;Store.setProfile(p);renderProfile();},wrap);
    on('#dur .pill','click',function(e){p.duration=e.currentTarget.dataset.v;Store.setProfile(p);UI.readiness=null;renderProfile();},wrap);
  }

  function renderTimerSettings(){
    var tm=settings().timer;
    function tgl(k,label,sub){return '<div class="settings-row static"><div class="sr-main"><div class="sr-title">'+esc(label)+'</div><div class="muted small">'+esc(sub)+'</div></div>'+
      '<button class="toggle '+(tm[k]?'on':'')+'" data-tgl="'+k+'" role="switch" aria-checked="'+(!!tm[k])+'"><span class="knob"></span></button></div>';}
    var html=settingsBackHeader('Timer & Alerts')+
      '<div class="settings-list">'+
      tgl('sound','Beep at end of rest','A three-tone chime when the rest timer finishes')+
      tgl('vibrate','Vibrate at end of rest','Haptic buzz on supported devices')+
      tgl('countdown','Countdown ticks','A tick on the last 3 seconds of each rest')+
      '</div>';
    var wrap=shell(html,'profile'); wireSettingsBack(wrap);
    on('[data-tgl]','click',function(e){var k=e.currentTarget.dataset.tgl;settings().timer[k]=!settings().timer[k];saveSettings();renderProfile();},wrap);
  }

  function isStandalone(){
    try{ return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true; }catch(e){ return false; }
  }
  function installSection(){
    if(isStandalone()) return '<div class="section">Install</div><div class="card tight"><p class="small">&#10003; Running as an installed app.</p></div>';
    if(window.__spcInstallPrompt) return '<div class="section">Install</div><div class="card tight"><p class="small">Add Skill Progression Coach to your home screen as its own app, separate from Pull-Up Coach.</p><button class="btn primary" data-install>Install Skill Progression Coach</button></div>';
    return '<div class="section">Install</div><div class="card tight"><p class="small">Add Skill Progression Coach to your home screen as its own app. In your browser menu choose <b>Add to Home Screen</b> (on iPhone: Share &rarr; Add to Home Screen).</p></div>';
  }
  function renderDataSettings(){
    var html=settingsBackHeader('Data & History')+
      installSection()+
      '<div class="section">About</div>'+
      '<div class="card tight"><p class="small">This app reads <b>Pull-Up Coach</b> history read-only and writes only its own <code>spc_c_*</code> keys. It never modifies the Pull-Up Coach app. Its own service worker is scoped to <code>/skill-progression-coach/</code> and does not affect Pull-Up Coach.</p></div>'+
      '<button class="btn ghost" data-redo>Re-run Onboarding</button>'+
      '<button class="btn danger" data-reset>Reset Coach Data (spc_c_*)</button>'+
      '<p class="footnote muted tiny">Reset only deletes coach data. Your Pull-Up Coach history and progress are untouched.</p>';
    var wrap=shell(html,'profile'); wireSettingsBack(wrap);
    on('[data-install]','click',function(){
      var p=window.__spcInstallPrompt; if(!p) return;
      p.prompt(); if(p.userChoice) p.userChoice.then(function(){ window.__spcInstallPrompt=null; if(settingsView==='data') renderProfile(); });
    },wrap);
    on('[data-redo]','click',function(){OB=null;renderOnboarding(0);},wrap);
    on('[data-reset]','click',function(){if(confirm('Reset all coach data? Pull-Up Coach data is untouched.')){Store.reset();_settings=null;todayEdits={};UI.readiness=null;UI.worldId=null;settingsView='home';boot();}},wrap);
  }

  // ---- Exercise Library -----------------------------------------------------
  function exerciseMeta(e){
    var worlds={},tracks={},nodes=[];
    (e.related||[]).forEach(function(nid){
      var idx=Data.nodeIndex[nid]; if(!idx) return;
      var w=Data.worldsById[idx.worldId]; if(w) worlds[w.name]=true;
      nodes.push(idx.node.name);
      var br=(w&&w.branches||[]).filter(function(b){return b.id===idx.node.branchId;})[0];
      if(br) tracks[br.name]=true;
    });
    return {worlds:Object.keys(worlds),tracks:Object.keys(tracks),nodes:nodes};
  }
  var MEASURE_LABEL={reps:'Repetitions',sec:'Duration (seconds)',weight:'Added weight',assist:'Assistance',climb:'Climbing result'};
  function benchText(e){
    if(!e.benchKey) return null;
    var v=Store.getBench()[e.benchKey];
    if(v==null) return 'Not yet recorded';
    return e.measure==='sec'?(v+' sec'):(e.measure==='weight'?(v+' kg'):(v+' reps'));
  }
  function defaultsText(e){
    if(!e.defaults) return null;
    if(e.defaults.seconds!=null) return e.defaults.sets+' × '+e.defaults.seconds+' sec';
    return e.defaults.sets+' × '+e.defaults.reps+' reps';
  }
  function renderExerciseLibrary(){
    var cats={};
    Object.keys(Data.exercises).forEach(function(id){var e=Data.exercises[id];(cats[e.category]=cats[e.category]||[]).push(e);});
    var html=settingsBackHeader('Exercise Library')+
      '<p class="muted small" style="margin:0 2px 4px">Only exercises that support the active goals — not a generic gym database.</p>'+
      '<div class="settings-list">';
    Object.keys(cats).forEach(function(cat){
      html+='<div class="section">'+esc(cat)+'</div>';
      cats[cat].forEach(function(e){
        var enabled=Settings.exerciseEnabled(settings(),e.id);
        html+='<button class="settings-row" data-exdetail="'+esc(e.id)+'"><div class="sr-main"><div class="sr-title">'+esc(e.name)+(enabled?'':' <span class="muted small">· off</span>')+'</div><div class="muted small">'+esc(e.purpose||'')+'</div></div><span class="sr-arrow">&rsaquo;</span></button>';
      });
    });
    html+='</div>';
    var wrap=shell(html,'profile'); wireSettingsBack(wrap);
    on('[data-exdetail]','click',function(e){ openExerciseSheet(e.currentTarget.dataset.exdetail); },wrap);
  }
  function openExerciseSheet(exId){
    var e=Data.exercises[exId]; if(!e) return;
    var m=exerciseMeta(e), bench=benchText(e), defs=defaultsText(e), enabled=Settings.exerciseEnabled(settings(),e.id);
    var alts=(e.alternatives||[]).map(function(a){return Data.exercises[a]?Data.exercises[a].name:a;});
    function row(label,val){return val?'<div class="kv-row"><span class="kv-k">'+esc(label)+'</span><span class="kv-v">'+esc(val)+'</span></div>':'';}
    var body='<div class="grip"></div>'+
      '<div class="between"><h2>'+esc(e.name)+'</h2><span class="badge" style="background:rgba(56,189,248,.15);color:var(--accent)">'+esc(e.category)+'</span></div>'+
      '<p class="muted">'+esc(e.purpose||'')+'</p>'+
      '<div class="section">Details</div>'+
      row('Measurement',MEASURE_LABEL[e.measure]||e.measure)+
      row('Current benchmark',bench)+
      row('Default sets',defs)+
      row('Equipment',e.equipment)+
      row('Worlds',m.worlds.join(', '))+
      row('Goal tracks',m.tracks.join(', '))+
      row('Skill nodes',m.nodes.join(', '))+
      row('Approved alternatives',alts.length?alts.join(', '):'None')+
      '<div class="section">Technique</div><p class="muted small">'+esc(e.cues||'')+'</p>'+
      '<div class="settings-row static" style="margin-top:10px"><div class="sr-main"><div class="sr-title">Enabled for recommendations</div></div>'+
      '<button class="toggle '+(enabled?'on':'')+'" data-extoggle="'+esc(e.id)+'" role="switch" aria-checked="'+enabled+'"><span class="knob"></span></button></div>'+
      '<button class="btn ghost" data-close>Close</button>';
    showSheet(body,function(sheet){
      on('[data-extoggle]','click',function(ev){var id=ev.currentTarget.dataset.extoggle;var s=settings();if(!s.exercises[id])s.exercises[id]={};s.exercises[id].enabled=!Settings.exerciseEnabled(s,id);saveSettings();closeSheet();openExerciseSheet(id);},sheet);
      on('[data-close]','click',closeSheet,sheet);
    });
  }

  // ---- Workout Defaults list ------------------------------------------------
  function templateSummaryLine(t){
    var rt=prescriptionFor(t);
    if(!rt.blocks||!rt.blocks.length) return t.focus||(t.targetGrade?('Target '+t.targetGrade):'Climbing session');
    return rt.blocks.map(function(b){return blockStructureText(b);}).join(' · ');
  }
  function renderWorkoutDefaultsList(){
    var html=settingsBackHeader('Workout Defaults')+
      '<p class="muted small" style="margin:0 2px 4px">Defaults are per workout — editing one never changes the others.</p>';
    Data.worlds.forEach(function(w){
      var tmpls=Object.keys(Data.templates).map(function(k){return Data.templates[k];}).filter(function(t){return t.worldId===w.id;});
      var strength=tmpls.filter(function(t){return t.blocks&&t.blocks.length;});
      var climbing=tmpls.filter(function(t){return !t.blocks||!t.blocks.length;});
      if(strength.length){
        html+='<div class="section">'+esc(w.name)+'</div>';
        strength.forEach(function(t){
          var custom=Settings.isCustomDefault(t,settings());
          html+='<button class="settings-row" data-editdef="'+esc(t.id)+'"><div class="sr-main"><div class="sr-title">'+esc(t.name)+(custom?' <span class="chip-mod">customised</span>':'')+'</div><div class="muted small">'+esc(templateSummaryLine(t))+' · '+esc(durationText(t))+'</div></div><span class="sr-arrow">&rsaquo;</span></button>';
        });
      }
      if(climbing.length){
        html+='<div class="section">'+esc(w.name)+' — Climbing Sessions</div>';
        climbing.forEach(function(t){
          html+='<div class="settings-row static"><div class="sr-main"><div class="sr-title">'+esc(t.name)+'</div><div class="muted small">'+esc(t.focus||'')+(t.targetGrade?' · Target '+esc(t.targetGrade):'')+'</div></div></div>';
        });
        html+='<p class="footnote muted tiny">Climbing sessions are goal-driven; duration is never auto-estimated from reps.</p>';
      }
    });
    var wrap=shell(html,'profile'); wireSettingsBack(wrap);
    on('[data-editdef]','click',function(e){ openWorkoutEditor(e.currentTarget.dataset.editdef,'default'); },wrap);
  }

  // ---- Workout editor (defaults OR today-only) ------------------------------
  function openWorkoutEditor(templateId,scope){
    var t=Data.templates[templateId]; if(!t||!t.blocks||!t.blocks.length) return;
    var src=(scope==='today')?prescriptionFor(t).blocks:Settings.effective(t,settings(),null).blocks;
    UI.editor={templateId:templateId,scope:scope,blocks:clone(src)};
    window.scrollTo(0,0); // the trigger button may have been below the fold — open at the top
    renderWorkoutEditor();
  }
  function editorTemplate(){
    var t=Data.templates[UI.editor.templateId], rt={};
    Object.keys(t).forEach(function(k){rt[k]=t[k];});
    rt.blocks=UI.editor.blocks.map(function(b){return Settings.resolvedBlock(b,t.type);});
    return rt;
  }
  function closeEditor(){ UI.editor=null; }
  function renderWorkoutEditor(){
    var ed=UI.editor, t=Data.templates[ed.templateId];
    var rt=editorTemplate();
    var range=Duration.calcDurationRange(rt);
    var durTxt=range?('About '+(range.minMin===range.maxMin?range.minMin:range.minMin+'–'+range.maxMin)+' min'):'—';
    var body=ed.blocks.map(function(b,bi){ return editorBlock(b,bi,ed.blocks.length); }).join('');
    var title=(ed.scope==='today')?'Edit Today’s Workout':'Edit Default';
    var html='<div class="wk-top"><div class="between"><button class="link" data-edcancel>&lsaquo; Cancel</button><b>'+esc(title)+'</b><span class="muted small">'+esc(t.name)+'</span></div></div>'+
      '<div class="ed-dur">Estimated duration: <b>'+esc(durTxt)+'</b></div>'+
      '<div class="ed-body">'+body+'</div>'+
      '<div class="ed-actions">'+
      (ed.scope==='today'?'<button class="btn primary" data-edsavetoday>Use for this workout only</button>':'')+
      '<button class="btn '+(ed.scope==='today'?'ghost':'primary')+'" data-edsavedefault>Save as new default</button>'+
      '<button class="btn ghost" data-edreset>Reset to default</button>'+
      '<button class="btn ghost" data-edcancel2>Cancel changes</button>'+
      '</div>';
    app.innerHTML=''; app.appendChild(h('<div class="scr wk-editor">'+html+'</div>'));
    wireEditor();
  }
  function editorField(label,attr,bi,val,wide){
    return '<label class="ed-field'+(wide?' wide':'')+'"><span class="ed-lbl">'+esc(label)+'</span>'+
      '<input class="ed-in" type="text" inputmode="'+(wide?'text':'numeric')+'" data-ed="'+attr+'" data-bi="'+bi+'" value="'+esc(val)+'"></label>';
  }
  function editorBlock(b,bi,count){
    var ex=Data.exercises[b.exId]||{};
    var alts=(ex.alternatives||[]).filter(function(a){return Data.exercises[a];});
    var head='<div class="ed-block-head"><span class="ed-block-nm">'+esc(b.label||ex.name||b.exId)+'</span>'+
      '<span class="ed-block-ctl">'+
      (alts.length?'<button class="link" data-edreplace="'+bi+'">Replace</button>':'')+
      (bi>0?'<button class="link" data-edup="'+bi+'">↑</button><button class="link" data-eddown="'+bi+'">↓</button><button class="link danger" data-edremove="'+bi+'">Remove</button>':'<span class="muted tiny">primary</span>')+
      '</span></div>';
    var fields='';
    if(b.scheme==='ladder'){
      fields=editorField('Ladder steps','steps',bi,Settings.stepsText(b.steps),true)+
        editorField('Rounds','rounds',bi,b.rounds)+
        editorField('Rest between steps','restStep',bi,fmt(b.restBetweenStepsSec))+
        editorField('Rest between rounds','restRound',bi,fmt(b.restBetweenRoundsSec))+
        editorField('Max target (optional)','maxTarget',bi,b.maxTarget==null?'':b.maxTarget)+
        adaptToggle(b,bi);
    } else if(b.scheme==='pyramid'){
      fields=editorField('Rep sequence','steps',bi,Settings.stepsText(b.steps),true)+
        editorField('Rounds','rounds',bi,b.rounds)+
        editorField('Rest between sets','rest',bi,fmt(b.restSecs))+
        adaptToggle(b,bi);
    } else if(b.scheme==='hold'){
      fields=editorField('Sets','sets',bi,b.sets)+
        editorField('Hold duration (sec)','seconds',bi,b.seconds)+
        editorField('Rest between sets','rest',bi,fmt(b.restSecs));
    } else if(b.scheme==='amrap'){
      fields='<p class="muted small">Single max-effort set — no numeric settings.</p>';
    } else {
      fields=editorField('Sets','sets',bi,b.sets)+
        editorField('Repetitions','reps',bi,b.reps)+
        editorField('Rest between sets','rest',bi,fmt(b.restSecs))+
        adaptToggle(b,bi);
    }
    return '<div class="ed-block" data-edblock="'+bi+'">'+head+'<div class="ed-fields">'+fields+'</div></div>';
  }
  function adaptToggle(b,bi){
    var on=b.adaptEnabled!==false;
    return '<div class="ed-field toggle-field"><span class="ed-lbl">Difficulty adaptation</span>'+
      '<button class="toggle '+(on?'on':'')+'" data-edadapt="'+bi+'" role="switch" aria-checked="'+on+'"><span class="knob"></span></button></div>';
  }
  function wireEditor(){
    var ed=UI.editor, t=Data.templates[ed.templateId];
    on('.ed-in','change',function(e){
      var bi=+e.currentTarget.dataset.bi, f=e.currentTarget.dataset.ed, val=e.currentTarget.value, b=ed.blocks[bi];
      if(f==='steps') b.steps=Settings.parseSteps(val);
      else if(f==='rounds') b.rounds=Math.max(1,parseInt(val,10)||1);
      else if(f==='reps') b.reps=Math.max(1,parseInt(val,10)||1);
      else if(f==='sets') b.sets=Math.max(1,parseInt(val,10)||1);
      else if(f==='seconds') b.seconds=Math.max(5,parseInt(val,10)||5);
      else if(f==='restStep') b.restBetweenStepsSec=Math.max(0,Settings.parseSecs(val));
      else if(f==='restRound') b.restBetweenRoundsSec=Math.max(0,Settings.parseSecs(val));
      else if(f==='rest') b.restSecs=Math.max(0,Settings.parseSecs(val));
      else if(f==='maxTarget') b.maxTarget=(val===''?null:Math.max(1,parseInt(val,10)||1));
      renderWorkoutEditor();
    });
    on('[data-edadapt]','click',function(e){var bi=+e.currentTarget.dataset.edadapt;ed.blocks[bi].adaptEnabled=!(ed.blocks[bi].adaptEnabled!==false);renderWorkoutEditor();});
    on('[data-edremove]','click',function(e){var bi=+e.currentTarget.dataset.edremove;if(ed.blocks.length>1){ed.blocks.splice(bi,1);renderWorkoutEditor();}});
    on('[data-edup]','click',function(e){var bi=+e.currentTarget.dataset.edup;if(bi>0){var t2=ed.blocks[bi-1];ed.blocks[bi-1]=ed.blocks[bi];ed.blocks[bi]=t2;renderWorkoutEditor();}});
    on('[data-eddown]','click',function(e){var bi=+e.currentTarget.dataset.eddown;if(bi<ed.blocks.length-1){var t2=ed.blocks[bi+1];ed.blocks[bi+1]=ed.blocks[bi];ed.blocks[bi]=t2;renderWorkoutEditor();}});
    on('[data-edreplace]','click',function(e){ editorReplace(+e.currentTarget.dataset.edreplace); });
    on('[data-edsavetoday]','click',function(){ todayEdits[ed.templateId]={blocks:clone(ed.blocks)}; closeEditor(); setScreen('today'); });
    on('[data-edsavedefault]','click',function(){
      var s=settings(), def=Settings.defaultsForTemplate(t), scope=ed.scope;
      if(JSON.stringify(ed.blocks.map(function(b){return Settings.resolvedBlock(b,t.type);}))===JSON.stringify(def.blocks)) delete s.workoutDefaults[ed.templateId];
      else s.workoutDefaults[ed.templateId]={blocks:clone(ed.blocks)};
      saveSettings(); delete todayEdits[ed.templateId]; closeEditor();
      if(scope==='today'){ setScreen('today'); } else { settingsView='workoutDefaults'; setScreen('profile'); }
    });
    on('[data-edreset]','click',function(){
      var base=(ed.scope==='today')?Settings.effective(t,settings(),null):Settings.defaultsForTemplate(t);
      ed.blocks=clone(base.blocks); renderWorkoutEditor();
    });
    on('[data-edcancel]','click',cancelEditor);
    on('[data-edcancel2]','click',cancelEditor);
  }
  function cancelEditor(){ var scope=UI.editor?UI.editor.scope:'today'; closeEditor(); if(scope==='today'){UI.editorFromToday=false;setScreen('today');} else {settingsView='workoutDefaults';setScreen('profile');} }
  function editorReplace(bi){
    var ed=UI.editor, b=ed.blocks[bi], ex=Data.exercises[b.exId]||{};
    var opts=(ex.alternatives||[]).filter(function(a){return Data.exercises[a];});
    if(!opts.length) return;
    var body='<div class="grip"></div><h2>Replace '+esc(ex.name||b.exId)+'</h2><p class="muted small">Approved alternatives keep the same purpose.</p>'+
      opts.map(function(a){var ae=Data.exercises[a];return '<button class="btn" data-pick="'+esc(a)+'">'+esc(ae.name)+'<div class="muted small" style="font-weight:400">'+esc(ae.purpose||'')+'</div></button>';}).join('')+
      '<button class="btn ghost" data-close>Cancel</button>';
    showSheet(body,function(sheet){
      on('[data-pick]','click',function(e){var a=e.currentTarget.dataset.pick;var ae=Data.exercises[a];b.exId=a;b.label=ae.name;closeSheet();renderWorkoutEditor();},sheet);
      on('[data-close]','click',closeSheet,sheet);
    });
  }
  function switchWorldProfile(worldId){UI.worldId=worldId;var p=Store.getProfile()||{};p.activeWorld=worldId;Store.setProfile(p);UI.readiness=null;renderProfile();}

  // ---- go -------------------------------------------------------------------
  // If the install prompt becomes available while the user is on the Data
  // settings screen, refresh it so the Install button appears.
  window.addEventListener('spc-installable',function(){ if(UI.screen==='profile'&&settingsView==='data') renderProfile(); });

  window.CoachApp={boot:boot,_UI:UI};
  boot();
})();
