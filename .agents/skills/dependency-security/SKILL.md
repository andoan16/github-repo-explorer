---
name: dependency-security
description: >-
  Tự động quét lỗ hổng thư viện phụ thuộc (Software Composition Analysis - SCA) và phát hiện bí mật (Secret Detection)
  dựa trên Aqua Security Trivy (aquasecurity/trivy). Sử dụng skill này để rà soát các tệp khai báo thư viện
  (package.json, pom.xml, go.mod, requirements.txt, Cargo.toml), phát hiện các CVE đã công bố, tìm kiếm API key / token
  bị hardcode và tự động nâng cấp version an toàn hoặc trích xuất bí mật ra biến môi trường.
---

# Dependency Security & Secret Auditing Skill (Trivy-Inspired)

Skill này cung cấp quy trình tự động rà soát an toàn phần mềm chuỗi cung ứng (Software Supply Chain Security) và dò tìm bí mật nhạy cảm (Secret Scanning), kế thừa triết lý từ công cụ bảo mật hàng đầu [Aqua Security Trivy](https://github.com/aquasecurity/trivy).

Mục tiêu cốt lõi: **Chủ động phát hiện các CVE trong thư viện phụ thuộc và các secret/token bị lộ, sau đó tự động nâng cấp phiên bản không có lỗ hổng (safe patch version) và trích xuất bí mật sang biến môi trường một cách an toàn mà không làm hỏng ứng dụng.**

---

## 1. Cơ chế hoạt động (Trivy SCA & Secret Scanning Workflow)

```mermaid
flowchart TD
    A["1. Kích hoạt rà soát bảo mật Dependency"] --> B["2. Quét Manifest Thư viện & Secret"]
    B --> C["2A. Phân tích CVE Thư viện<br/>(package.json, pom.xml, go.mod, ...)"]
    B --> D["2B. Quét Hardcoded Secrets & API Keys<br/>(High entropy, regex tokens, private keys)"]
    C --> E{"Có CVE được công bố?"}
    D --> F{"Có Secret bị hardcode?"}
    E -- "Có" --> G["3A. Xác định Phiên bản Vá Tối thiểu (Patched Version)"]
    G --> H["Cập nhật Manifest & Lockfile"]
    F -- "Có" --> I["3B. Trích xuất Secret sang .env & Config Loader"]
    H --> J["4. Chạy Regression Test Suite"]
    I --> J
    J --> K{"Toàn bộ test pass?"}
    K -- "PASS" --> L["5. Xuất Báo cáo Khắc phục (Remediation Report)"]
    K -- "FAIL" --> M["Điều chỉnh Compatibility hoặc Adapter Code"]
    M --> J
```

---

## 2. Nhận diện Manifest & Lệnh Quét CVE theo Hệ sinh thái

Agent tự động nhận diện các tệp manifest và chạy lệnh rà soát tương ứng:

| Hệ sinh thái | Tệp Manifest | Lệnh Quét Chuyên dụng | Lệnh Quét bằng Trivy CLI (nếu có) |
| :--- | :--- | :--- | :--- |
| **Node.js** | `package.json`, `package-lock.json` | `npm audit --json` hoặc `pnpm audit` | `trivy fs --scanners vuln .` |
| **Java (Maven)** | `pom.xml` | `mvn dependency-check:check` | `trivy fs --scanners vuln pom.xml` |
| **Go** | `go.mod`, `go.sum` | `govulncheck ./...` | `trivy fs --scanners vuln go.mod` |
| **Python** | `requirements.txt`, `pyproject.toml` | `pip-audit` | `trivy fs --scanners vuln requirements.txt` |
| **Rust** | `Cargo.toml`, `Cargo.lock` | `cargo audit` | `trivy fs --scanners vuln Cargo.toml` |

> [!TIP]
> Nếu máy tính đã cài đặt Trivy CLI (`trivy --version`), hãy ưu tiên chạy:
> ```bash
> trivy fs --scanners vuln,secret --severity HIGH,CRITICAL --format json -o trivy-results.json .
> ```
> Nếu chưa cài đặt Trivy CLI, agent sử dụng scanner nội bộ (built-in audit commands như `npm audit`, `govulncheck`, kết hợp kiểm tra NVD/GitHub Advisory).

---

## 3. Quy tắc Rà soát Bí mật (Secret & API Key Detection)

Dựa trên bộ quy tắc quét secret của Trivy, agent chủ động phát hiện các mẫu chuỗi nhạy cảm sau trong toàn bộ codebase:

1. **Cloud & Platform Credentials**:
   - AWS Access Key ID (`AKIA[0-9A-Z]{16}`) & Secret Key
   - Google Cloud API Key (`AIza[0-9A-Za-z\\-_]{35}`)
   - Azure Connection String
2. **Developer & Git Tokens**:
   - GitHub Personal Access Token (`ghp_[a-zA-Z0-9]{36}`, `github_pat_[a-zA-Z0-9_]{82}`)
   - GitLab Personal Access Token (`glpat-[a-zA-Z0-9\\-_]{20}`)
   - Slack Webhook / Bot Token (`xoxb-[0-9]{11}-[0-9]{11}-[a-zA-Z0-9]{24}`)
3. **Database & Private Keys**:
   - Chuỗi kết nối Database chứa mật khẩu: `postgres://user:password@host:port/db`, `mongodb+srv://...`
   - Private Key blocks: `-----BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY-----`
   - JWT Secret cứng trong code: `jwt.sign(payload, "my-hardcoded-secret-123")`

---

## 4. Quy trình Tự động Khắc phục (Auto-Remediation Runbook)

### Bước 1: Nâng cấp Phiên bản Thư viện An toàn (Dependency Patching)

Khi phát hiện CVE trong thư viện phụ thuộc:

1. **Xác định phiên bản vá an toàn (Fixed Version)**:
   - Tra cứu trường `"fixedIn"` hoặc advisory recommendations (ví dụ: thư viện `axios` version `<= 1.7.3` bị lỗ hổng SSRF CVE-2024-39338, version an toàn tối thiểu là `1.7.4`).
2. **Quy tắc Semver an toàn**:
   - Ưu tiên cập nhật phiên bản **Patch** (x.y.**Z**) hoặc **Minor** (x.**Y**.z) để giữ tính tương thích ngược, tránh break API.
   - Nếu bắt buộc phải nâng lên bản **Major** (breaking changes), kiểm tra ngay các vị trí sử dụng hàm trong codebase và cập nhật lại call site.
3. **Cập nhật Manifest & Lockfile**:
   - Sử dụng `edit_file` để cập nhật số phiên bản trong tệp manifest (`package.json`, `pom.xml`, `go.mod`,...).
   - Chạy lệnh cập nhật lockfile đồng bộ:
     ```bash
     # Với Node.js
     npm install --package-lock-only # hoặc npm update <package-name>
     # Với Go
     go get <package>@vX.Y.Z && go mod tidy
     # Với Maven
     mvn clean compile
     ```

---

### Bước 2: Trích xuất Secret ra Biến Môi trường (Secret Remediation)

Khi phát hiện API key hoặc secret bị hardcode trong source code:

1. **Tạo/Cập nhật tệp `.env`**:
   - Chuyển giá trị nhạy cảm vào `.env` (đảm bảo `.env` nằm trong `.gitignore`):
     ```bash
     GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
     DATABASE_URL=postgres://user:password@localhost:5432/mydb
     ```
2. **Tạo `.env.example`** (mẫu không chứa giá trị thật để commit vào Git):
   ```bash
   GITHUB_TOKEN=your_github_token_here
   DATABASE_URL=postgres://user:password@localhost:5432/mydb
   ```
3. **Sửa code đọc từ biến môi trường**:
   - Thay thế trực tiếp chuỗi hardcode bằng trình nạp cấu hình:
     ```typescript
     // Trước khi vá:
     const apiKey = "ghp_xxxxxxxxxxxxxxxxxxxx";
     
     // Sau khi vá:
     const apiKey = process.env.GITHUB_TOKEN;
     if (!apiKey) {
       throw new Error("Missing required environment variable: GITHUB_TOKEN");
     }
     ```

---

### Bước 3: Kiểm thử Chống Hồi quy (Zero Regression Verification)

Sau khi nâng cấp phiên bản thư viện hoặc trích xuất secret:
1. Chạy test suite của dự án (`npm test`, `npm run build`, `go test ./...`).
2. Nếu xuất hiện lỗi biên dịch hoặc lỗi kiểm thử do breaking changes của thư viện mới:
   - Đọc stack trace lỗi.
   - Điều chỉnh code gọi hàm theo chuẩn của phiên bản mới.
   - Chạy lại test cho đến khi 100% tests pass.

---

## 5. Mẫu Báo cáo Khắc phục Thư viện & Bí mật (Remediation Report)

Sau khi hoàn tất quá trình rà soát và vá lỗi, agent xuất báo cáo chi tiết:

```markdown
# 📦 Dependency & Secret Remediation Report

### Tổng quan
- **Công cụ tham chiếu**: Aqua Security Trivy / Native Manifest Auditing
- **Số CVE phát hiện**: X (Y Critical, Z High)
- **Số Secret hardcode phát hiện**: N
- **Trạng thái khắc phục**: ĐÃ CẬP NHẬT & VÁ HOÀN TẤT (100%)

---

### 1. Chi tiết Lỗ hổng Thư viện đã Khắc phục
| Thư viện | Phiên bản cũ | Phiên bản an toàn | Mã CVE / Advisory | Mức độ | Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `dompurify` | `3.0.5` | `^3.2.4` | CVE-2024-45801 (XSS Bypass) | HIGH | **Đã nâng cấp** |
| `cross-spawn` | `7.0.3` | `^7.0.6` | CVE-2024-21538 (ReDoS / RCE) | HIGH | **Đã nâng cấp** |

### 2. Chi tiết Secret đã Trích xuất
- **Tập tin**: `src/config/githubClient.ts:12`
- **Loại Secret**: GitHub Personal Access Token (`ghp_***`)
- **Giải pháp**:
  - Đã chuyển secret sang biến môi trường `GITHUB_PERSONAL_ACCESS_TOKEN` trong `.env`.
  - Đã tạo template mẫu tại `.env.example`.
  - Đã cập nhật code nạp qua `process.env`.

### 3. Kết quả Kiểm thử Hồi quy
- `npm test`: **PASSED (Exit Code: 0)**
- `npm run build`: **SUCCESS**
```
