// BackOffice — PageHeader (mirrors coupons-dashboard PageHeader)

function PageHeader({ title, actions }) {
  return (
    <div className="bo-page-head">
      <h1>{title}</h1>
      <div style={{ display: 'flex', gap: 8 }}>
        {actions && actions.map((a, i) => (
          <button key={i} className={'bo-btn ' + (a.variant === 'outline' ? 'bo-btn-outline' : 'bo-btn-default')} onClick={a.onClick}>
            {a.icon && <Icon name={a.icon} />}
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { PageHeader });
