// ReservationScreen — "Confirmação da reserva" with green check, plan/date card,
// and bottom-sheets for altering (Reagendar / Cancelar) + cancel-reason feedback.

function ReservationScreen({ onNav }) {
  const [sheet, setSheet] = React.useState(null); // null | 'alter' | 'confirmCancel' | 'feedback'
  const [reason, setReason] = React.useState(null);

  return (
    <div className="ra ra-with-navbar">
      <NavBar title="Confirmação da reserva" onBack={() => onNav && onNav('home')} />

      <div className="ra-scroll">
        {/* Green check */}
        <div style={{ textAlign: 'center', paddingTop: 4 }}>
          <div className="ra-check"><Icon name="check" /></div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>Agendamento confirmado</div>
          <div style={{ fontSize: 13, color: 'var(--ra-ink-2)', marginTop: 4 }}>Em até 1 hora antes da retirada</div>
        </div>

        <div className="ra-reservation">
          {/* Plan card */}
          <div className="summary">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0 14px', borderBottom: '1px solid var(--ra-divider)' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#F2F2F2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bike" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>VAMMO COMFORT</div>
                <div style={{ fontSize: 12, color: 'var(--ra-ink-2)' }}>Plano anual</div>
              </div>
              <Icon name="chevron-down" />
            </div>

            <div className="ra-summary-row">
              <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="calendar" /> 10 de abril</span>
              <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="clock" /> 11:15</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ra-ink-2)', marginTop: 4 }}>(sexta-feira)</div>
            <div className="ra-summary-row">
              <span className="k">Local</span>
              <span className="v" style={{ textAlign: 'right', maxWidth: 180 }}>Casa Vammo · Mooca<br/><span style={{ fontWeight: 400, fontSize: 12, color: 'var(--ra-ink-2)' }}>Av. Henry Ford, 506</span></span>
            </div>
          </div>

          <button className="ra-btn-primary" onClick={() => setSheet('alter')}>
            <Icon name="pencil" />
            Alterar reserva
          </button>
        </div>
      </div>

      <TabBar active="home" onSelect={onNav} />

      {/* Alter reservation sheet */}
      {sheet === 'alter' && (
        <BottomSheet icon="pencil" title="Alterar reserva" onClose={() => setSheet(null)}>
          <p className="body">Imprevistos acontecem. Você pode alterar a data e o horário da sua retirada sem nenhum custo adicional.</p>
          <div className="actions">
            <button className="ra-btn-primary" onClick={() => { setSheet(null); onNav && onNav('reschedule'); }}>
              <Icon name="calendar" /> Reagendar retirada
            </button>
            <button className="ra-btn-danger" onClick={() => setSheet('confirmCancel')}>
              Cancelar reserva
            </button>
          </div>
        </BottomSheet>
      )}

      {/* Confirm cancel sheet */}
      {sheet === 'confirmCancel' && (
        <BottomSheet icon="alert-triangle" title="Cancelar reserva?" onClose={() => setSheet(null)}>
          <p className="body">Ao cancelar, você perde seu lugar na fila e, se quiser, terá que agendar novamente sua retirada.</p>
          <div className="actions">
            <button className="ra-btn-primary" onClick={() => setSheet(null)}>Não, manter reserva</button>
            <button className="ra-btn-danger" onClick={() => setSheet('feedback')}>Sim, cancelar reserva</button>
          </div>
        </BottomSheet>
      )}

      {/* Feedback sheet */}
      {sheet === 'feedback' && (
        <BottomSheet icon="message-square" title="Reserva cancelada. O que aconteceu?" onClose={() => setSheet(null)}>
          <div className="ra-radio-list">
            {[
              'Ainda tenho dúvidas sobre o serviço',
              'Achei o plano muito caro',
              'Achei o valor da caução alto',
              'Mudei de ideia/Tive um imprevisto',
              'Estava só testando o aplicativo',
              'Outro',
            ].map(r => (
              <div key={r} className="ra-radio-row" onClick={() => setReason(r)}>
                <div className={'ra-radio' + (reason === r ? ' checked' : '')}></div>
                <span>{r}</span>
              </div>
            ))}
          </div>
          <button className="ra-btn-primary" disabled={!reason} style={!reason ? { opacity: 0.4 } : null}>
            Enviar feedback
          </button>
        </BottomSheet>
      )}
    </div>
  );
}

Object.assign(window, { ReservationScreen });
