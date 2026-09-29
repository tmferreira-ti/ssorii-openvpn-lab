(() => {
  const GUIDE_PATH = './aws-vpn-lab/HOWTO-OPENVPN-SITE-TO-SITE.md';
  const guide = document.querySelector('#guide');
  const toc = document.querySelector('#table-of-contents');
  const notice = document.querySelector('#runtime-notice');
  const toast = document.querySelector('#toast');
  const searchDialog = document.querySelector('#search-dialog');
  const searchInput = document.querySelector('#search-input');
  const searchResults = document.querySelector('#search-results');
  let searchableSections = [];

  const slugify = (value) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const escapeHtml = (value) => value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  const showToast = (message) => {
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 1600);
  };

  const enhanceCodeBlocks = () => {
    guide.querySelectorAll('pre').forEach((pre) => {
      if (pre.parentElement.classList.contains('code-wrap')) return;
      const code = pre.querySelector('code');
      const languageClass = [...(code?.classList || [])].find((item) => item.startsWith('language-'));
      const language = languageClass ? languageClass.replace('language-', '') : 'texto';
      const wrap = document.createElement('div');
      wrap.className = 'code-wrap';
      const toolbar = document.createElement('div');
      toolbar.className = 'code-toolbar';
      toolbar.innerHTML = `<span>${escapeHtml(language)}</span><button class="copy-button" type="button">Copiar</button>`;
      pre.replaceWith(wrap);
      wrap.append(toolbar, pre);
      toolbar.querySelector('button').addEventListener('click', async () => {
        await navigator.clipboard.writeText(code?.textContent || pre.textContent);
        showToast('Conteúdo copiado');
      });

      if (code) {
        code.innerHTML = code.innerHTML.replace(/(^|\n)(#.*|REM .*?)(?=\n|$)/gi, '$1<span class="comment">$2</span>');
      }
    });
  };

  const buildNavigation = () => {
    const headings = [...guide.querySelectorAll('h1, h2')];
    const used = new Map();
    headings.forEach((heading) => {
      const base = slugify(heading.textContent) || 'secao';
      const count = used.get(base) || 0;
      used.set(base, count + 1);
      heading.id = count ? `${base}-${count + 1}` : base;
    });

    toc.innerHTML = headings.map((heading) => {
      const major = heading.tagName === 'H1' ? ' toc-major' : '';
      return `<a class="${major}" href="#${heading.id}">${escapeHtml(heading.textContent)}</a>`;
    }).join('');

    searchableSections = headings.map((heading, index) => {
      const parts = [];
      let node = heading.nextElementSibling;
      while (node && !/^H[12]$/.test(node.tagName)) {
        parts.push(node.textContent.trim());
        node = node.nextElementSibling;
      }
      return { id: heading.id, title: heading.textContent, text: parts.join(' '), index };
    });

    const links = [...toc.querySelectorAll('a')];
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((link) => link.classList.toggle('active', link.hash === `#${entry.target.id}`));
      });
    }, { rootMargin: '-18% 0px -72% 0px' });
    headings.forEach((heading) => observer.observe(heading));

    links.forEach((link) => link.addEventListener('click', () => {
      document.querySelector('#sidebar').classList.remove('open');
      document.querySelector('#mobile-menu').setAttribute('aria-expanded', 'false');
    }));
  };

  const loadGuide = async () => {
    if (!window.marked || !window.DOMPurify) throw new Error('As bibliotecas de renderização não foram carregadas.');
    const response = await fetch(GUIDE_PATH);
    if (!response.ok) throw new Error(`Não foi possível carregar o guia (${response.status}).`);
    const markdown = await response.text();
    const rendered = window.marked.parse(markdown, { gfm: true, breaks: false });
    guide.innerHTML = window.DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });
    enhanceCodeBlocks();
    buildNavigation();
  };

  const openSearch = () => {
    searchDialog.hidden = false;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => searchInput.focus(), 30);
  };

  const closeSearch = () => {
    searchDialog.hidden = true;
    document.body.style.overflow = '';
    searchInput.value = '';
    searchResults.innerHTML = '<p>Digite para pesquisar nas seções do guia.</p>';
  };

  const updateSearch = () => {
    const query = searchInput.value.trim().toLocaleLowerCase('pt-BR');
    if (query.length < 2) {
      searchResults.innerHTML = '<p>Digite ao menos dois caracteres para pesquisar.</p>';
      return;
    }
    const matches = searchableSections.filter(({ title, text }) => `${title} ${text}`.toLocaleLowerCase('pt-BR').includes(query)).slice(0, 12);
    searchResults.innerHTML = matches.length ? matches.map(({ id, title, text }) => {
      const plain = text.replace(/\s+/g, ' ');
      const position = plain.toLocaleLowerCase('pt-BR').indexOf(query);
      const start = Math.max(0, position - 55);
      const excerpt = `${start ? '…' : ''}${plain.slice(start, start + 150)}${plain.length > start + 150 ? '…' : ''}`;
      return `<a class="search-result" href="#${id}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(excerpt)}</span></a>`;
    }).join('') : '<p>Nenhum resultado encontrado.</p>';

    searchResults.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeSearch));
  };

  const savedTheme = localStorage.getItem('openvpn-guide-theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  document.querySelector('#theme-button').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('openvpn-guide-theme', next);
  });

  document.querySelector('#search-button').addEventListener('click', openSearch);
  searchInput.addEventListener('input', updateSearch);
  searchDialog.addEventListener('click', (event) => { if (event.target === searchDialog) closeSearch(); });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
    if (event.key === 'Escape' && !searchDialog.hidden) closeSearch();
  });

  const sidebar = document.querySelector('#sidebar');
  const mobileMenu = document.querySelector('#mobile-menu');
  mobileMenu.addEventListener('click', () => {
    const open = sidebar.classList.toggle('open');
    mobileMenu.setAttribute('aria-expanded', String(open));
  });
  document.querySelector('#close-sidebar').addEventListener('click', () => {
    sidebar.classList.remove('open');
    mobileMenu.setAttribute('aria-expanded', 'false');
  });

  window.addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    document.querySelector('#reading-progress').style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`;
  }, { passive: true });

  loadGuide().catch((error) => {
    notice.hidden = false;
    notice.innerHTML = `<strong>Não foi possível abrir o guia.</strong> ${escapeHtml(error.message)} Para testar localmente, use um servidor HTTP em vez de abrir o arquivo diretamente.`;
    guide.innerHTML = '<p>O conteúdo continua disponível no arquivo Markdown do repositório.</p>';
  });
})();
