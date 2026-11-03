// Deterministic: positions come from the timing table, eases settle without overshoot.
window.buildHook = function (E, PLAN, card) {
	const t = PLAN.at('h01');
	E.tl.to(card, { x: 400, duration: 0.8, ease: 'power3.out' }, t);
	E.tl.to(card, { opacity: 0, duration: 0.3, ease: 'power2.in' }, t + 1.2);
};
