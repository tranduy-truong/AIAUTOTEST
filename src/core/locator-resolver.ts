export interface ElementState {
  isExpanded?: boolean;
  isActive?: boolean;
  isDisabled?: boolean;
  isRequired?: boolean;
  isInvalid?: boolean;
}

export interface ElementInfo {
  tag: string;
  type?: string;
  role?: string;
  placeholder?: string;
  ariaLabel?: string;
  text?: string;
  testId?: string;
  dataSlot?: string;
  dataValue?: string;
  id?: string;
  name?: string;
  className?: string;
  title?: string;
  accessibleName?: string;
  nearbyInputPlaceholder?: string;
  labelText?: string;
  scopeSelector?: string;
  rowText?: string;
  rowSelector?: string;
  ariaHasPopup?: string;
  selector?: string;
  menuGroup?: string;
  state?: ElementState;
  learnedStepType?: string;
  learnedTarget?: string;
  learnedContext?: string;
  learnedLocator?: string;
  isVisible: boolean;
}

export interface DomSnapshot {
  url: string;
  afterStep: string;
  elements: ElementInfo[];
}

export interface ResolvedLocator {
  locator: string;          // e.g. "page.getByPlaceholder('Nhập tên đăng nhập')"
  confidence: 'high' | 'medium' | 'low';
  matchedBy: string;        // e.g. "placeholder", "role+name", "text"
  element?: ElementInfo;    // DOM evidence used to create this locator
}

/**
 * Hàm chuẩn hóa chuỗi để tìm kiếm mờ (fuzzy match)
 * Bỏ dấu, chuyển chữ thường, xóa khoảng trắng thừa
 */
function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/đ/g, 'd')
    .replace(/^['"]|['"]$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const SEMANTIC_SYNONYM_GROUPS: string[][] = [
  ['username', 'user name', 'user', 'user-name', 'email', 'account', 'login', 'login-id', 'userid', 'ten dang nhap', 'tai khoan', 'ten nguoi dung', 'nguoi dung'],
  ['password', 'pass', 'pwd', 'passcode', 'pin', 'mat khau'],
  ['login', 'log in', 'sign in', 'signin', 'submit', 'dang nhap', 'login-button', 'btn-login'],
  ['search', 'find', 'lookup', 'filter', 'query', 'keyword', 'tim kiem', 'tra cuu', 'loc'],
  ['add to cart', 'add to basket', 'buy now', 'add-to-cart', 'them vao gio', 'them vao gio hang', 'mua ngay', 'chon mua'],
  ['shopping cart', 'shopping-cart', 'shopping_cart', 'cart', 'basket', 'bag', 'gio hang', 'xem gio hang', 'shopping-cart-link'],
  ['checkout', 'continue', 'finish', 'order', 'place order', 'thanh toan', 'dat hang', 'tiep tuc', 'hoan tat'],
  ['close', 'cancel', 'dismiss', 'back', 'exit', 'dong', 'huy', 'bo qua', 'thoat', 'quay lai'],
  ['next', 'trang sau', 'sau', 'ke tiep', '>'],
  ['prev', 'previous', 'trang truoc', 'truoc', '<'],
];

function semanticMatch(candidateNorm: string, targetNorm: string): boolean {
  if (!candidateNorm || !targetNorm) return false;
  for (const group of SEMANTIC_SYNONYM_GROUPS) {
    const candidateInGroup = group.some(term => candidateNorm === term || candidateNorm.includes(term));
    const targetInGroup = group.some(term => targetNorm === term || targetNorm.includes(term));
    if (candidateInGroup && targetInGroup) return true;
  }
  return false;
}

function textMatches(candidate: string | undefined, target: string): boolean {
  const normalizedCandidate = normalizeText(candidate || '');
  const normalizedTarget = normalizeText(target || '');
  if (!normalizedCandidate || !normalizedTarget) return false;
  
  if (normalizedCandidate.includes(normalizedTarget) || normalizedTarget.includes(normalizedCandidate)) {
    return true;
  }
  return semanticMatch(normalizedCandidate, normalizedTarget);
}

const CONTEXT_WORDS = new Set([
  'bieu', 'co', 'cot', 'cua', 'du', 'duoi', 'duoc', 'hang', 'icon', 'la', 'ma',
  'nut', 'o', 'record', 'row', 'tai', 'thao', 'tac', 'tren', 'trong', 'tuong',
  'dong', 'lieu', 'to', 'chuc',
]);

function contextIdentifiers(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter(token => token && !CONTEXT_WORDS.has(token));
}

function rowMatchesContext(rowText: string | undefined, context: string): boolean {
  const normalizedRow = normalizeText(rowText || '');
  if (!normalizedRow || !context) return false;
  if (normalizedRow.includes(context) || context.includes(normalizedRow)) return true;

  const identifiers = contextIdentifiers(context);
  return identifiers.length > 0 && identifiers.every(token =>
    normalizedRow.split(' ').includes(token),
  );
}

function elementsForContext(
  elements: ElementInfo[],
  context: string,
): { elements: ElementInfo[]; rowContextRequired: boolean; rowContextMatched: boolean } {
  if (!context) {
    return { elements, rowContextRequired: false, rowContextMatched: false };
  }

  const identifiers = contextIdentifiers(context);
  const rowContextRequired = /(?:^| )(?:dong|hang|row|record)(?: |$)/.test(context) ||
    identifiers.some(token => /[a-z].*\d|\d.*[a-z]/.test(token));
  if (!rowContextRequired) {
    return { elements, rowContextRequired: false, rowContextMatched: false };
  }
  const scoped = elements.filter(element => rowMatchesContext(element.rowText, context));
  if (scoped.length > 0) {
    return { elements: scoped, rowContextRequired, rowContextMatched: true };
  }
  return { elements, rowContextRequired, rowContextMatched: false };
}

function uniqueVisibleMatch(
  elements: ElementInfo[],
  predicate: (element: ElementInfo) => boolean,
): ElementInfo | undefined {
  const matches = elements.filter(element => element.isVisible && predicate(element));
  const uniqueTargets = new Map<string, ElementInfo>();
  for (const element of matches) {
    const key = element.selector || JSON.stringify([
      element.tag,
      element.role,
      element.accessibleName,
      element.placeholder,
      element.text,
      element.id,
      element.name,
    ]);
    if (!uniqueTargets.has(key)) uniqueTargets.set(key, element);
  }
  return uniqueTargets.size === 1 ? [...uniqueTargets.values()][0] : undefined;
}

function canonicalOptionMatch(
  elements: ElementInfo[],
  target: string,
): ElementInfo | undefined {
  const scored = elements
    .filter(element =>
      element.isVisible &&
      Boolean(element.selector) &&
      (
        textMatches(element.text, target) ||
        textMatches(element.accessibleName, target) ||
        textMatches(element.dataValue, target)
      ),
    )
    .map(element => {
      const role = normalizeText(element.role || '');
      const slot = normalizeText(element.dataSlot || '');
      let score = 0;

      if (element.tag === 'option' || role === 'option') score += 100;
      else if (['menuitem', 'menuitemradio', 'menuitemcheckbox', 'treeitem'].includes(role)) score += 90;

      if (/(?:^| )(?:item|option)$/.test(slot)) score += 70;
      if (/(?:select|dropdown|command|combobox|listbox)/.test(slot)) score += 20;
      if (textMatches(element.dataValue, target)) score += 30;
      if (normalizeText(element.text || '') === target) score += 10;

      return { element, score };
    })
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) return undefined;
  if (scored.length > 1 && scored[0].score === scored[1].score) return undefined;
  return scored[0].element;
}

function canonicalDropdownMatch(
  elements: ElementInfo[],
  target: string,
): ElementInfo | undefined {
  const normalizedTarget = normalizeText(target);
  const exact = (value?: string) => normalizeText(value || '') === normalizedTarget;
  const withoutPrompt = (value?: string) => normalizeText(value || '')
    .replace(/^(?:chon|lua chon|select)\s+/, '');

  const scored = elements
    .filter(element =>
      element.isVisible &&
      Boolean(element.selector) &&
      (element.tag === 'select' || element.role === 'combobox' || element.ariaHasPopup === 'listbox'),
    )
    .map(element => {
      let score = 0;

      // The form label identifies the field. Its selected value may contain the
      // target text of a different dropdown (for example "Tổ chức tôn giáo"
      // versus the actual field labelled "Tôn giáo"), so label matches must win.
      if (exact(element.labelText)) score += 160;
      else if (textMatches(element.labelText, normalizedTarget)) score += 80;

      if (exact(element.ariaLabel) || exact(element.accessibleName)) score += 130;
      else if (
        textMatches(element.ariaLabel, normalizedTarget) ||
        textMatches(element.accessibleName, normalizedTarget)
      ) score += 45;

      if (exact(element.placeholder) || withoutPrompt(element.placeholder) === normalizedTarget) score += 120;
      else if (textMatches(element.placeholder, normalizedTarget)) score += 40;

      if (exact(element.text) || withoutPrompt(element.text) === normalizedTarget) score += 100;
      else if (textMatches(element.text, normalizedTarget)) score += 25;

      if (/select.*trigger|combobox|dropdown/.test(normalizeText(element.dataSlot || ''))) score += 30;
      if (element.ariaHasPopup === 'listbox') score += 15;
      if (element.scopeSelector) score += 10;

      return { element, score };
    })
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) return undefined;
  if (scored.length > 1 && scored[0].score === scored[1].score) return undefined;
  return scored[0].element;
}

function escapeSingleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function findIconElement(target: string, elements: ElementInfo[]): ElementInfo | undefined {
  let keywords: string[] = [];
  let needsPasswordNeighbor = false;

  if (target.includes('con mat') || target.includes('eye') || target.includes('mat khau')) {
    keywords = ['eye', 'password', 'mat khau', 'hien mat khau', 'an mat khau', 'toggle password'];
    needsPasswordNeighbor = true;
  } else if (target.includes('chinh sua') || target.includes('sua') || target.includes('edit') || target.includes('pencil')) {
    keywords = ['chinh sua', 'sua', 'edit', 'pencil'];
  } else if (target.includes('xoa') || target.includes('delete') || target.includes('trash')) {
    keywords = ['xoa', 'delete', 'trash'];
  } else if (target.includes('them') || target.includes('add') || target.includes('plus')) {
    keywords = ['them', 'add', 'plus'];
  }

  if (keywords.length === 0) return undefined;

  const scored = elements
    .filter(el => el.isVisible && el.selector)
    .map(el => {
      const semanticText = normalizeText([
        el.accessibleName,
        el.ariaLabel,
        el.title,
        el.testId,
        el.id,
        el.className,
        el.text,
      ].filter(Boolean).join(' '));
      const nearbyInput = normalizeText(el.nearbyInputPlaceholder || '');
      let score = keywords.reduce((total, keyword) => total + (semanticText.includes(keyword) ? 3 : 0), 0);
      if (needsPasswordNeighbor && nearbyInput.includes('mat khau')) score += 5;
      if (el.tag === 'button' || el.role === 'button') score += 2;
      if (el.tag === 'svg' || el.tag === 'i') score += 1;
      return { el, score };
    })
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.el;
}

/**
 * Phân giải mô tả phần tử thành locator Playwright
 * @param stepType Loại hành động (fill, click, select, check)
 * @param stepTarget Mô tả phần tử đích
 * @param dom Snapshot DOM để đối chiếu
 * @param stepContext Ngữ cảnh bổ sung
 * @param ariaRole ARIA role cụ thể từ Planner / Crawler (tab, button, link, sidebar, menuitem, textbox, combobox)
 * @returns Thông tin locator và độ tin cậy
 */
export function resolveLocator(
  stepType: string,
  stepTarget: string,
  dom?: DomSnapshot,
  stepContext?: string,
  ariaRole?: string,
): ResolvedLocator {
  const target = normalizeText(stepTarget);
  const context = normalizeText(stepContext || '');
  const explicitRole = ariaRole ? normalizeText(ariaRole) : '';
  const elements = dom?.elements || [];

  const guidedBinding = elements.find(element =>
    element.isVisible &&
    element.learnedStepType === stepType &&
    normalizeText(element.learnedTarget || '') === target &&
    (!element.learnedContext || normalizeText(element.learnedContext) === context) &&
    Boolean(element.learnedLocator),
  );
  if (guidedBinding?.learnedLocator) {
    return {
      locator: guidedBinding.learnedLocator,
      confidence: 'high',
      matchedBy: 'guided_learning',
      element: guidedBinding,
    };
  }

  const scoped = elementsForContext(elements, context);
  // A row identifier is a hard safety boundary. If TC010 was requested but no
  // captured row contains TC010, never fall back to the first pencil icon.
  if (scoped.rowContextRequired && !scoped.rowContextMatched) {
    return {
      locator: `page.getByText('${escapeSingleQuoted(stepTarget)}')`,
      confidence: 'low',
      matchedBy: 'row_context_not_found',
    };
  }
  const candidateElements = scoped.rowContextMatched ? scoped.elements : elements;

  // 1. Xử lý bước 'fill' (nhập liệu)
  if (stepType === 'fill') {
    // a. Tìm theo placeholder trên ô input/textarea thực sự (độ tin cậy cao)
    const byPlaceholder = uniqueVisibleMatch(candidateElements, el =>
      (el.tag === 'input' || el.tag === 'textarea') && textMatches(el.placeholder, target),
    );
    if (byPlaceholder && byPlaceholder.placeholder) {
      const safePl = escapeSingleQuoted(byPlaceholder.placeholder);
      return {
        locator: `page.getByPlaceholder('${safePl}').or(page.getByLabel('${safePl}')).first()`,
        confidence: 'high',
        matchedBy: 'placeholder',
        element: byPlaceholder
      };
    }

    // b. Tìm theo ariaLabel trên input/textarea (độ tin cậy cao)
    const byAriaLabel = uniqueVisibleMatch(candidateElements, el =>
      (el.tag === 'input' || el.tag === 'textarea') &&
      (textMatches(el.ariaLabel, target) || textMatches(el.labelText, target)),
    );
    if (byAriaLabel) {
      if (byAriaLabel.ariaLabel) {
        const safeLbl = escapeSingleQuoted(byAriaLabel.ariaLabel);
        return {
          locator: `page.getByPlaceholder('${safeLbl}').or(page.getByLabel('${safeLbl}')).first()`,
          confidence: 'high',
          matchedBy: 'ariaLabel',
          element: byAriaLabel
        };
      }
      if (byAriaLabel.selector) {
        return {
          locator: `page.locator('${escapeSingleQuoted(byAriaLabel.selector)}')`,
          confidence: 'high',
          matchedBy: 'verified_field_label',
          element: byAriaLabel,
        };
      }
    }

    // c. Tìm theo name trên input/textarea (độ tin cậy trung bình)
    const byName = uniqueVisibleMatch(candidateElements, el =>
      (el.tag === 'input' || el.tag === 'textarea') && textMatches(el.name, target),
    );
    if (byName && byName.name) {
      const safeN = escapeSingleQuoted(byName.name);
      return {
        locator: `page.locator('[name="${safeN}"]').or(page.getByPlaceholder('${safeN}')).or(page.getByLabel('${safeN}')).first()`,
        confidence: 'medium',
        matchedBy: 'name',
        element: byName
      };
    }

    // d. Tìm theo id trên input/textarea (chỉ lấy khi thực sự là input, bỏ qua React button trigger IDs)
    const byId = uniqueVisibleMatch(candidateElements, el =>
      (el.tag === 'input' || el.tag === 'textarea') &&
      !el.id?.startsWith('base-ui-') &&
      textMatches(el.id, target),
    );
    if (byId && byId.id) {
      const safeId = escapeSingleQuoted(byId.id);
      return {
        locator: `page.locator('#${safeId}').or(page.getByPlaceholder('${safeId}')).or(page.getByLabel('${safeId}')).first()`,
        confidence: 'medium',
        matchedBy: 'id',
        element: byId
      };
    }

    // e. Fallback nhập liệu: ưu tiên ô input text trên trang với chuỗi .or() đa tầng
    const cleanTarget = stepTarget.replace(/^['"]|['"]$/g, '').replace(/'/g, "\\'");
    return {
      locator: `page.getByPlaceholder('${cleanTarget}').or(page.getByLabel('${cleanTarget}')).or(page.locator('input[type="text"], input[type="search"], textarea')).first()`,
      confidence: 'medium',
      matchedBy: 'fallback_placeholder'
    };
  }

  // 2. Xử lý bước 'click' (nhấn)
  if (stepType === 'click') {
    const cleanTarget = stepTarget.replace(/^['"]|['"]$/g, '').replace(/'/g, "\\'");
    
    // a. Ưu tiên xử lý theo ariaRole cụ thể do Planner / Crawler chỉ định
    if (explicitRole === 'sidebar' || context?.toLowerCase().includes('sidebar')) {
      return {
        locator: `page.getByRole('link', { name: '${cleanTarget}' }).or(page.getByRole('button', { name: '${cleanTarget}' })).or(page.locator('aside, nav, ul, [role="navigation"]').getByText('${cleanTarget}')).first()`,
        confidence: 'high',
        matchedBy: 'explicit_aria_role_sidebar'
      };
    }
    // Hỗ trợ nút Phân trang: Trang sau (>) / Trang trước (<)
    if (/^(>|next|trang sau|sau)$/i.test(cleanTarget.trim())) {
      return {
        locator: `page.getByRole('button', { name: '>' }).or(page.locator('button:has-text(">"), [aria-label*="next" i], [title*="next" i], [data-slot*="next"]')).first()`,
        confidence: 'high',
        matchedBy: 'pagination_next'
      };
    }
    if (/^(<|prev|previous|trang truoc|trang trước|trước)$/i.test(cleanTarget.trim())) {
      return {
        locator: `page.getByRole('button', { name: '<' }).or(page.locator('button:has-text("<"), [aria-label*="prev" i], [title*="prev" i], [data-slot*="prev"]')).first()`,
        confidence: 'high',
        matchedBy: 'pagination_prev'
      };
    }
    // Hỗ trợ chọn số dòng/trang (Page Size)
    if (/số dòng\/trang|so dong\/trang|rows per page|page size|số dòng|\b\d+▼|\b\d+\s*▼|\b\d+\s*\/\s*trang/i.test(cleanTarget.trim())) {
      return {
        locator: `page.getByRole('combobox').or(page.locator('[data-slot="select-trigger"], select, [aria-haspopup="listbox"], button:has-text("▼"), button:has-text("/ trang")')).first()`,
        confidence: 'high',
        matchedBy: 'page_size_trigger'
      };
    }
    // Hỗ trợ nút Tìm kiếm (Search Button & Icon)
    if (/^(tìm kiếm|tim kiem|search|tìm)$/i.test(cleanTarget.trim())) {
      return {
        locator: `page.getByRole('button', { name: /tìm kiếm|search/i }).or(page.locator('button:has-text("Tìm kiếm"), button:has-text("Search"), button[type="submit"], button:has(svg), [aria-label*="tìm kiếm" i], [aria-label*="search" i], .btn-search')).first()`,
        confidence: 'high',
        matchedBy: 'search_button'
      };
    }
    // Hỗ trợ nút Lưu / Cập nhật Form
    if (/^(lưu|luu|lưu lại|save|cập nhật|cap nhat)$/i.test(cleanTarget.trim())) {
      return {
        locator: `page.getByRole('button', { name: /lưu|save|cập nhật/i }).or(page.locator('button:has-text("Lưu"), button:has-text("Save"), button[type="submit"], [aria-label*="lưu" i]')).first()`,
        confidence: 'high',
        matchedBy: 'save_button'
      };
    }
    // Hỗ trợ nút Hủy / Đóng Modal
    if (/^(hủy|huy|hủy bỏ|cancel|đóng|dong|close|không)$/i.test(cleanTarget.trim())) {
      return {
        locator: `page.getByRole('button', { name: /hủy|cancel|đóng|close/i }).or(page.locator('button:has-text("Hủy"), button:has-text("Cancel"), button:has-text("Đóng"), [aria-label*="close" i]')).first()`,
        confidence: 'high',
        matchedBy: 'cancel_button'
      };
    }
    // Hỗ trợ nút Xác nhận xóa / Đồng ý
    if (/^(xác nhận xóa|xac nhan xoa|xác nhận|xac nhan|đồng ý|dong y|delete confirm)$/i.test(cleanTarget.trim())) {
      return {
        locator: `page.getByRole('button', { name: /xác nhận|đồng ý|xóa/i }).or(page.locator('button:has-text("Xác nhận"), button:has-text("Đồng ý"), button.btn-danger, [data-slot*="confirm"]')).first()`,
        confidence: 'high',
        matchedBy: 'confirm_delete_button'
      };
    }
    // Hỗ trợ thao tác trên từng dòng / item / card theo Context
    if (context && context.trim().length > 1) {
      const cleanContext = context.trim().replace(/^['"]|['"]$/g, '').replace(/(?:dong|san pham|item|row|record|cua|tren)\s*/gi, '').trim();
      if (cleanContext) {
        return {
          locator: `page.locator('.inventory_item, [class*="card"], [class*="product"], tr, [role="row"], article, li').filter({ hasText: '${escapeSingleQuoted(cleanContext)}' }).getByRole('button', { name: '${cleanTarget}' }).or(page.locator('.inventory_item, [class*="card"], [class*="product"], tr, [role="row"], article, li').filter({ hasText: '${escapeSingleQuoted(cleanContext)}' }).locator('button, a, svg, [data-test*="cart"], [data-test*="add"], [data-test*="view"], [data-test*="${cleanTarget.toLowerCase().replace(/\\s+/g, '-')}"]')).or(page.locator('[data-test*="${cleanContext.toLowerCase().replace(/[^a-z0-9]+/g, '-')}"] [data-test*="add"], [data-test="add-to-cart-${cleanContext.toLowerCase().replace(/[^a-z0-9]+/g, '-')}"]')).first()`,
          confidence: 'high',
          matchedBy: 'container_action_context'
        };
      }
    }
    if (explicitRole === 'tab') {
      return {
        locator: `page.getByRole('tab', { name: '${cleanTarget}' }).or(page.getByRole('button', { name: '${cleanTarget}' })).or(page.getByRole('link', { name: '${cleanTarget}' })).first()`,
        confidence: 'high',
        matchedBy: 'explicit_aria_role_tab'
      };
    }
    if (explicitRole === 'button') {
      return {
        locator: `page.getByRole('button', { name: '${cleanTarget}' }).or(page.getByRole('tab', { name: '${cleanTarget}' })).or(page.getByRole('link', { name: '${cleanTarget}' })).or(page.locator('input[type="submit"][value="${cleanTarget}"], [data-test*="${cleanTarget}" i], #${cleanTarget}')).first()`,
        confidence: 'high',
        matchedBy: 'explicit_aria_role_button'
      };
    }
    if (explicitRole === 'link') {
      return {
        locator: `page.locator('[data-test="${cleanTarget}"], [data-testid="${cleanTarget}"], [data-test*="${cleanTarget}" i], [data-testid*="${cleanTarget}" i], a.${cleanTarget.replace(/-/g, '_')}, a.${cleanTarget}, a#${cleanTarget}').or(page.getByRole('link', { name: '${cleanTarget}' })).or(page.getByRole('button', { name: '${cleanTarget}' })).first()`,
        confidence: 'high',
        matchedBy: 'explicit_aria_role_link'
      };
    }
    if (explicitRole === 'menuitem') {
      return {
        locator: `page.getByRole('menuitem', { name: '${cleanTarget}' }).or(page.getByRole('button', { name: '${cleanTarget}' })).first()`,
        confidence: 'high',
        matchedBy: 'explicit_aria_role_menuitem'
      };
    }

    // b. Tìm button, link hoặc input submit có text/value/id/testId trùng khớp trong snapshot DOM (độ tin cậy cao)
    const isButtonOrLink = (el: ElementInfo) =>
      el.tag === 'button' ||
      el.tag === 'a' ||
      el.role === 'button' ||
      el.role === 'link' ||
      el.role === 'tab' ||
      el.role === 'menuitem' ||
      (el.tag === 'input' && /^(submit|button|reset|image)$/i.test(el.type || ''));

    const byText = uniqueVisibleMatch(candidateElements, el =>
      isButtonOrLink(el) && (
        textMatches(el.text, target) ||
        textMatches(el.accessibleName, target) ||
        textMatches(el.ariaLabel, target) ||
        textMatches(el.title, target) ||
        textMatches(el.dataValue, target) ||
        textMatches(el.id, target) ||
        textMatches(el.testId, target) ||
        textMatches(el.name, target)
      ),
    );
    
    if (byText) {
      const safeName = escapeSingleQuoted((byText.accessibleName || byText.text || byText.dataValue || cleanTarget).trim());
      if (byText.testId) {
        const safeTestId = escapeSingleQuoted(byText.testId);
        return {
          locator: `page.locator('[data-test="${safeTestId}"], [data-testid="${safeTestId}"]').or(page.getByRole('button', { name: '${safeName}' })).or(page.getByRole('link', { name: '${safeName}' })).first()`,
          confidence: 'high',
          matchedBy: 'testId',
          element: byText
        };
      }
      if (byText.tag === 'input' && byText.type === 'submit') {
        const safeId = byText.id ? escapeSingleQuoted(byText.id) : '';
        return {
          locator: `page.locator('input[type="submit"][value="${safeName}"], #${safeId || 'login-button'}, [data-test="${safeId || 'login-button'}"]').or(page.getByRole('button', { name: '${safeName}' })).first()`,
          confidence: 'high',
          matchedBy: 'input_submit',
          element: byText
        };
      }
      return {
        locator: `page.getByRole('tab', { name: '${safeName}' }).or(page.getByRole('button', { name: '${safeName}' })).or(page.getByRole('link', { name: '${safeName}' })).first()`,
        confidence: 'high',
        matchedBy: 'role+name+fallback',
        element: byText
      };
    }

    // Frameworks sometimes render a clickable div/span. Only use it when the
    // live snapshot provides a unique selector; never infer a CSS class.
    const byVerifiedInteractiveText = uniqueVisibleMatch(candidateElements, el =>
      Boolean(el.selector) &&
      (Boolean(el.ariaHasPopup) || el.role === 'button' || el.role === 'menuitem') &&
      (
        textMatches(el.text, target) ||
        textMatches(el.accessibleName, target) ||
        textMatches(el.ariaLabel, target)
      ),
    );
    if (byVerifiedInteractiveText?.selector) {
      const safeText = escapeSingleQuoted((byVerifiedInteractiveText.text || cleanTarget).trim());
      return {
        locator: `page.locator('${escapeSingleQuoted(byVerifiedInteractiveText.selector)}').or(page.getByRole('button', { name: '${safeText}' })).or(page.getByRole('tab', { name: '${safeText}' })).first()`,
        confidence: 'high',
        matchedBy: 'verified_interactive_text',
        element: byVerifiedInteractiveText,
      };
    }

    // c. Icon chỉ được resolve khi snapshot DOM cung cấp bằng chứng thực tế.
    const iconElement = findIconElement(target, candidateElements);
    if (iconElement?.selector) {
      const safeSelector = iconElement.selector.replace(/'/g, "\\'");
      const hasAccessibleEvidence = Boolean(iconElement.ariaLabel || iconElement.accessibleName || iconElement.testId);
      return {
        locator: `page.locator('${safeSelector}').or(page.getByRole('button', { name: '${cleanTarget}' })).or(page.getByRole('link', { name: '${cleanTarget}' })).first()`,
        confidence: hasAccessibleEvidence ? 'high' : 'medium',
        matchedBy: 'dom_icon_metadata',
        element: iconElement
      };
    }

    // d. Tìm theo ariaLabel (độ tin cậy trung bình)
    const byAriaLabel = uniqueVisibleMatch(candidateElements, el => textMatches(el.ariaLabel, target));
    if (byAriaLabel && byAriaLabel.ariaLabel) {
      const safeLabel = byAriaLabel.ariaLabel.replace(/'/g, "\\'");
      return {
        locator: `page.getByRole('tab', { name: '${safeLabel}' }).or(page.getByRole('button', { name: '${safeLabel}' })).or(page.getByRole('link', { name: '${safeLabel}' })).first()`,
        confidence: 'medium',
        matchedBy: 'ariaLabel',
        element: byAriaLabel
      };
    }

    // e. Tìm link có text (độ tin cậy trung bình)
    const linkByText = candidateElements.find(el => (el.tag === 'a' || el.role === 'link') && el.text && normalizeText(el.text).includes(target));
    if (linkByText && linkByText.text) {
      const safeName = linkByText.text.trim().replace(/'/g, "\\'");
      return {
        locator: `page.getByRole('link', { name: '${safeName}' }).or(page.getByRole('button', { name: '${safeName}' })).first()`,
        confidence: 'medium',
        matchedBy: 'link_name',
        element: linkByText
      };
    }

    // f. Fallback an toàn (Chỉ dùng interactive roles: tab, button, link - KHÔNG dùng getByText)
    return {
      locator: `page.getByRole('tab', { name: '${cleanTarget}' }).or(page.getByRole('button', { name: '${cleanTarget}' })).or(page.getByRole('link', { name: '${cleanTarget}' })).first()`,
      confidence: 'low',
      matchedBy: 'fallback_interactive_roles'
    };
  }

  // 3. Xử lý bước 'select' (chọn dropdown)
  if (stepType === 'select') {
    const cleanTarget = stepTarget.replace(/^['"]|['"]$/g, '').replace(/'/g, "\\'");

    // a. Rank real interactive triggers. An exact field label beats a selected
    // value that merely contains the same words.
    const dropdown = canonicalDropdownMatch(candidateElements, target);
    if (dropdown) {
      if (dropdown.selector) {
        return {
          locator: `page.locator('${escapeSingleQuoted(dropdown.selector)}')`,
          confidence: 'high',
          matchedBy: 'verified_dropdown_trigger',
          element: dropdown,
        };
      }
    }

    // Never emit a <label> as a dropdown trigger: clicking the label may do
    // nothing while a later manual click makes the crawl look successful.

    return {
      locator: `page.getByRole('combobox', { name: '${cleanTarget}' })`,
      confidence: 'low',
      matchedBy: 'fallback_dropdown'
    };
  }

  // 4. Resolve an option only after the Crawler opened the dropdown and
  // captured the overlay/listbox state.
  if (stepType === 'option') {
    const option = canonicalOptionMatch(candidateElements, target);
    if (option) {
      if (option.role === 'option' || option.tag === 'option') {
        const safeName = escapeSingleQuoted((option.accessibleName || option.text || stepTarget).trim());
        return {
          locator: `page.getByRole('option', { name: '${safeName}', exact: true })`,
          confidence: 'high',
          matchedBy: 'verified_option',
          element: option,
        };
      }
      if (option.selector) {
        return {
          locator: `page.locator('${escapeSingleQuoted(option.selector)}')`,
          confidence: 'high',
          matchedBy: 'verified_option_selector',
          element: option,
        };
      }
    }

    const verifiedTextOption = uniqueVisibleMatch(candidateElements, el =>
      Boolean(el.selector) && textMatches(el.text, target),
    );
    if (verifiedTextOption?.selector) {
      return {
        locator: `page.locator('${escapeSingleQuoted(verifiedTextOption.selector)}')`,
        confidence: 'medium',
        matchedBy: 'verified_option_text',
        element: verifiedTextOption,
      };
    }
    return {
      locator: `page.getByRole('option', { name: '${escapeSingleQuoted(stepTarget)}', exact: true })`,
      confidence: 'low',
      matchedBy: 'fallback_option',
    };
  }

  // 5. Xử lý bước 'check' (kiểm tra/assert)
  if (stepType === 'check') {
    const originalTarget = stepTarget.replace(/^['"]|['"]$/g, '');
    const safeOriginal = originalTarget.replace(/'/g, "\\'");
    
    if (target.includes('url khong con chua')) {
      const match = stepTarget.match(/['"](.*?)['"]/);
      const slug = match ? match[1] : 'dang-nhap';
      return {
        locator: `await expect(page).not.toHaveURL(/.*${slug}.*/i);`,
        confidence: 'high',
        matchedBy: 'assert_url_not_contains'
      };
    }
    if (target.includes('url chua')) {
      const match = stepTarget.match(/['"](.*?)['"]/);
      const slug = match ? match[1] : 'dang-nhap';
      return {
        locator: `await expect(page).toHaveURL(/.*${slug}.*/i);`,
        confidence: 'high',
        matchedBy: 'assert_url_contains'
      };
    }
    if (target.includes('thong bao co chu') || target.includes('hien thi text') || target.includes('xuat hien') || target.includes('co thong bao')) {
      const match = stepTarget.match(/['"](.*?)['"]/);
      const textToFind = match ? match[1] : originalTarget;
      const safeText = textToFind.replace(/'/g, "\\'");
      return {
        locator: `await expect(page.getByText('${safeText}').first()).toBeVisible();`,
        confidence: 'high',
        matchedBy: 'assert_text_visible'
      };
    }
    if (
      target.includes('mat khau dang an') ||
      target.includes('mat khau quay lai dang an') ||
      target.includes('mat khau bi an')
    ) {
      return {
        locator: `await expect(page.getByPlaceholder('Nhập mật khẩu').or(page.getByLabel('Nhập mật khẩu')).first()).toHaveAttribute('type', 'password');`,
        confidence: 'high',
        matchedBy: 'assert_password_hidden'
      };
    }
    if (
      target.includes('mat khau dang van ban') ||
      target.includes('mat khau chuyen sang dang van ban') ||
      (target.includes('mat khau') && target.includes('doc duoc'))
    ) {
      return {
        locator: `await expect(page.getByPlaceholder('Nhập mật khẩu').or(page.getByLabel('Nhập mật khẩu')).first()).toHaveAttribute('type', 'text');`,
        confidence: 'high',
        matchedBy: 'assert_password_visible'
      };
    }
    
    // Fallback assert
    return {
      locator: `await expect(page.getByText('${safeOriginal}').first()).toBeVisible();`,
      confidence: 'low',
      matchedBy: 'fallback_assert'
    };
  }

  // Mặc định trả về theo role tab/button/link kết hợp .first() nếu không xác định được loại (KHÔNG dùng getByText)
  const safeTarget = stepTarget.replace(/^['"]|['"]$/g, '').replace(/'/g, "\\'");
  return {
    locator: `page.getByRole('tab', { name: '${safeTarget}' }).or(page.getByRole('button', { name: '${safeTarget}' })).or(page.getByRole('link', { name: '${safeTarget}' })).first()`,
    confidence: 'low',
    matchedBy: 'default_role_fallback'
  };
}
