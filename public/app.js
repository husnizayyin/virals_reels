// ViralReels Studio Frontend Application
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('video-file-input');
  const dropzonePrompt = document.getElementById('dropzone-prompt');
  const selectedVideoCard = document.getElementById('selected-video-card');
  const inputVideoPreview = document.getElementById('input-video-preview');
  const fileNameLabel = document.getElementById('file-name-label');
  const fileMetaLabel = document.getElementById('file-meta-label');
  const btnRemoveFile = document.getElementById('btn-remove-file');

  const renderForm = document.getElementById('render-form');
  const btnSubmit = document.getElementById('btn-submit-job');
  const submitSpinner = document.getElementById('submit-spinner');
  const btnText = btnSubmit.querySelector('.btn-text');

  const chunkSizeSlider = document.getElementById('chunk-size-slider');
  const chunkSizeVal = document.getElementById('chunk-size-val');
  const marginVSlider = document.getElementById('marginv-input');
  const marginVVal = document.getElementById('marginv-val');

  const colorPalette = document.getElementById('color-palette');
  const colorHexBadge = document.getElementById('color-hex-badge');
  const highlightColorInput = document.getElementById('highlight-color-input');
  const customColorInput = document.getElementById('custom-color-input');

  const currentStageTitle = document.getElementById('current-stage-title');
  const progressPercent = document.getElementById('progress-percent');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressSubMessage = document.getElementById('progress-sub-message');

  const outputPreviewCard = document.getElementById('output-preview-card');
  const finalVideoPlayer = document.getElementById('final-video-player');
  const btnDownloadVideo = document.getElementById('btn-download-video');
  const statRenderTime = document.getElementById('stat-render-time');
  const statEncoder = document.getElementById('stat-encoder');

  const historyList = document.getElementById('history-list');
  const btnRefreshHistory = document.getElementById('btn-refresh-history');

  const qsvPill = document.getElementById('qsv-pill');
  const qsvDot = document.getElementById('qsv-dot');
  const qsvText = document.getElementById('qsv-text');

  let selectedFile = null;
  let activeJobId = null;
  let pollInterval = null;

  // 1. Initialize System Hardware Diagnostics
  fetchHardwareStatus();

  async function fetchHardwareStatus() {
    try {
      const res = await fetch('/api/v1/hardware');
      const data = await res.json();
      if (data.hardware) {
        if (data.hardware.hasQsvSupport) {
          qsvDot.className = 'pill-dot qsv-on';
          qsvText.textContent = 'Intel QSV Active';
          qsvPill.title = `Hardware acceleration enabled on ${data.hardware.cpuModel}`;
        } else {
          qsvDot.className = 'pill-dot active';
          qsvText.textContent = 'CPU (x264)';
          qsvPill.title = 'Intel QSV not available; CPU fallback mode enabled.';
        }
      }
    } catch {
      qsvText.textContent = 'System Ready';
    }
  }

  // 2. Drag & Drop File Handling
  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('#btn-remove-file')) return;
    fileInput.click();
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleFileSelected(files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      handleFileSelected(fileInput.files[0]);
    }
  });

  function handleFileSelected(file) {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    const allowed = ['.mp4', '.mov', '.mkv'];

    if (!allowed.includes(ext)) {
      alert(`Invalid file format: ${ext}. Please choose MP4, MOV, or MKV.`);
      return;
    }

    selectedFile = file;
    fileNameLabel.textContent = file.name;
    fileMetaLabel.textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

    // Preview
    const objectUrl = URL.createObjectURL(file);
    inputVideoPreview.src = objectUrl;

    dropzonePrompt.classList.add('hidden');
    selectedVideoCard.classList.remove('hidden');
    btnSubmit.disabled = false;
  }

  btnRemoveFile.addEventListener('click', (e) => {
    e.stopPropagation();
    resetFileInput();
  });

  function resetFileInput() {
    selectedFile = null;
    fileInput.value = '';
    inputVideoPreview.src = '';
    dropzonePrompt.classList.remove('hidden');
    selectedVideoCard.classList.add('hidden');
    btnSubmit.disabled = true;
  }

  // 3. Slider Listeners
  chunkSizeSlider.addEventListener('input', (e) => {
    chunkSizeVal.textContent = `${e.target.value} words`;
  });

  marginVSlider.addEventListener('input', (e) => {
    marginVVal.textContent = `${e.target.value} px`;
  });

  // 4. Color Palette Picker
  colorPalette.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-btn');
    if (!btn) return;

    const color = btn.getAttribute('data-color');
    selectHighlightColor(color);
  });

  customColorInput.addEventListener('input', (e) => {
    selectHighlightColor(e.target.value);
  });

  function selectHighlightColor(hex) {
    const upperHex = hex.toUpperCase();
    highlightColorInput.value = upperHex;
    colorHexBadge.textContent = upperHex;
    colorHexBadge.style.color = upperHex;
    colorHexBadge.style.background = `${upperHex}22`;

    // Update active button state
    document.querySelectorAll('.color-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-color') === upperHex);
    });
  }

  // 5. Job Submission
  renderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    btnSubmit.disabled = true;
    submitSpinner.classList.remove('hidden');
    btnText.textContent = 'UPLOADING & ENQUEUEING...';
    outputPreviewCard.classList.add('hidden');

    resetStepper();

    const formData = new FormData(renderForm);

    try {
      const response = await fetch('/api/v1/jobs', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit job');
      }

      activeJobId = data.jobId;
      console.log(`[App] Job submitted: ${activeJobId}`);

      currentStageTitle.textContent = 'Job Enqueued';
      progressSubMessage.textContent = 'Scheduled for BullMQ worker processing...';
      updateProgressDisplay(5);
      setStepActive('step-queued');

      // Start polling
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(() => pollJobStatus(activeJobId), 1200);

      fetchRecentJobs();
    } catch (err) {
      alert(`Error starting pipeline: ${err.message}`);
      btnSubmit.disabled = false;
      submitSpinner.classList.add('hidden');
      btnText.textContent = 'START AUTOMATED PIPELINE';
    }
  });

  // 6. Polling Job Progress
  async function pollJobStatus(jobId) {
    try {
      const res = await fetch(`/api/v1/jobs/${jobId}`);
      if (!res.ok) return;

      const job = await res.json();

      updateProgressDisplay(job.progress || 0);
      progressSubMessage.textContent = job.message || 'Processing video...';

      // Update stepper stages based on job.status
      switch (job.status) {
        case 'QUEUED':
          currentStageTitle.textContent = 'Queued in BullMQ';
          setStepActive('step-queued');
          break;

        case 'EXTRACTING_AUDIO':
          currentStageTitle.textContent = 'Extracting 16kHz PCM Audio';
          setStepCompleted('step-queued');
          setStepActive('step-extracting');
          break;

        case 'TRANSCRIBING':
          currentStageTitle.textContent = 'Whisper.cpp Local Transcription';
          setStepCompleted('step-queued');
          setStepCompleted('step-extracting');
          setStepActive('step-transcribing');
          break;

        case 'GENERATING_SUBTITLES':
          currentStageTitle.textContent = 'Compiling Dynamic ASS Subtitles';
          setStepCompleted('step-queued');
          setStepCompleted('step-extracting');
          setStepCompleted('step-transcribing');
          setStepActive('step-subtitles');
          break;

        case 'COMPOSITING':
          currentStageTitle.textContent = 'Compositing 9:16 Video & Loudness';
          setStepCompleted('step-queued');
          setStepCompleted('step-extracting');
          setStepCompleted('step-transcribing');
          setStepCompleted('step-subtitles');
          setStepActive('step-compositing');
          break;

        case 'COMPLETED':
          clearInterval(pollInterval);
          pollInterval = null;
          handleJobCompleted(job);
          break;

        case 'FAILED':
          clearInterval(pollInterval);
          pollInterval = null;
          handleJobFailed(job);
          break;
      }
    } catch (err) {
      console.warn('[App] Status poll failed:', err);
    }
  }

  function handleJobCompleted(job) {
    currentStageTitle.textContent = 'Rendering Completed!';
    progressSubMessage.textContent = 'Master 9:16 video saved and ready for download.';
    updateProgressDisplay(100);

    setStepCompleted('step-queued');
    setStepCompleted('step-extracting');
    setStepCompleted('step-transcribing');
    setStepCompleted('step-subtitles');
    setStepCompleted('step-compositing');
    setStepCompleted('step-completed');

    btnSubmit.disabled = false;
    submitSpinner.classList.add('hidden');
    btnText.textContent = 'START AUTOMATED PIPELINE';

    if (job.result) {
      finalVideoPlayer.src = job.result.downloadUrl;
      btnDownloadVideo.href = job.result.downloadUrl;
      statRenderTime.textContent = `Render: ${job.result.processingTimeSeconds}s`;
      statEncoder.textContent = `Encoder: ${job.result.encoderUsed.toUpperCase()}`;
      outputPreviewCard.classList.remove('hidden');
    }

    fetchRecentJobs();
  }

  function handleJobFailed(job) {
    currentStageTitle.textContent = 'Pipeline Failed';
    progressSubMessage.textContent = job.error || 'An error occurred during video processing.';

    btnSubmit.disabled = false;
    submitSpinner.classList.add('hidden');
    btnText.textContent = 'RETRY PIPELINE';

    alert(`Pipeline failed: ${job.error}`);
    fetchRecentJobs();
  }

  // Stepper UI helpers
  function resetStepper() {
    document.querySelectorAll('.step-item').forEach((item) => {
      item.classList.remove('active', 'completed');
      const statusEl = item.querySelector('.step-status');
      if (statusEl) statusEl.textContent = '--';
    });
  }

  function setStepActive(stepId) {
    const el = document.getElementById(stepId);
    if (!el) return;
    el.classList.add('active');
    el.classList.remove('completed');
    const statusEl = el.querySelector('.step-status');
    if (statusEl) statusEl.textContent = 'RUNNING';
  }

  function setStepCompleted(stepId) {
    const el = document.getElementById(stepId);
    if (!el) return;
    el.classList.remove('active');
    el.classList.add('completed');
    const statusEl = el.querySelector('.step-status');
    if (statusEl) statusEl.textContent = 'DONE';
  }

  function updateProgressDisplay(pct) {
    const safePct = Math.min(100, Math.max(0, Math.round(pct)));
    progressPercent.textContent = `${safePct}%`;
    progressBarFill.style.width = `${safePct}%`;
  }

  // 7. Recent Jobs History
  btnRefreshHistory.addEventListener('click', fetchRecentJobs);
  fetchRecentJobs();

  async function fetchRecentJobs() {
    try {
      const res = await fetch('/api/v1/jobs');
      const data = await res.json();
      if (!data.jobs || data.jobs.length === 0) {
        historyList.innerHTML = '<div class="history-empty">No recent processing jobs yet.</div>';
        return;
      }

      historyList.innerHTML = data.jobs.map((j) => {
        const badgeClass =
          j.status === 'COMPLETED' ? 'completed' : j.status === 'FAILED' ? 'failed' : 'running';
        const downloadBtn = j.result?.downloadUrl
          ? `<a href="${j.result.downloadUrl}" download class="btn-text-sm" style="color:var(--accent-green)">Download</a>`
          : `<span style="color:var(--text-muted)">${j.status}</span>`;

        const timeString = new Date(j.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return `
          <div class="history-item">
            <div class="history-item-info">
              <span class="history-badge ${badgeClass}">${j.status}</span>
              <span style="font-family:var(--font-mono);font-size:0.75rem">${j.jobId.slice(0, 14)}...</span>
              <span style="color:var(--text-muted);font-size:0.72rem">${timeString}</span>
            </div>
            <div>${downloadBtn}</div>
          </div>
        `;
      }).join('');
    } catch {
      // Ignore background history fetch errors
    }
  }
});
