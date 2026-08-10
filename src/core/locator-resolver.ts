export interface ElementInfo {
  tag: string;
  type?: string;
  role?: string;
  placeholder?: string;
  ariaLabel?: string;
  text?: string;
  testId?: string;
  id?: string;
  name?: string;
  className?: string;
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
    .replace(/^['"]|['"]$/g, ''); // Bỏ dấu nháy ở đầu và cuối nếu có
}

/**
 * Phân giải mô tả phần tử thành locator Playwright
 * @param stepType Loại hành động (fill, click, select, check)
 * @param stepTarget Mô tả phần tử đích
 * @param dom Snapshot DOM để đối chiếu
 * @returns Thông tin locator và độ tin cậy
 */
export function resolveLocator(
  stepType: string,
  stepTarget: string,
  dom?: DomSnapshot
): ResolvedLocator {
  const target = normalizeText(stepTarget);
  const elements = dom?.elements || [];

  // 1. Xử lý bước 'fill' (nhập liệu)
  if (stepType === 'fill') {
    // a. Tìm theo placeholder (độ tin cậy cao)
    const byPlaceholder = elements.find(el => el.placeholder && normalizeText(el.placeholder).includes(target));
    if (byPlaceholder && byPlaceholder.placeholder) {
      return {
        locator: `page.getByPlaceholder('${byPlaceholder.placeholder}')`,
        confidence: 'high',
        matchedBy: 'placeholder'
      };
    }

    // b. Tìm theo ariaLabel (độ tin cậy cao)
    const byAriaLabel = elements.find(el => el.ariaLabel && normalizeText(el.ariaLabel).includes(target));
    if (byAriaLabel && byAriaLabel.ariaLabel) {
      return {
        locator: `page.getByLabel('${byAriaLabel.ariaLabel}')`,
        confidence: 'high',
        matchedBy: 'ariaLabel'
      };
    }

    // c. Tìm theo name (độ tin cậy trung bình)
    const byName = elements.find(el => el.name && normalizeText(el.name).includes(target));
    if (byName && byName.name) {
      return {
        locator: `page.locator('[name="${byName.name}"]')`,
        confidence: 'medium',
        matchedBy: 'name'
      };
    }

    // d. Tìm theo id (độ tin cậy trung bình)
    const byId = elements.find(el => el.id && normalizeText(el.id).includes(target));
    if (byId && byId.id) {
      return {
        locator: `page.locator('#${byId.id}')`,
        confidence: 'medium',
        matchedBy: 'id'
      };
    }

    // e. Fallback nhập liệu (dùng getByPlaceholder kết hợp getByLabel và first)
    const cleanTarget = stepTarget.replace(/^['"]|['"]$/g, '').replace(/'/g, "\\'");
    return {
      locator: `page.getByPlaceholder('${cleanTarget}').or(page.getByLabel('${cleanTarget}')).first()`,
      confidence: 'low',
      matchedBy: 'fallback_placeholder'
    };
  }

  // 2. Xử lý bước 'click' (nhấn)
  if (stepType === 'click') {
    const cleanTarget = stepTarget.replace(/^['"]|['"]$/g, '').replace(/'/g, "\\'");
    
    // a. Tìm button hoặc link có text trùng khớp (độ tin cậy cao)
    const isButtonOrLink = (el: ElementInfo) => el.tag === 'button' || el.tag === 'a' || el.role === 'button' || el.role === 'link';
    const byText = elements.find(el => isButtonOrLink(el) && el.text && (normalizeText(el.text).includes(target) || target.includes(normalizeText(el.text))));
    
    if (byText && byText.text) {
      const role = (byText.tag === 'a' || byText.role === 'link') ? 'link' : 'button';
      const safeName = byText.text.trim().replace(/'/g, "\\'");
      return {
        locator: `page.getByRole('${role}', { name: '${safeName}' })`,
        confidence: 'high',
        matchedBy: 'role+name'
      };
    }

    // b. Xử lý các icon đặc biệt (độ tin cậy trung bình)
    if (target.includes('icon') || target.includes('con mat') || target.includes('sua') || target.includes('xoa') || target.includes('them')) {
      if (target.includes('con mat') || target.includes('eye')) {
        return {
          locator: `page.locator('.lucide-eye, .lucide-eye-off, [class*="eye"]').first()`,
          confidence: 'medium',
          matchedBy: 'icon_class'
        };
      }
      if (target.includes('sua') || target.includes('edit')) {
        return {
          locator: `page.locator('.lucide-pencil, [class*="edit"]').first()`,
          confidence: 'medium',
          matchedBy: 'icon_class'
        };
      }
      if (target.includes('xoa') || target.includes('delete') || target.includes('trash')) {
        return {
          locator: `page.locator('.lucide-trash, [class*="delete"]').first()`,
          confidence: 'medium',
          matchedBy: 'icon_class'
        };
      }
    }

    // c. Tìm theo ariaLabel (độ tin cậy trung bình)
    const byAriaLabel = elements.find(el => el.ariaLabel && (normalizeText(el.ariaLabel).includes(target) || target.includes(normalizeText(el.ariaLabel))));
    if (byAriaLabel && byAriaLabel.ariaLabel) {
      const safeLabel = byAriaLabel.ariaLabel.replace(/'/g, "\\'");
      return {
        locator: `page.getByLabel('${safeLabel}')`,
        confidence: 'medium',
        matchedBy: 'ariaLabel'
      };
    }

    // d. Tìm link có text (độ tin cậy trung bình)
    const linkByText = elements.find(el => (el.tag === 'a' || el.role === 'link') && el.text && normalizeText(el.text).includes(target));
    if (linkByText && linkByText.text) {
      const safeName = linkByText.text.trim().replace(/'/g, "\\'");
      return {
        locator: `page.getByRole('link', { name: '${safeName}' })`,
        confidence: 'medium',
        matchedBy: 'link_name'
      };
    }

    // e. Fallback an toàn (Ưu tiên getByRole button -> fallback getByText với .first() tránh strict mode)
    return {
      locator: `page.getByRole('button', { name: '${cleanTarget}' }).or(page.getByText('${cleanTarget}')).first()`,
      confidence: 'low',
      matchedBy: 'fallback_role_button'
    };
  }

  // 3. Xử lý bước 'select' (chọn dropdown)
  if (stepType === 'select') {
    const cleanTarget = stepTarget.replace(/^['"]|['"]$/g, '').replace(/'/g, "\\'");
    
    // a. Tìm combobox hoặc select có ariaLabel (độ tin cậy cao)
    const byAriaLabel = elements.find(el => (el.tag === 'select' || el.role === 'combobox') && el.ariaLabel && normalizeText(el.ariaLabel).includes(target));
    if (byAriaLabel && byAriaLabel.ariaLabel) {
      const safeLabel = byAriaLabel.ariaLabel.replace(/'/g, "\\'");
      return {
        locator: `page.getByLabel('${safeLabel}')`,
        confidence: 'high',
        matchedBy: 'ariaLabel'
      };
    }

    // b. Tìm phần tử có text khớp với nhãn dropdown (độ tin cậy trung bình)
    const byLabelText = elements.find(el => el.text && normalizeText(el.text).includes(target));
    if (byLabelText && byLabelText.text) {
      const safeText = byLabelText.text.trim().replace(/'/g, "\\'");
      return {
        locator: `page.getByText('${safeText}').first()`,
        confidence: 'medium',
        matchedBy: 'text'
      };
    }

    // c. Fallback cho dropdown (dùng getByText().first())
    return {
      locator: `page.getByText('${cleanTarget}').or(page.getByRole('combobox', { name: '${cleanTarget}' })).first()`,
      confidence: 'low',
      matchedBy: 'fallback_dropdown'
    };
  }

  // 4. Xử lý bước 'check' (kiểm tra/assert)
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
        locator: `await expect(page.getByText('${safeText}')).toBeVisible();`,
        confidence: 'high',
        matchedBy: 'assert_text_visible'
      };
    }
    if (target.includes('mat khau dang an')) {
      return {
        locator: `await expect(page.getByPlaceholder('Nhập mật khẩu')).toHaveAttribute('type', 'password');`,
        confidence: 'high',
        matchedBy: 'assert_password_hidden'
      };
    }
    if (target.includes('mat khau dang van ban')) {
      return {
        locator: `await expect(page.getByPlaceholder('Nhập mật khẩu')).toHaveAttribute('type', 'text');`,
        confidence: 'high',
        matchedBy: 'assert_password_visible'
      };
    }
    
    // Fallback assert
    return {
      locator: `await expect(page.locator('body')).toContainText('${safeOriginal}');`,
      confidence: 'low',
      matchedBy: 'fallback_assert'
    };
  }

  // Mặc định trả về theo text nếu không xác định được loại
  return {
    locator: `page.getByText('${stepTarget.replace(/^['"]|['"]$/g, '')}')`,
    confidence: 'low',
    matchedBy: 'unknown_step_type'
  };
}
