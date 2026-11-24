(function(){
'use strict';
var BLUE='#2563eb',RED='#dc2626',AMBER='#d97706',GREY='#64748b';
var D=null,charts={};
var $=function(id){return document.getElementById(id)};
function f1(x){return Number(x).toFixed(1)}
function ms(x){return f1(x)+' ms'}
function pct(x,d){return (x*100).toFixed(d==null?1:d)+'%'}
function sg(x,d){var v=Number(x).toFixed(d==null?1:d);return (x>0?'+':'')+v}
function fmtP(p){if(p===0||p<1e-300)return 'below 1e-300 (effectively zero)';if(p<0.001)return p.toExponential(1);return p.toFixed(4)}
function nf(x){return Number(x).toLocaleString('en-US')}
function el(tag,cls,html){var e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e}
function table(id,head,rows){
  var h='<thead><tr>'+head.map(function(c){return '<th scope="col">'+c+'</th>'}).join('')+'</tr></thead><tbody>';
  rows.forEach(function(r){h+='<tr>'+r.map(function(c){
    if(c&&typeof c==='object')return '<td class="'+(c.cls||'')+'">'+c.t+'</td>';return '<td>'+c+'</td>'}).join('')+'</tr>'});
  $(id).innerHTML=h+'</tbody>';
}
function mk(id,cfg){if(charts[id])charts[id].destroy();charts[id]=new Chart($(id),cfg);return charts[id]}
function clock(m){var d=Math.floor(m/1440)+1,h=Math.floor(m%1440/60);return 'Day '+d+' '+(h<10?'0':'')+h+':00'}
function epName(p){return p==='ALL'?'All endpoints':p}
function eps(){return Object.keys(D.describe).filter(function(k){return k!=='ALL'}).sort()}

Chart.defaults.font.family='system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
Chart.defaults.color='#334155';

/* ---------- hero ---------- */
function hero(){
  var m=D.meta,a=D.describe.ALL,det=D.detection;
  var cards=[
    [nf(m.requests),'Requests analysed',m.days+' days, '+m.endpoints+' endpoints',''],
    [det.detected+' / '+det.total,'Incidents found','each caught within '+Math.max.apply(null,det.truth.map(function(t){return t.delay_min}))+' minutes',''],
    [String(det.main_rule_false_alerts_on_clean),'False alarms on clean data','over '+det.clean_days+' clean days ('+nf(det.clean_windows)+' windows)',''],
    [f1(a.p99_over_mean)+'x','p99 vs mean ratio','p99 '+ms(a.p99)+' vs mean '+ms(a.mean),'bad']
  ];
  $('statCards').innerHTML=cards.map(function(c){return '<div class="card"><div class="v '+c[3]+'">'+c[0]+'</div><div class="l">'+c[1]+'</div><div class="s">'+c[2]+'</div></div>'}).join('');
}

/* ---------- timeline ---------- */
var shadePlugin={id:'shade',beforeDatasetsDraw:function(ch){
  var x=ch.scales.x,a=ch.chartArea,c=ch.ctx;
  D.series.incidents.forEach(function(i){
    var x0=x.getPixelForValue(i.start_min),x1=Math.max(x.getPixelForValue(i.end_min),x0+3);
    c.save();c.fillStyle='rgba(220,38,38,.16)';c.fillRect(x0,a.top,x1-x0,a.bottom-a.top);
    c.fillStyle='#991b1b';c.font='600 11px system-ui';c.textAlign='center';
    c.fillText(i.name,Math.min(Math.max(x0+(x1-x0)/2,a.left+60),a.right-60),a.top+12);c.restore();
  });
}};
function timeline(){
  var s=D.series.minute,mk_=function(k,col){return {label:k==='mean'?'Mean':k,data:s[k].map(function(v,i){return {x:i,y:v}}),borderColor:col,backgroundColor:col,borderWidth:1.4,pointRadius:0,hidden:false,_k:k}};
  var ds=[mk_('mean',BLUE),mk_('p95',AMBER),mk_('p99',RED)];
  mk('timeline',{type:'line',data:{datasets:ds},plugins:[shadePlugin],options:{
    responsive:true,maintainAspectRatio:false,animation:false,parsing:false,normalized:true,
    interaction:{mode:'nearest',axis:'x',intersect:false},
    scales:{x:{type:'linear',min:0,max:2880,title:{display:true,text:'Time (48 hours)'},ticks:{stepSize:360,callback:function(v){return clock(v)}}},
      y:{type:'linear',title:{display:true,text:'Latency per minute (ms)'},beginAtZero:true}},
    plugins:{legend:{display:false},tooltip:{callbacks:{title:function(i){var m=i[0].parsed.x;return clock(Math.floor(m/60)*60).replace(':00','')+' '+('0'+Math.floor(m%1440/60)).slice(-2)+':'+('0'+Math.floor(m%60)).slice(-2)},label:function(c){return c.dataset.label+': '+f1(c.parsed.y)+' ms'}}}}}});
  document.querySelectorAll('[data-s]').forEach(function(cb){cb.addEventListener('change',function(){
    var d=charts.timeline.data.datasets.filter(function(x){return x._k===cb.dataset.s})[0];d.hidden=!cb.checked;charts.timeline.update()})});
  $('logY').addEventListener('change',function(){
    var y=charts.timeline.options.scales.y;y.type=this.checked?'logarithmic':'linear';y.beginAtZero=!this.checked;
    charts.timeline.update()});
}
function sameMean(){
  table('sameMean',['Spread (sigma)','Mean','Median','p95','p99'],D.theory_vs_experiment.mean_hides_p99.same_mean_table.map(function(r){
    return [r.sigma.toFixed(1),ms(r.mean),ms(r.median),ms(r.p95),{t:ms(r.p99),cls:r.p99>300?'bad':''}]}));
}
function hides(){
  var h=D.theory_vs_experiment.mean_hides_p99,A=h.incident_all_traffic,B=h.one_percent_tail;
  mk('hidesChart',{type:'bar',data:{labels:['Median','Mean','p99'],datasets:[
    {label:'Incident vs baseline (all traffic)',data:[A.median_change_pct,A.mean_change_pct,A.p99_change_pct],backgroundColor:RED},
    {label:'Only 1% of requests slowed',data:[B.median_change_pct,B.mean_change_pct,B.p99_change_pct],backgroundColor:BLUE}]},
    options:{responsive:true,maintainAspectRatio:false,scales:{y:{title:{display:true,text:'Change (%)'}}},
      plugins:{tooltip:{callbacks:{label:function(c){return c.dataset.label+': '+sg(c.parsed.y)+'%'}}}}}});
  $('hidesNote').innerHTML='During the incidents the all-traffic median moved '+sg(A.median_change_pct)+'%, the mean '+sg(A.mean_change_pct)+'%, but p99 '+sg(A.p99_change_pct)+'% ('+ms(A.p99_base)+' to '+ms(A.p99_inc)+'). When only 1% of requests were slowed, the mean moved '+sg(B.mean_change_pct)+'% while p99 moved '+sg(B.p99_change_pct)+'%.';
}

/* ---------- explorer ---------- */
function lnpdf(x,mu,s){return Math.exp(-Math.pow(Math.log(x)-mu,2)/(2*s*s))/(x*s*Math.sqrt(2*Math.PI))}
function explorer(){
  var sel=$('epSel');
  ['ALL'].concat(eps()).forEach(function(p){var o=el('option',null,epName(p));o.value=p;sel.appendChild(o)});
  sel.addEventListener('change',function(){showEp(sel.value)});
  showEp('ALL');
  var rows=eps().map(function(p){var f=D.fits[p],dAic=f.aic_exponential-f.aic_lognormal;
    return [p,f.mu.toFixed(3),f.sigma.toFixed(3),nf(Math.round(f.aic_lognormal)),nf(Math.round(f.aic_exponential)),{t:nf(Math.round(dAic)),cls:'good'},f.ks_lognormal.toFixed(3),{t:f.ks_exponential.toFixed(3),cls:'bad'},'Lognormal']});
  table('aicTable',['Endpoint','mu','sigma','AIC lognormal','AIC exponential','AIC gap','KS lognormal','KS exponential','Better fit'],rows);
}
function showEp(p){
  var d=D.describe[p],m=[['Mean',ms(d.mean)],['Median',ms(d.median)],['p95',ms(d.p95)],['p99',ms(d.p99),1],['Skew',d.skew.toFixed(2)],['Error rate',pct(d.error_rate,2)],['p99 / mean',f1(d.p99_over_mean)+'x',1],['Requests',nf(d.n)]];
  $('metrics').innerHTML=m.map(function(x){return '<div class="m"><b class="'+(x[2]?'bad':'')+'">'+x[1]+'</b><span>'+x[0]+'</span></div>'}).join('');
  if(p==='ALL'){
    var h=D.series.hist,lab=h.edges.map(function(e,i){return e+(i===h.edges.length-1?'+':'')});
    mk('histChart',{type:'bar',data:{labels:lab,datasets:[{label:'Requests',data:h.counts,backgroundColor:BLUE,barPercentage:1,categoryPercentage:1}]},
      options:{responsive:true,maintainAspectRatio:false,scales:{x:{title:{display:true,text:'Latency (ms)'},ticks:{maxTicksLimit:10}},y:{title:{display:true,text:'Number of requests'}}},plugins:{legend:{display:false}}}});
    $('histCap').textContent='All endpoints mixed together (25 ms bins; last bin holds everything slower). The long right tail is why the mean ('+ms(d.mean)+') sits well above the median ('+ms(d.median)+').';
    table('pctTable',['Percentile','Value'],[['Median (p50)',ms(d.p50)],['p95',ms(d.p95)],['p99',ms(d.p99)],['p99.9',ms(d.p999)],['Slower than the mean',pct(d.pct_slower_than_mean,0)+' of requests']]);
    $('fitCap').textContent='Mixing different endpoints makes a lumpy shape, so no single lognormal curve is drawn here. Pick one endpoint to see its fitted curve.';
  }else{
    var f=D.fits[p],xs=[],ys=[];for(var x=1;x<=1000;x+=5){xs.push(x);ys.push(100*lnpdf(x,f.mu,f.sigma))}
    var pt=function(v){return {x:v,y:100*lnpdf(v,f.mu,f.sigma)}};
    mk('histChart',{type:'line',data:{datasets:[
      {label:'Lognormal fit',data:xs.map(function(x,i){return {x:x,y:ys[i]}}),borderColor:BLUE,backgroundColor:'rgba(37,99,235,.12)',fill:true,pointRadius:0,borderWidth:2},
      {label:'Empirical p50/p95/p99',type:'scatter',data:[pt(f.empirical.p50),pt(f.empirical.p95),pt(f.empirical.p99)],backgroundColor:RED,pointRadius:6,pointStyle:'rectRot'}]},
      options:{responsive:true,maintainAspectRatio:false,parsing:false,scales:{x:{type:'linear',min:0,max:1000,title:{display:true,text:'Latency (ms)'}},y:{title:{display:true,text:'Share of requests per ms (%)'},beginAtZero:true}}}});
    $('histCap').textContent='Blue curve: the lognormal model fitted to '+nf(f.n)+' requests (mu '+f.mu.toFixed(2)+', sigma '+f.sigma.toFixed(2)+'). Red diamonds: the real median, p95 and p99. Values beyond 1000 ms are off the right edge.';
    var e=f.empirical,t=f.theoretical;
    table('pctTable',['Percentile','Empirical','Theoretical','Gap'],['p50','p95','p99'].map(function(k){return [k,ms(e[k]),ms(t[k]),sg((t[k]-e[k])/e[k]*100)+'%']}));
    $('fitCap').textContent='"Empirical" is measured from the logs; "Theoretical" is what the fitted curve predicts. Small gaps mean the model describes the endpoint well.';
  }
}

/* ---------- detector ---------- */
var truthByPath={};
function overlaps(w,inc){var s=w*5,e=s+5;return s<inc.end_min&&e>inc.start_min}
function relevant(inc,path){return inc.endpoint==='ALL'||inc.endpoint===path}
function flagOf(w,thr){var errFlag=w.flag&&w.z<D.meta.z_threshold;return w.z>=thr||errFlag}
function detector(){
  var byPath={};D.series.windows.forEach(function(w){(byPath[w.path]=byPath[w.path]||[]).push(w)});
  D.byPath=byPath;
  var host=$('strips');
  Object.keys(byPath).sort().forEach(function(p){
    var l=el('div','lab',p);l.title=p;var c=document.createElement('canvas');c.id='strip-'+p;c.setAttribute('role','img');c.setAttribute('aria-label','Heat strip for '+p);
    host.appendChild(l);host.appendChild(c);
  });
  $('zSlider').addEventListener('input',function(){updateDet(parseFloat(this.value))});
  window.addEventListener('resize',function(){updateDet(parseFloat($('zSlider').value))});
  updateDet(parseFloat($('zSlider').value));
  tests();
}
function updateDet(thr){
  $('zOut').textContent=thr.toFixed(1);
  document.querySelectorAll('.zused').forEach(function(e){e.textContent=thr.toFixed(1)});
  var total=0,inInc=0,out=0,first={};
  Object.keys(D.byPath).forEach(function(p){
    var c=$('strip-'+p),dpr=window.devicePixelRatio||1,W=c.clientWidth||600,H=22;
    c.width=Math.round(W*dpr);c.height=H*dpr;var g=c.getContext('2d');g.scale(dpr,dpr);
    var cw=W/576;
    D.byPath[p].forEach(function(w){
      var fl=flagOf(w,thr),tr=D.series.incidents.some(function(i){return relevant(i,p)&&overlaps(w.win,i)});
      if(fl){total++;tr?inInc++:out++}
      g.fillStyle=fl?RED:(tr?'#bfdbfe':'#e2e8f0');g.fillRect(w.win*cw,0,Math.ceil(cw),H);
      if(tr){g.fillStyle='#60a5fa';g.fillRect(w.win*cw,0,Math.ceil(cw),2);g.fillRect(w.win*cw,H-2,Math.ceil(cw),2)}
      if(fl)D.series.incidents.forEach(function(i,k){if(relevant(i,p)&&overlaps(w.win,i)){var key=k+'|'+p;var d=(w.win+1)*5-i.start_min;if(first[key]==null||d<first[key])first[key]=d}});
    });
  });
  var det=0,rows=[];
  D.series.incidents.forEach(function(i,k){
    var flagged=Object.keys(D.byPath).filter(function(p){return first[k+'|'+p]!=null}).sort();
    var ok=flagged.length>0,delay=ok?Math.min.apply(null,flagged.map(function(p){return first[k+'|'+p]})):null;
    if(ok)det++;
    rows.push([i.name,i.endpoint,i.start_min+'-'+i.end_min,{t:ok?'Yes':'MISSED',cls:ok?'good':'bad'},ok?delay.toFixed(0)+' min':'-',flagged.length?(flagged.length===6?'all 6 endpoints':flagged.join(', ')):'none']);
  });
  table('truthTable',['Incident','Endpoint','Minutes','Detected','Delay','Endpoints flagged'],rows);
  var s=[[total,'Windows flagged'],[inInc,'Flagged inside a real incident'],[out,'Flagged outside incidents (false alarms)',out>0],[det+' / '+D.series.incidents.length,'Incidents detected',det<D.series.incidents.length]];
  $('detStats').innerHTML=s.map(function(x){return '<div class="m"><b class="'+(x[2]?'bad':'')+'">'+x[0]+'</b><span>'+x[1]+'</span></div>'}).join('');
}
function tests(){
  var e=D.tests.search_error_rate,l=D.tests.checkout_latency;
  $('errTest').innerHTML='<dl class="kv"><dt>Normal error rate</dt><dd>'+pct(e.rate_base,2)+' ('+nf(e.n_base)+' requests)</dd><dt>During incident</dt><dd>'+pct(e.rate_incident,1)+' ('+nf(e.n_incident)+' requests)</dd><dt>Difference</dt><dd>+'+pct(e.diff,1)+' (95% CI '+pct(e.diff_ci95[0],1)+' to '+pct(e.diff_ci95[1],1)+')</dd><dt>z statistic</dt><dd>'+f1(e.z)+'</dd><dt>p-value</dt><dd>'+fmtP(e.p_value)+'</dd></dl>'+
   '<p class="verdict"><strong>In plain English:</strong> Errors went from about 1 in '+Math.round(1/e.rate_base)+' requests to about 1 in '+Math.round(1/e.rate_incident)+'. The p-value is the chance of seeing a jump this big if nothing had changed; it is essentially zero, so this was not luck. Method: '+e.method.toLowerCase()+'.</p>';
  $('latTest').innerHTML='<dl class="kv"><dt>Normal median</dt><dd>'+ms(l.median_base)+' ('+l.n_base+' requests)</dd><dt>Incident median</dt><dd>'+ms(l.median_incident)+' ('+l.n_incident+' requests)</dd><dt>Ratio</dt><dd>'+f1(l.median_ratio)+'x (95% CI '+f1(l.median_ratio_ci95[0])+' to '+f1(l.median_ratio_ci95[1])+')</dd><dt>Mann-Whitney p</dt><dd>'+fmtP(l.mannwhitney_p)+'</dd><dt>Chance incident request is slower</dt><dd>'+pct(l.prob_incident_slower,1)+'</dd><dt>Welch t on log-latency</dt><dd>'+f1(l.welch_t_on_log)+' (p '+fmtP(l.welch_p)+')</dd></dl>'+
   '<p class="verdict"><strong>In plain English:</strong> If you pick one request from the incident and one from normal time, the incident one is slower about '+pct(l.prob_incident_slower,0)+' of the time. '+l.why+'</p>';
}

/* ---------- theory ---------- */
function theory(){
  var fa=D.theory_vs_experiment.false_alarm_sweep;
  mk('faChart',{type:'line',data:{labels:fa.map(function(r){return r.z.toFixed(1)}),datasets:[
    {label:'Theory (normal curve)',data:fa.map(function(r){return r.theory_rate*100}),borderColor:BLUE,backgroundColor:BLUE,tension:.2},
    {label:'Measured on clean data',data:fa.map(function(r){return r.measured_rate*100}),borderColor:RED,backgroundColor:RED,tension:.2}]},
    options:{responsive:true,maintainAspectRatio:false,scales:{x:{title:{display:true,text:'z-threshold'}},y:{type:'logarithmic',title:{display:true,text:'False alarm rate per window (%, log scale)'}}},
      plugins:{tooltip:{callbacks:{label:function(c){return c.dataset.label+': '+c.parsed.y.toPrecision(2)+'%'}}}}}});
  table('faTable',['z','Theory','Measured','Alarms (measured / expected)','False alarms per day','Detection power'],fa.map(function(r){
    return [r.z.toFixed(1),pct(r.theory_rate,3),pct(r.measured_rate,3),r.measured_count+' / '+Math.round(r.expected_count),f1(r.false_alarms_per_day),pct(r.power,0)]}));
  var ev=D.theory_vs_experiment.exact_vs_streaming,rows=[],worst=0;
  ['ALL'].concat(eps()).forEach(function(p){var r=ev[p],a=function(v){return Math.abs(v)};
    var cell=function(v){return {t:sg(v,2)+'%',cls:a(v)>5?'bad':''}};
    rows.push([epName(p),nf(r.n),ms(r.p99.exact),cell(r.p50.p2_err_pct),cell(r.p95.p2_err_pct),cell(r.p99.p2_err_pct),cell(r.p50.sketch_err_pct),cell(r.p95.sketch_err_pct),cell(r.p99.sketch_err_pct),r.sketch_buckets]);
    worst=Math.max(worst,a(r.p95.p2_err_pct),a(r.p99.p2_err_pct))});
  table('streamTable',['Endpoint','Requests','Exact p99','P2 p50 err','P2 p95 err','P2 p99 err','Sketch p50 err','Sketch p95 err','Sketch p99 err','Sketch buckets'],rows);
  var mx=0;rows.forEach(function(r){});Object.keys(ev).forEach(function(p){['p50','p95','p99'].forEach(function(k){mx=Math.max(mx,Math.abs(ev[p][k].sketch_err_pct))})});
  $('streamCap').textContent='The log-bucket sketch stayed within '+mx.toFixed(2)+'% of the exact value everywhere. P2 is very accurate in the middle but can drift in the tail on spiky data (worst case '+worst.toFixed(1)+'%, in red). Errors above 5% are highlighted.';
  table('lnTable',['Endpoint','p50 real','p50 model','p95 real','p95 model','p99 real','p99 model','p99 error'],eps().map(function(p){var f=D.fits[p],e=f.empirical,t=f.theoretical;
    return [p,ms(e.p50),ms(t.p50),ms(e.p95),ms(t.p95),ms(e.p99),ms(t.p99),sg(f.p99_rel_error*100,2)+'%']}));
}

function quality(){
  table('dqTable',['Check','Rows affected','Action taken'],D.data_quality.map(function(r){return [r.issue,nf(r.rows),r.action]}));
}

function run(){
  hero();timeline();sameMean();hides();explorer();detector();theory();quality();
}
fetch('data/results.json').then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(j){D=j;run()}).catch(function(e){
  var n=$('loadError');n.hidden=false;n.textContent='Could not load data/results.json ('+e.message+'). If you opened this file directly, serve the folder over HTTP (for example: python3 -m http.server).';
  $('statCards').innerHTML='';
});
})();
