// BackOffice — Sidebar (matches coupons-dashboard NavBar via vammo-ui)

function Icon({ name }) { return <i data-lucide={name}></i>; }

function Sidebar({ active, onSelect }) {
  const items = [
    { id: 'home',                label: 'Home',                icon: 'home' },
    { id: 'campaign-management', label: 'Campaign management', icon: 'settings-2' },
    { id: 'campaign-builder',    label: 'Campaign builder',    icon: 'footprints' },
    { id: 'manage-codes',        label: 'Manage codes',        icon: 'code' },
    { id: 'detailed-usage',      label: 'Detailed usage',      icon: 'bar-chart-3' },
  ];
  return (
    <div className="bo-side">
      <div className="logo">
        <div className="ico"><Icon name="settings-2" /></div>
        <div>
          <div className="name">Coupons</div>
          <div className="sub">Vammo · Pro plan</div>
        </div>
      </div>
      <div className="nav">
        {items.map(i => (
          <div key={i.id}
               className={'nav-item' + (active === i.id ? ' active' : '')}
               onClick={() => onSelect && onSelect(i.id)}>
            <Icon name={i.icon} /><span>{i.label}</span>
          </div>
        ))}
      </div>
      <div className="user">
        <div className="avatar">AC</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name">Ana Castro</div>
          <div className="email">ana@vammo.com.br</div>
        </div>
        <div className="bo-row-action"><Icon name="chevron-up" /></div>
      </div>
    </div>
  );
}

Object.assign(window, { Icon, Sidebar });
