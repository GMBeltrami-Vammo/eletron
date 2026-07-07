// ChargeDetailScreen — single maintenance OS breakdown (matches "Manutenção - OS 12185" Figma)

function ChargeDetailScreen({ onNav }) {
  return (
    <div className="ra ra-with-navbar">
      <NavBar title="Detalhes da cobrança" onBack={() => onNav && onNav('invoices')} />
      <div className="ra-scroll" style={{ paddingTop: 110 }}>
        <div style={{ textAlign: 'center', padding: '0 16px 8px' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#F2F2F2', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <Icon name="wrench" />
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>Manutenção · OS 12185</div>
          <div style={{ fontSize: 13, color: 'var(--ra-ink-2)', marginTop: 4 }}>16/08/2024</div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 14 }}>R$ 55,00</div>
          <div style={{ fontSize: 12, color: 'var(--ra-ink-2)', marginTop: 2 }}>À vista</div>
        </div>

        <div style={{ background: '#fff', borderRadius: 14, margin: '14px 16px 12px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--ra-divider)' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Valor total</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>R$ 55,00 <Icon name="chevron-up" /></span>
          </div>
          <div style={{ padding: '4px 16px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontSize: 13 }}>
              <span style={{ color: 'var(--ra-ink-2)' }}>Manete de freio traseiro</span><span>R$ 30,00</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
              <span style={{ color: 'var(--ra-ink-2)' }}>Manete de freio dianteiro</span><span>R$ 25,00</span>
            </div>
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 14, margin: '0 16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--ra-divider)', fontSize: 14 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="dollar-sign" /> Pagamento</span>
            <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>1x de R$ 55,00 <Icon name="chevron-up" /></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', fontSize: 14 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="calendar" /> Vencimento</span>
            <span style={{ fontWeight: 600 }}>16/08/2024</span>
          </div>
        </div>

        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="ra-btn-primary">Parcelar cobrança</button>
          <button className="ra-btn-outline" style={{ margin: 0 }}>
            <Icon name="file-text" />
            Acessar laudo
          </button>
        </div>
      </div>
      <TabBar active="profile" onSelect={onNav} />
    </div>
  );
}

Object.assign(window, { ChargeDetailScreen });
