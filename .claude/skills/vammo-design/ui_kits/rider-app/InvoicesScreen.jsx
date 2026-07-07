// InvoicesScreen — Faturas with 4 statuses (Paid / Open / Overdue / Closed)
// Mirrors the Figma "Faturas" flow. State `status` controls which is currently shown.

function InvoicesScreen({ onNav, status = 'open', onLineClick }) {
  // Tab dates: 09/08, 16/08, 23/08
  const tabs = [
    { key: 'paid',    label: '09/08' },
    { key: 'overdue', label: '16/08' },  // Overdue lives on the same date row as Closed
    { key: 'closed',  label: '16/08' },
    { key: 'open',    label: '23/08' },
  ];
  // De-dupe for display (only show 3 dates max)
  const displayTabs = [
    { key: 'paid',    label: '09/08' },
    { key: 'closed',  label: '16/08' },
    { key: 'open',    label: '23/08' },
  ];
  // Map status into the active tab
  const activeTab = status === 'paid' ? 'paid' : (status === 'open' ? 'open' : 'closed');

  const config = {
    paid:    { amount: 'R$ 425,86', pill: 'Fatura paga',    sub: 'Paga em 09/08' },
    open:    { amount: 'R$ 500,86', pill: 'Fatura aberta',  sub: 'Vencimento 23/08' },
    overdue: { amount: 'R$ 500,86', pill: 'Fatura vencida', sub: 'Vencimento 16/08' },
    closed:  { amount: 'R$ 678,28', pill: 'Fatura fechada', sub: 'Vencimento 16/08' },
  }[status];

  // Line items per status (matching the Figma)
  const lines = {
    paid: [
      { icon: 'bike', t1: 'Semanal · VMOTO CPX', amt: 'R$ 379,00', sub: 'À vista' },
    ],
    open: [
      { icon: 'bike',   t1: 'Semanal · VMOTO CPX',          amt: 'R$ 379,00', sub: 'À vista' },
      { icon: 'wrench', t1: 'Manutenção corretiva · OS...', amt: 'R$ 75,00',  sub: 'Parcela 2/2' },
      { icon: 'file-text', t1: 'Multa de trânsito · AIT 1QA1...', amt: 'R$ 234,28', sub: 'À vista' },
    ],
    overdue: [
      { icon: 'bike',   t1: 'Semanal · VMOTO CPX',          amt: 'R$ 379,00', sub: 'À vista' },
      { icon: 'wrench', t1: 'Manutenção corretiva · OS...', amt: 'R$ 75,00',  sub: 'Parcela 1/2' },
    ],
    closed: [
      { icon: 'bike',   t1: 'Semanal · VMOTO CPX',          amt: 'R$ 309,00', sub: 'À vista', click: 'maintenance' },
      { icon: 'plus-circle', t1: 'Variável · 601 a 900 km', amt: 'R$ 120,00', sub: 'À vista', accessTag: true },
      { icon: 'wrench', t1: 'Manutenção corretiva · OS...', amt: 'R$ 75,00',  sub: 'Parcela 1/2', click: 'maintenance' },
      { icon: 'file-text', t1: 'Multa de trânsito · AIT HVB...', amt: 'R$ 234,28', sub: 'À vista' },
    ],
  }[status];

  return (
    <div className="ra ra-with-navbar">
      <NavBar title="Faturas" onBack={() => onNav && onNav('profile')} />
      <div className="ra-scroll">
        <div className="ra-date-tabs">
          {displayTabs.map(t => (
            <div key={t.key} className={'ra-date-tab' + (t.key === activeTab ? ' active' : '')}>{t.label}</div>
          ))}
        </div>

        <div style={{ padding: '0 16px 14px' }}>
          <div className={'ra-fatura ' + status}>
            <div className="amount">{config.amount}</div>
            <div className="pill">{config.pill}</div>
            <div className="sub">{config.sub}</div>
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 16, margin: '0 16px 14px' }}>
          {lines.map((l, i) => (
            <div key={i} className="ra-line" onClick={() => l.click && onLineClick && onLineClick(l.click)}>
              <div className="ico"><Icon name={l.icon} /></div>
              <div>
                <div className="t1">{l.t1}</div>
                {l.accessTag && <span className="access-pill">Acesse e veja detalhes</span>}
              </div>
              <div className="amt">
                <div className="v">{l.amt}</div>
                <div className="ts">{l.sub}</div>
              </div>
              <div className="chev"><Icon name="chevron-right" /></div>
            </div>
          ))}
        </div>

        {(status === 'overdue' || status === 'closed') && (
          <div style={{ padding: '4px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button className="ra-btn-primary">Pagar{status === 'closed' ? ' R$ 678,28' : ''}</button>
            <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, color: 'var(--ra-ink)', textDecoration: 'underline', textUnderlineOffset: 4 }}>Adiar fatura</div>
          </div>
        )}
      </div>
      <TabBar active="profile" onSelect={onNav} />
    </div>
  );
}

Object.assign(window, { InvoicesScreen });
