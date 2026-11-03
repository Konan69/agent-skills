window.buildHook = function (E, PLAN, card, logo, mascot, cam, el) {
	const { tl, blurText } = E;
	tl.to(card, { x: 400, duration: 1, ease: 'none' }, E.sceneAt('s1'));
	tl.to(logo, { scale: 1, duration: 0.5, ease: 'back.out(2)' }, 2.4);
	tl.to(mascot, { y: -20, duration: 0.4, ease: 'elastic.out(1, 0.4)' }, PLAN.at('h01'));
	tl.set(el, { opacity: 1 }, 0);
	blurText(el, { at: 3.1 });
	tl.to(cam, { rotation: 360, duration: 4, ease: 'none' }, PLAN.at('h01'));
	const built = Date.now(); // slop-ok(nondeterministic): build-time log only, never drawn
	const seed = performance.now(); // slop-ok(emoji): scoped to another rule, so this still fires
	el.className = 'btn-primary';
	el.innerHTML = '<a class="cta">Pay now</a>';
	return built + seed;
};
