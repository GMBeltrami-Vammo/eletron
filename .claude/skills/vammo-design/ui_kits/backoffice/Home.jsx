// BackOffice — Home view (KPIs + sparkline panels)

function StatCard({ label, value, sub, dir = 'up' }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
      padding: 16, boxShadow: 'var(--shadow-xs)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 13, color: 'var(--muted-foreground)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--primary-text)' }}>{value}</div>
      <div style={{ fontSize: 12, color: dir === 'up' ? '#16a34a' : '#DE4841', fontWeight: 500 }}>
        {dir === 'up' ? '↑' : '↓'} {sub}
      </div>
    </div>
  );
}

function HomeKpis() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
      <StatCard label="Active campaigns"   value="47"    sub="3 new this week" />
      <StatCard label="Codes redeemed"     value="2.341" sub="+18% vs. last week" />
      <StatCard label="Total expense (mo.)" value="R$ 84,2k" sub="+R$ 6,1k vs. last mo." />
      <StatCard label="Conversion rate"    value="32.4%" sub="-1.2pp" dir="down" />
    </div>
  );
}

function MiniBarChart() {
  const data = [42, 51, 60, 48, 63, 71, 88, 92, 78, 85, 96, 110, 102, 124];
  const max = Math.max(...data);
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
      padding: 16, boxShadow: 'var(--shadow-xs)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Redemptions · last 14 days</div>
          <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>Daily totals across all campaigns</div>
        </div>
        <span className="bo-badge green">+18%</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110 }}>
        {data.map((v, i) => (
          <div key={i} style={{
            flex: 1, height: (v/max*100)+'%',
            background: i === data.length - 1 ? 'var(--primary)' : 'rgba(24,24,27,0.5)',
            borderRadius: '3px 3px 0 0',
          }}></div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--muted-foreground)', fontFamily: 'ui-monospace, monospace' }}>
        <span>4 nov</span><span>11 nov</span><span>18 nov</span>
      </div>
    </div>
  );
}

function RecentActivity() {
  const items = [
    { who: 'Bruno R.', what: 'redeemed', target: 'INVERNO20 · Inverno SP', when: '2m ago', variant: 'green' },
    { who: 'Camila S.', what: 'redeemed', target: 'INDICA10 · Indica um amigo', when: '5m ago', variant: 'green' },
    { who: 'System', what: 'paused', target: 'Lapa · 1ª semana (limit reached)', when: '12m ago', variant: 'orange' },
    { who: 'Ana C.', what: 'created campaign', target: 'Cashback · Pro anual', when: '1h ago', variant: 'blue' },
    { who: 'Lucas T.', what: 'rejected', target: 'Black Friday 2024 (renewal)', when: '2h ago', variant: 'red' },
  ];
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-xs)' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Recent activity</div>
      </div>
      <div>
        {items.map((it, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: i < items.length-1 ? '1px solid var(--border)' : 'none' }}>
            <span className={'bo-badge ' + it.variant}>{it.what}</span>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
              <strong>{it.who}</strong> · {it.target}
            </div>
            <span style={{ fontSize: 12, color: 'var(--muted-foreground)', fontFamily: 'ui-monospace, monospace' }}>{it.when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { HomeKpis, MiniBarChart, RecentActivity });
