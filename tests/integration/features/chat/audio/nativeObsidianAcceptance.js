// Evaluated only by the official CLI inside the isolated native QA vault.
(async () => {
  const check = (ok, label) => { if (!ok) throw new Error(label); };
  check(app.vault.adapter.getBasePath() === '/qa/vault', 'Unexpected QA vault');
  check(await app.vault.adapter.read('.qa-marker') === 'grimoire-audio-native-qa', 'Missing QA ownership marker');
  const plugin = app.plugins.plugins.grimoire;
  check(plugin?.manifest.version === '2.0.13', 'Unexpected deployed plugin');
  await plugin.activateView();
  const view = app.workspace.getLeavesOfType('grimoire-view')[0].view;
  const manager = view.getTabManager();
  const tab = manager.getActiveTab();
  const input = tab.dom.inputEl;
  const control = tab.ui.audioDictation;
  check(control && control.target.available(), 'Native dictation target unavailable');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const mic = tab.dom.inputWrapper.querySelector('.grimoire-audio-controls button');
  const fits = button => {
    const box = button.getBoundingClientRect(); const editor = tab.dom.inputWrapper.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.left >= editor.left && box.right <= editor.right + 1 &&
      box.top >= editor.top && box.bottom <= editor.bottom + 1 && box.right <= innerWidth && box.bottom <= innerHeight;
  };
  const layoutDeadline = Date.now() + 3000;
  while ((!fits(mic) || !fits(tab.dom.sendButtonEl)) && Date.now() < layoutDeadline) await wait(50);
  check(fits(mic) && fits(tab.dom.sendButtonEl), 'Native dictation/send control clipped');
  const factory = control.connect;
  const observer = factory();
  const clients = [observer];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const status = () => observer.request('status');
  const readyAfterJob = async () => {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      const state = await status();
      if (state.status.client == null && state.status.ready && ['ready', 'sleeping'].includes(state.status.phase)) return state;
      await pause(30);
    }
    throw new Error('Owned job did not release');
  };
  const admitted = async () => {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      if ((await status()).status.client != null) return;
      await pause(20);
    }
    throw new Error('File job admission not observed');
  };
  const prepare = () => {
    input.value = 'Native draft 🙂 | suffix';
    input.setSelectionRange(16, 16);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const originalMessages = tab.state.messages.length;
  const keyboard = () => { metrics.keyboardEvents++; };
  const submit = () => { metrics.submitEvents++; };
  const metrics = { nativeObsidian: true, pluginVersion: plugin.manifest.version,
    keyboardEvents: 0, submitEvents: 0, nativeControlsVisible: true, microphone: false, producer: 'QA-only file transcription, unchanged production bridge/controller',
    transcriptRetained: false };
  input.addEventListener('keydown', keyboard); input.addEventListener('submit', submit);
  try {
    await observer.ready();
    const before = await status();
    const reference = await observer.transcribeFile('/qa/synthetic.wav');
    check(reference.trim().length > 0, 'Empty native ASR result');
    control.connect = () => {
      const session = factory(); clients.push(session);
      session.start = (_listening, processing) => { processing?.(); return session.transcribeFile('/qa/synthetic.wav'); };
      return session;
    };
    prepare(); const original = input.value; const caret = input.selectionStart;
    await control.toggle();
    check(input.value === original.slice(0, caret) + reference + original.slice(caret), 'Exact native composer insertion mismatch');
    check(input.selectionStart === caret + reference.length && input.selectionEnd === input.selectionStart, 'Native caret mismatch');
    check(!tab.state.isStreaming && tab.state.messages.length === originalMessages, 'Dictation submitted a chat turn');
    metrics.exactNativeDraftAndCaret = true;

    prepare(); const cancelledValue = input.value;
    const cancelled = control.toggle(); await admitted(); control.cancel(); await cancelled;
    check(input.value === cancelledValue, 'Cancelled native job inserted text'); await readyAfterJob();
    metrics.acceptedCancelSuppressesInsertion = true;

    prepare(); const edited = control.toggle(); await admitted();
    input.value += ' user edit'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const editedValue = input.value; await edited; await readyAfterJob();
    check(input.value === editedValue, 'Native concurrent edit was overwritten'); metrics.concurrentEditPreserved = true;

    prepare(); const stale = control.toggle(); await admitted();
    const next = await manager.createTab(); await manager.switchToTab(next.id); await stale; await readyAfterJob();
    check(input.value === cancelledValue, 'Native inactive tab received late text');
    check(next.dom.inputEl.value === '', 'Native result leaked to another tab'); metrics.tabSwitchSuppressesInsertion = true;
    await manager.switchToTab(tab.id);

    prepare(); await control.toggle();
    const after = await readyAfterJob();
    check(after.pid === before.pid && after.status.engineLoads === before.status.engineLoads, 'Native GUI/model owner changed');
    check(!after.status.listening && !after.status.hasResult, 'Capture/result leaked after file jobs');
    check(input.value === original.slice(0, caret) + reference + original.slice(caret), 'Native recovery insertion failed');
    metrics.recoveryPassed = true; metrics.sameAudioGuiPid = true; metrics.engineLoads = after.status.engineLoads;
    check(metrics.keyboardEvents === 0 && metrics.submitEvents === 0, 'Unexpected keyboard/submit event');
    return metrics;
  } finally {
    control.cancel(); control.connect = factory;
    clients.forEach(client => client.close());
    input.value = ''; input.setSelectionRange(0, 0); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.removeEventListener('keydown', keyboard); input.removeEventListener('submit', submit);
  }
})()
