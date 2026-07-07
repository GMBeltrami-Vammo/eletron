// BackOffice — Table (mirrors coupons-dashboard ControlRoom: GlobalSearcher + Table + Pagination)

function TableControls() {
  return (
    <div className="bo-controls">
      <label className="bo-search">
        <Icon name="search" />
        <input placeholder="Search campaigns…" defaultValue="" />
      </label>
      <div className="right">
        <button className="bo-btn bo-btn-outline bo-btn-sm"><Icon name="columns-3" />Columns</button>
        <button className="bo-btn bo-btn-outline bo-btn-sm"><Icon name="sliders-horizontal" />Configs</button>
        <button className="bo-btn bo-btn-outline bo-btn-sm"><Icon name="refresh-cw" />Refresh</button>
      </div>
    </div>
  );
}

function CampaignsTable() {
  const rows = [
    { id: 14211, name: 'Inverno SP · Bairros Periféricos', type: 'COUPON',    status: 'ACTIVE',    used: 1240, limit: 2000, expense: 'R$ 17.420', end: '30/jun/2025' },
    { id: 14209, name: 'Indica um amigo · Maio',           type: 'PROMOTION', status: 'ACTIVE',    used: 320,  limit: 1000, expense: 'R$ 5.840',  end: '15/jun/2025' },
    { id: 14198, name: 'Onboarding · Nova Frota',          type: 'COUPON',    status: 'PAUSED',    used: 88,   limit: 500,  expense: 'R$ 1.220',  end: '01/jul/2025' },
    { id: 14182, name: 'Reativação · Pilotos Inativos',    type: 'COUPON',    status: 'DRAFT',     used: 0,    limit: 0,    expense: 'R$ 0',      end: '—' },
    { id: 14176, name: 'Black Friday 2024',                type: 'COUPON',    status: 'EXPIRED',   used: 4823, limit: 5000, expense: 'R$ 68.140', end: '01/dez/2024' },
    { id: 14155, name: 'Lapa · 1ª semana',                 type: 'COUPON',    status: 'ACTIVE',    used: 612,  limit: 800,  expense: 'R$ 8.420',  end: '20/jun/2025' },
    { id: 14140, name: 'Entregadores · iFood',             type: 'PROMOTION', status: 'ACTIVE',    used: 1840, limit: 3000, expense: 'R$ 24.110', end: '31/dez/2025' },
    { id: 14111, name: 'Cashback · Pro anual',             type: 'COUPON',    status: 'REJECTED',  used: 0,    limit: 0,    expense: 'R$ 0',      end: '—' },
  ];
  const statusBadge = {
    ACTIVE:   ['green',  'Active'],
    PAUSED:   ['orange', 'Paused'],
    DRAFT:    ['grey',   'Draft'],
    EXPIRED:  ['dark-green', 'Expired'],
    REJECTED: ['red',    'Rejected'],
  };
  return (
    <div className="bo-table-card">
      <table className="bo-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Campaign</th>
            <th>Type</th>
            <th>Status</th>
            <th>Used / Limit</th>
            <th>Expense</th>
            <th>End</th>
            <th style={{ width: 60 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const [variant, label] = statusBadge[r.status];
            const usagePct = r.limit ? Math.min(100, Math.round(r.used / r.limit * 100)) : 0;
            return (
              <tr key={r.id}>
                <td className="bo-mono" style={{ color: 'var(--muted-foreground)' }}>#{r.id}</td>
                <td style={{ fontWeight: 600 }}>{r.name}</td>
                <td>
                  <span className={'bo-badge ' + (r.type === 'COUPON' ? 'blue' : 'yellow')}>{r.type}</span>
                </td>
                <td><span className={'bo-badge ' + variant}>{label}</span></td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="bo-mono" style={{ fontSize: 12 }}>{r.used.toLocaleString('pt-BR')}/{r.limit.toLocaleString('pt-BR')}</span>
                    <div style={{ width: 70, height: 4, background: 'var(--muted)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: usagePct + '%', height: '100%', background: usagePct >= 90 ? 'var(--destructive)' : 'var(--primary)' }}></div>
                    </div>
                  </div>
                </td>
                <td className="bo-mono">{r.expense}</td>
                <td className="bo-mono" style={{ color: 'var(--muted-foreground)' }}>{r.end}</td>
                <td><div className="bo-row-action"><Icon name="more-horizontal" /></div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="bo-pagination">
        <div>Showing 1–8 of 47 campaigns</div>
        <div className="pages">
          <div className="pg"><Icon name="chevron-left" /></div>
          <div className="pg active">1</div>
          <div className="pg">2</div>
          <div className="pg">3</div>
          <div className="pg">4</div>
          <div className="pg">5</div>
          <div className="pg"><Icon name="chevron-right" /></div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TableControls, CampaignsTable });
