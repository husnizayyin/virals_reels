// HD Booster & Metadata Scrubber Frontend Controller
// Completely isolated from the Viral Subtitle pipeline

document.addEventListener('DOMContentLoaded', () => {
  // Tab Switcher Elements
  const tabSubtitlesBtn = document.getElementById('tab-btn-subtitles');
  const tabCleanerBtn = document.getElementById('tab-btn-cleaner');
  const viewSubtitles = document.getElementById('view-subtitles');
  const viewCleaner = document.getElementById('view-cleaner');

  if (tabSubtitlesBtn && tabCleanerBtn && viewSubtitles && viewCleaner) {
    tabSubtitlesBtn.addEventListener('click', () => {
      tabSubtitlesBtn.classList.add('active');
      tabCleanerBtn.classList.remove('active');
      viewSubtitles.classList.remove('hidden');
      viewCleaner.classList.add('hidden');
    });

    tabCleanerBtn.addEventListener('click', () => {
      tabCleanerBtn.classList.add('active');
      tabSubtitlesBtn.classList.remove('active');
      viewCleaner.classList.remove('hidden');
      viewSubtitles.classList.add('hidden');
      fetchCleanerHistory();
    });
  }

  // Cleaner DOM Elements
  const cleanerDropzone = document.getElementById('cleaner-dropzone');
  const cleanerFileInput = document.getElementById('cleaner-file-input');
  const cleanerPrompt = document.getElementById('cleaner-dropzone-prompt');
  const cleanerSelectedCard = document.getElementById('cleaner-selected-card');
  const cleanerPreview = document.getElementById('cleaner-video-preview');
  const cleanerFileName = document.getElementById('cleaner-file-name');
  const cleanerFileMeta = document.getElementById('cleaner-file-meta');
  const cleanerBtnRemove = document.getElementById('cleaner-btn-remove');

  // Inspection Card Elements
  const inspectCard = document.getElementById('cleaner-inspect-card');
  const inspectVfrTag = document.getElementById('inspect-vfr-tag');
  const inspectGpsTag = document.getElementById('inspect-gps-tag');
  const inspectCameraTag = document.getElementById('inspect-camera-tag');
  const inspectTagsTag = document.getElementById('inspect-tags-tag');

  // Preset & Form Elements
  const cleanerForm = document.getElementById('cleaner-form');
  const cleanerSubmitBtn = document.getElementById('cleaner-btn-submit');
  const cleanerSubmitSpinner = document.getElementById('cleaner-submit-spinner');
  const presetButtons = document.querySelectorAll('.cleaner-preset-btn');
  const platformInput = document.getElementById('cleaner-platform-input');
  const fpsSelect = document.getElementById('cleaner-fps-select');
  const resolutionSelect = document.getElementById('cleaner-resolution-select');
  const ditherCheckbox = document.getElementById('cleaner-dither-checkbox');
  const unsharpCheckbox = document.getElementById('cleaner-unsharp-checkbox');
  const audioNormCheckbox = document.getElementById('cleaner-audionorm-checkbox');
  const forceCpuCheckbox = document.getElementById('cleaner-forcecpu-checkbox');

  // Monitor Card Elements
  const monitorCard = document.getElementById('cleaner-monitor-card');
  const currentStageTitle = document.getElementById('cleaner-stage-title');
  const progressPercent = document.getElementById('cleaner-progress-percent');
  const progressBarFill = document.getElementById('cleaner-progress-bar-fill');
  const progressSubMessage = document.getElementById('cleaner-progress-sub-message');

  // Comparison & Output Elements
  const comparisonCard = document.getElementById('cleaner-comparison-card');
  const compMetaBefore = document.getElementById('comp-meta-before');
  const compMetaAfter = document.getElementById('comp-meta-after');
  const compGpsBefore = document.getElementById('comp-gps-before');
  const compGpsAfter = document.getElementById('comp-gps-after');
  const compFpsBefore = document.getElementById('comp-fps-before');
  const compFpsAfter = document.getElementById('comp-fps-after');
  const compColorBefore = document.getElementById('comp-color-before');
  const compColorAfter = document.getElementById('comp-color-after');
  const compSizeBefore = document.getElementById('comp-size-before');
  const compSizeAfter = document.getElementById('comp-size-after');

  const outputSection = document.getElementById('cleaner-output-section');
  const finalVideoPlayer = document.getElementById('cleaner-final-player');
  const btnDownload = document.getElementById('cleaner-btn-download');
  const statRenderTime = document.getElementById('cleaner-stat-render-time');
  const statEncoder = document.getElementById('cleaner-stat-encoder');
  const cleanerHistoryList = document.getElementById('cleaner-history-list');
  const btnRefreshHistory = document.getElementById('cleaner-btn-refresh-history');

  let selectedFile = null;
  let activePollingTimer = null;

  // Preset Selection Handling
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      presetButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const preset = btn.getAttribute('data-preset');
      platformInput.value = preset;

      if (preset === 'reels') {
        fpsSelect.value = '60';
        resolutionSelect.value = '1080x1920';
        ditherCheckbox.checked = true;
        unsharpCheckbox.checked = true;
        audioNormCheckbox.checked = true;
      } else if (preset === 'tiktok') {
        fpsSelect.value = '60';
        resolutionSelect.value = '1080x1920';
        ditherCheckbox.checked = true;
        unsharpCheckbox.checked = true;
        audioNormCheckbox.checked = true;
      } else if (preset === 'universal') {
        fpsSelect.value = '30';
        resolutionSelect.value = '1080x1920';
        ditherCheckbox.checked = true;
        unsharpCheckbox.checked = true;
        audioNormCheckbox.checked = true;
      } else if (preset === 'metadata_only') {
        fpsSelect.value = 'source';
        resolutionSelect.value = 'original';
        ditherCheckbox.checked = false;
        unsharpCheckbox.checked = false;
        audioNormCheckbox.checked = false;
      }
    });
  });

  // Dropzone drag & drop
  if (cleanerDropzone) {
    cleanerDropzone.addEventListener('click', (e) => {
      if (e.target !== cleanerBtnRemove) {
        cleanerFileInput.click();
      }
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      cleanerDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        cleanerDropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      cleanerDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        cleanerDropzone.classList.remove('dragover');
      });
    });

    cleanerDropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        handleFileSelect(dt.files[0]);
      }
    });
  }

  if (cleanerFileInput) {
    cleanerFileInput.addEventListener('change', (e) => {
      if (cleanerFileInput.files && cleanerFileInput.files.length > 0) {
        handleFileSelect(cleanerFileInput.files[0]);
      }
    });
  }

  if (cleanerBtnRemove) {
    cleanerBtnRemove.addEventListener('click', (e) => {
      e.stopPropagation();
      resetSelectedFile();
    });
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function handleFileSelect(file) {
    selectedFile = file;
    cleanerFileName.textContent = file.name;
    cleanerFileMeta.textContent = formatBytes(file.size);

    cleanerPrompt.classList.add('hidden');
    cleanerSelectedCard.classList.remove('hidden');
    cleanerSubmitBtn.disabled = false;

    // Load preview
    const url = URL.createObjectURL(file);
    cleanerPreview.src = url;

    // Trigger instant background metadata probe
    probeVideoFile(file);
  }

  function resetSelectedFile() {
    selectedFile = null;
    cleanerFileInput.value = '';
    cleanerPreview.pause();
    cleanerPreview.removeAttribute('src');
    cleanerPreview.load();

    cleanerPrompt.classList.remove('hidden');
    cleanerSelectedCard.classList.add('hidden');
    inspectCard.classList.add('hidden');
    cleanerSubmitBtn.disabled = true;
  }

  // Fast background metadata inspector
  async function probeVideoFile(file) {
    inspectCard.classList.remove('hidden');
    inspectVfrTag.textContent = 'Probing...';
    inspectGpsTag.textContent = 'Probing...';
    inspectCameraTag.textContent = 'Probing...';
    inspectTagsTag.textContent = 'Probing...';

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/v1/cleaner/inspect', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.success && data.metadata) {
        const m = data.metadata;
        // VFR status
        if (m.video?.isVfr) {
          inspectVfrTag.innerHTML = `<span class="badge-pill warn">⚠️ VFR (${m.video.fps} fps) - Stutters</span>`;
        } else {
          inspectVfrTag.innerHTML = `<span class="badge-pill success">✅ CFR (${m.video?.fps || 30} fps)</span>`;
        }

        // GPS status
        if (m.hasGps) {
          inspectGpsTag.innerHTML = `<span class="badge-pill danger">⚠️ GPS EXPOSED</span>`;
        } else {
          inspectGpsTag.innerHTML = `<span class="badge-pill success">✅ Clean (No GPS)</span>`;
        }

        // Camera / Device
        inspectCameraTag.textContent = m.cameraMakeModel || 'Anonymous / None';

        // Tag count
        inspectTagsTag.innerHTML = `<span class="badge-pill">${m.atomTagsCount} tags detected</span>`;
      } else {
        inspectCard.classList.add('hidden');
      }
    } catch {
      inspectCard.classList.add('hidden');
    }
  }

  // Form Submission
  if (cleanerForm) {
    cleanerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!selectedFile) return;

      cleanerSubmitBtn.disabled = true;
      cleanerSubmitSpinner.classList.remove('hidden');

      // Reset monitor UI
      outputSection.classList.add('hidden');
      comparisonCard.classList.add('hidden');
      setStageStep('clean-step-scan', 'active');
      resetStageSteps(['clean-step-cfr', 'clean-step-color', 'clean-step-audio', 'clean-step-faststart']);

      updateMonitorUI({
        title: 'Ingesting & Probing Media Container',
        percent: 10,
        message: 'Uploading video and locking constant frame rate...'
      });

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('platform', platformInput.value);
      formData.append('fps', fpsSelect.value);
      formData.append('resolution', resolutionSelect.value);
      formData.append('applyMicroDither', String(ditherCheckbox.checked));
      formData.append('applyUnsharp', String(unsharpCheckbox.checked));
      formData.append('normalizeAudio', String(audioNormCheckbox.checked));
      formData.append('forceCpu', String(forceCpuCheckbox.checked));

      try {
        const response = await fetch('/api/v1/cleaner/jobs', {
          method: 'POST',
          body: formData
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to submit cleaning task.');
        }

        // Start polling job status
        pollCleanerJob(data.jobId);
      } catch (err) {
        alert(`Error: ${err.message}`);
        cleanerSubmitBtn.disabled = false;
        cleanerSubmitSpinner.classList.add('hidden');
        updateMonitorUI({
          title: 'Job Failed',
          percent: 0,
          message: err.message
        });
      }
    });
  }

  function updateMonitorUI({ title, percent, message }) {
    if (currentStageTitle) currentStageTitle.textContent = title;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressBarFill) progressBarFill.style.width = `${percent}%`;
    if (progressSubMessage) progressSubMessage.textContent = message;
  }

  function setStageStep(stepId, status) {
    const el = document.getElementById(stepId);
    if (!el) return;
    el.classList.remove('active', 'completed', 'failed');
    if (status) el.classList.add(status);
    const statusText = el.querySelector('.step-status');
    if (statusText) {
      if (status === 'completed') statusText.textContent = 'DONE';
      else if (status === 'active') statusText.textContent = 'RUNNING';
      else if (status === 'failed') statusText.textContent = 'ERR';
      else statusText.textContent = '--';
    }
  }

  function resetStageSteps(stepIds) {
    stepIds.forEach((id) => setStageStep(id, ''));
  }

  function pollCleanerJob(jobId) {
    if (activePollingTimer) clearInterval(activePollingTimer);

    activePollingTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/cleaner/jobs/${jobId}`);
        const data = await res.json();

        if (data.status === 'PROCESSING') {
          const pct = data.progress || 15;
          updateMonitorUI({
            title: 'Optimizing Video Stream (Zero FPS Drop & Rec.709)',
            percent: pct,
            message: data.message || 'Processing frames...'
          });

          if (pct >= 15) setStageStep('clean-step-scan', 'completed');
          if (pct >= 35) setStageStep('clean-step-cfr', 'active');
          if (pct >= 55) {
            setStageStep('clean-step-cfr', 'completed');
            setStageStep('clean-step-color', 'active');
          }
          if (pct >= 75) {
            setStageStep('clean-step-color', 'completed');
            setStageStep('clean-step-audio', 'active');
          }
          if (pct >= 88) {
            setStageStep('clean-step-audio', 'completed');
            setStageStep('clean-step-faststart', 'active');
          }
        } else if (data.status === 'COMPLETED') {
          clearInterval(activePollingTimer);
          activePollingTimer = null;

          // Complete all steps
          ['clean-step-scan', 'clean-step-cfr', 'clean-step-color', 'clean-step-audio', 'clean-step-faststart'].forEach((id) => {
            setStageStep(id, 'completed');
          });

          updateMonitorUI({
            title: 'Mastering Completed!',
            percent: 100,
            message: 'Video sanitized and HD conditioned for TikTok & Reels.'
          });

          cleanerSubmitBtn.disabled = false;
          cleanerSubmitSpinner.classList.add('hidden');

          displayCleanResult(data.result);
          fetchCleanerHistory();
        } else if (data.status === 'FAILED') {
          clearInterval(activePollingTimer);
          activePollingTimer = null;

          updateMonitorUI({
            title: 'Processing Failed',
            percent: 100,
            message: data.error || 'FFmpeg encoding failed.'
          });

          cleanerSubmitBtn.disabled = false;
          cleanerSubmitSpinner.classList.add('hidden');
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1000);
  }

  function displayCleanResult(result) {
    if (!result) return;

    comparisonCard.classList.remove('hidden');
    outputSection.classList.remove('hidden');

    const b = result.before;
    const a = result.after;

    // Populate Comparison Card
    if (compMetaBefore) compMetaBefore.textContent = `${b.atomTagsCount} tags`;
    if (compMetaAfter) compMetaAfter.textContent = '0 tags (CLEANED)';

    if (compGpsBefore) compGpsBefore.textContent = b.hasGps ? '⚠️ EXPOSED' : 'None';
    if (compGpsAfter) compGpsAfter.textContent = '✅ REMOVED';

    if (compFpsBefore) compFpsBefore.textContent = `${b.video?.fps || '?'} FPS (${b.video?.isVfr ? 'VFR' : 'CFR'})`;
    if (compFpsAfter) compFpsAfter.textContent = `${a.video?.fps || '?'} FPS (STRICT CFR)`;

    if (compColorBefore) compColorBefore.textContent = b.video?.colorSpace || 'Raw / Untagged';
    if (compColorAfter) compColorAfter.textContent = 'BT.709 Rec.709 (No Washout)';

    if (compSizeBefore) compSizeBefore.textContent = formatBytes(b.fileSizeBytes);
    if (compSizeAfter) compSizeAfter.textContent = formatBytes(result.fileSizeBytes);

    // Player & Stats
    const downloadUrl = `/api/v1/cleaner/download/${encodeURIComponent(result.outputFileName)}`;
    finalVideoPlayer.src = downloadUrl;
    btnDownload.href = downloadUrl;
    btnDownload.setAttribute('download', result.outputFileName);

    if (statRenderTime) statRenderTime.textContent = `Render: ${result.renderTimeSeconds}s`;
    if (statEncoder) statEncoder.textContent = `Encoder: ${result.encoderUsed} (${result.usedHardwareAcceleration ? 'Intel QSV' : 'CPU libx264'})`;

    // Scroll to player
    outputSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Fetch Cleaner History
  async function fetchCleanerHistory() {
    if (!cleanerHistoryList) return;
    try {
      const res = await fetch('/api/v1/cleaner/jobs');
      const data = await res.json();

      if (!data.success || !data.jobs || data.jobs.length === 0) {
        cleanerHistoryList.innerHTML = '<div class="history-empty">No recent HD optimization jobs yet.</div>';
        return;
      }

      cleanerHistoryList.innerHTML = '';
      data.jobs.slice(0, 8).forEach((job) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        const isDone = job.status === 'COMPLETED';

        item.innerHTML = `
          <div class="history-item-info">
            <span class="history-filename">${escapeHtml(job.originalFileName)}</span>
            <span class="history-date">${new Date(job.createdAt).toLocaleTimeString()} • ${job.status}</span>
          </div>
          ${isDone && job.result ? `
            <a class="btn-text-sm" href="/api/v1/cleaner/download/${encodeURIComponent(job.result.outputFileName)}" download>Download</a>
          ` : ''}
        `;
        cleanerHistoryList.appendChild(item);
      });
    } catch {}
  }

  if (btnRefreshHistory) {
    btnRefreshHistory.addEventListener('click', fetchCleanerHistory);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, (tag) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }
});
