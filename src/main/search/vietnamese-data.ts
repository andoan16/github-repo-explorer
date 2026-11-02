/**
 * Static dictionaries, tech terms, synonyms, and intent patterns for Vietnamese search.
 * Extracted from vietnamese.ts for clean separation of data assets from algorithms.
 */
import type { WeightEmphasis } from "../../shared/types";
import type { DetectedRefinement } from "./refinement-parser";

export const VIETNAMESE_TECH_DICTIONARY: Record<string, string[]> = {
  // ── Infrastructure / DevOps ──
  'giám sát': ['monitoring', 'observability'],
  'máy chủ': ['server', 'host'],
  'tự host': ['self-hosted', 'self-host'],
  'tự chạy': ['self-hosted', 'self-host'],
  'riêng tư': ['self-hosted', 'private'],
  'triển khai': ['deployment', 'deploy'],
  'vận hành': ['operations', 'ops'],
  'mạng': ['network', 'networking'],
  'đám mây': ['cloud'],
  'máy ảo': ['virtual machine', 'vm'],
  'phân tán': ['distributed', 'cluster'],
  'khám': ['discovery', 'service-discovery'],
  'cân bằng tải': ['load balancer', 'load-balancing'],
  'tường lửa': ['firewall'],

  // ── CI/CD ──
  'tích hợp liên tục': ['continuous integration', 'ci-cd'],
  'triển khai liên tục': ['continuous deployment', 'ci-cd'],
  'đường ống': ['pipeline', 'ci-cd'],
  'ống dẫn': ['pipeline', 'ci-cd'],
  'xây dựng': ['build', 'ci'],
  'kiểm thử': ['testing', 'test'],

  // ── Security ──
  'bảo mật': ['security', 'secure'],
  'mật khẩu': ['password', 'credential'],
  'quản lý mật khẩu': ['password manager', 'credential management'],
  'quản lý bí mật': ['secret management', 'secrets'],
  'bí mật': ['secret', 'secrets'],
  'mã hóa': ['encryption', 'crypto', 'tls'],
  'chứng thực': ['authentication', 'auth', 'login'],
  'phân quyền': ['authorization', 'rbac', 'permissions'],
  'an toàn': ['security', 'safety'],

  // ── Data / Database ──
  'cơ sở dữ liệu': ['database', 'db'],
  'dữ liệu': ['data'],
  'kho dữ liệu': ['data warehouse', 'data-warehouse'],
  'sao lưu': ['backup', 'backup-restore'],
  'khôi phục': ['recovery', 'disaster-recovery'],
  'truy vấn': ['query'],
  'lưu trữ': ['storage', 'cache'],
  'bộ nhớ đệm': ['cache', 'caching'],

  // ── Development ──
  'lập trình': ['programming', 'development'],
  'ngôn ngữ lập trình': ['programming language'],
  'thư viện': ['library'],
  'khung': ['framework'],
  'phát triển': ['development'],
  'mã nguồn mở': ['open source', 'open-source'],
  'mã nguồn': ['source code'],
  'gói': ['package', 'module'],
  'đóng gói': ['package', 'packaging'],
  'gỡ lỗi': ['debugging', 'debugger'],
  'biên dịch': ['compiler', 'compilation'],

  // ── Observability ──
  'nền tảng quan sát': ['observability platform', 'monitoring'],
  'theo dõi': ['monitoring', 'tracking'],
  'nhật ký': ['logging', 'logs'],
  'chỉ số': ['metrics'],
  'tracing': ['tracing', 'distributed-tracing'],

  // ── AI / ML (was missing) ──
  'trí tuệ nhân tạo': ['artificial intelligence', 'ai'],
  'học máy': ['machine learning', 'ml'],
  'học sâu': ['deep learning'],
  'mô hình ngôn ngữ': ['language model', 'llm'],
  'xử lý ngôn ngữ tự nhiên': ['nlp', 'natural language processing'],
  'thị giác máy tính': ['computer vision'],
  'tạo sinh': ['generative', 'generative-ai'],
  'huấn luyện': ['training', 'train'],
  'suy luận': ['inference'],
  'mô hình': ['model'],

  // ── Web / Mobile (was missing) ──
  'trang web': ['website', 'web'],
  'ứng dụng web': ['web app', 'web-application'],
  'ứng dụng di động': ['mobile app', 'mobile'],
  'giao diện dòng lệnh': ['cli', 'command-line'],
  'giao diện người dùng': ['ui', 'user-interface'],
  'giao diện lập trình': ['api', 'rest-api'],

  // ── Common modifiers (was missing) ──
  'nhẹ': ['lightweight'],
  'nhanh': ['fast', 'high-performance'],
  'mạnh mẽ': ['powerful'],
  'đơn giản': ['simple', 'minimal'],
  'ổn định': ['stable', 'reliable'],
  'phổ biến': ['popular'],
  'miễn phí': ['free', 'open-source'],
  'mới nhất': ['latest', 'newest'],
  'thay thế': ['alternative', 'replace'],
  'giải pháp': ['solution'],
  'chạy': ['run', 'runner', 'execute'],

  // ── Infrastructure (was missing) ──
  'hạ tầng': ['infrastructure', 'infra'],
  'cung cấp': ['provisioning'],
  'điều phối': ['orchestration'],
  'vùng chứa': ['container', 'docker'],
  'phục hồi': ['recovery', 'restore'],
  'tự quản lý': ['self-hosted', 'self-managed'],
  'tại chỗ': ['on-premise', 'self-hosted'],

  // ── Workflow / Security (was missing) ──
  'quy trình': ['workflow', 'pipeline'],
  'tự động hóa': ['automation'],
  'cảnh báo': ['alerting', 'alert'],
  'đo lường': ['metrics'],
  'tường lửa ứng dụng': ['waf', 'web-application-firewall'],
  'quét lỗ hổng': ['vulnerability scanner', 'security-scanner'],

  // ── Containerization ──
  'container': ['container', 'docker'],
  'công cụ container': ['container tool', 'docker'],

  // ── Tech terms (English, often mixed into Vietnamese queries) ──
  // These normalize common abbreviations and tech terms
  'ci/cd': ['ci-cd', 'continuous integration'],
  'ci-cd': ['ci-cd', 'continuous integration'],
  'cicd': ['ci-cd', 'continuous integration'],
  'devops': ['devops', 'devsecops'],
  'kubernetes': ['kubernetes', 'k8s'],
  'docker': ['docker', 'containerization'],
  'terraform': ['terraform', 'infrastructure-as-code'],
  'golang': ['go', 'golang'],
  'postgresql': ['postgresql', 'database'],
  'mongodb': ['mongodb', 'database'],
  'redis': ['redis', 'cache'],
  'nginx': ['nginx', 'web-server'],
  'react': ['react', 'frontend'],
  'vue': ['vue', 'frontend'],
  // ── Additional TECH_TERMS: self-hosting community favorites ──
  'vaultwarden': ['vaultwarden', 'password-manager'],
  'homeassistant': ['home-assistant', 'home-automation'],
  'home assistant': ['home-assistant', 'home-automation'],
  'wireguard': ['wireguard', 'vpn'],
  'paperless': ['paperless', 'document-management'],
  'postgrest': ['postgrest', 'api'],
  'd3': ['d3', 'data-visualization'],
  'chartjs': ['chartjs', 'data-visualization'],
  'echarts': ['echarts', 'data-visualization'],
  'plotly': ['plotly', 'data-visualization'],
  'recharts': ['recharts', 'data-visualization'],
  'apexcharts': ['apexcharts', 'data-visualization'],
  'vega': ['vega', 'data-visualization'],
  'observable': ['observable', 'data-visualization'],
  'metabase': ['metabase', 'analytics', 'dashboard'],
  'superset': ['superset', 'analytics', 'data-visualization'],
  'redash': ['redash', 'analytics', 'dashboard'],


  // ── Misc common ──
  // Intent-carrying alternatives for generic Vietnamese→English mappings.
  // Generic-only terms (system, platform, tool) are filtered by ENGLISH_GENERIC_TERMS,
  // so compound entries provide the domain-specific search terms that survive filtering.
  //
  // "công cụ" (tool) is domain-agnostic — mapping it to "devops-tool"/"cli-tool" forced
  // every "công cụ X" query into the DevOps/CLI intent cluster, producing irrelevant
  // results for non-DevOps domains (e.g., "công cụ quản lý căn tin" → retail/POS).
  // Use generic "tool"/"utility" so the actual domain word ("căn tin", "bán hàng"…)
  // drives the query, and ENGLISH_GENERIC_TERMS strips the generic word from the
  // primary translation, leaving the domain term.
  'công cụ': ['tool', 'utility'],
  'nền tảng': ['platform', 'framework'],
  'hệ thống': ['system', 'infra'],
  'trình': ['runner', 'engine'],
  'quản lý': ['management', 'admin'],
  'tự động': ['automation', 'automated', 'auto'],
  'hỗ trợ': ['support'],
  'chỉ': ['only'],
  'ưu tiên': ['prefer'],
  'thiên về': ['lean towards', 'prefer'],
  'ít': ['less', 'fewer'],
  'nhiều': ['more'],
  'giấy phép': ['license'],
  'phiên bản': ['version'],
  'tài liệu': ['documentation', 'docs'],
  'giao diện': ['interface', 'ui', 'dashboard'],
  'đồ họa': ['graphics', 'visualization'],
  'thống kê': ['statistics', 'analytics'],
  'phân tích': ['analytics', 'analysis'],
  'trực quan': ['visualization'],
  'nhắc nhở': ['reminder'],
  'lịch': ['calendar', 'scheduler'],
  'tác nhân': ['agent'],
  'tìm kiếm': ['search'],
  'xác thực': ['authentication', 'oauth'],
  'nhóm': ['group', 'team'],
  'cộng đồng': ['community'],
  'riêng': ['private', 'personal'],
  'cấu hình': ['configuration', 'config'],
  'thông báo': ['notification', 'alert'],
  'bảng điều khiển': ['dashboard', 'control-panel'],
  'tích hợp': ['integration'],
  // ── Newly added vocabulary for broader coverage ──
  'chạy thử': ['testing', 'test'],
  'biến số': ['variable', 'env'],
  'môi trường': ['environment', 'env'],
  'đăng nhập': ['login', 'authentication'],
  'tải xuống': ['download', 'installer'],
  'cập nhật': ['update', 'upgrade', 'release'],
  'phiên bản mới': ['latest', 'release'],
  'lỗi': ['bug', 'error', 'issue'],
  'sửa lỗi': ['bugfix', 'patch'],
  'hiệu suất': ['performance', 'benchmark'],
  'quy mô': ['scale', 'scaling'],
  'đồng bộ': ['sync', 'synchronization'],
  'ảnh': ['image', 'container-image'],
  'máy chủ ảo': ['virtual-machine', 'vm'],
  'nút': ['node', 'cluster-node'],
  'kiểm tra': ['check', 'validate', 'verify'],
  'chuyển đổi': ['convert', 'transform', 'migration'],
  'trang quản trị': ['admin-panel', 'dashboard'],
  'bảo trì': ['maintenance', 'ops'],
  'thử nghiệm': ['experiment', 'testing'],
  // ── Additional high-ROI compounds: domain-specific intent carriers ──
  // These map commonly used Vietnamese phrases to their precise English domain
  // equivalents, improving both Phase 1 keyword generation and ranking relevance.
  'máy chủ email': ['mail-server', 'smtp'],
  'chứng chỉ ssl': ['ssl-certificate', 'tls'],
  'quét mã nguồn': ['code-scanning', 'sast'],
  'tối ưu hiệu suất': ['performance-optimization', 'profiling'],
  'chạy container': ['container-runtime', 'docker'],
  'kiểm soát phiên bản': ['version-control', 'git'],
  'mô hình phân tích': ['analytics-engine', 'data-pipeline'],
  'xác thực hai yếu tố': ['2fa', 'mfa'],
  'quản lý cấu hình': ['config-management', 'infrastructure-as-code'],
  'quy trình làm việc': ['workflow-engine', 'automation'],

  // ── Additional high-ROI entries: common Vietnamese developer search terms ──
  // These address gaps where the local translator would previously drop the word
  // or emit a poor romanization instead of the correct English domain term.

  // ── Version control / collaboration ──
  'quản lý mã nguồn': ['version-control', 'git', 'scm'],
  'kho mã nguồn': ['code-repository', 'git-repo'],
  'hợp tác lập trình': ['collaborative-coding', 'code-review'],

  // ── Database / data engineering (commonly used but missing) ──
  'cơ sở dữ liệu quan hệ': ['relational-database', 'sql'],
  'cơ sở dữ liệu phi quan hệ': ['nosql', 'document-database'],
  'mô hình dữ liệu': ['data-model', 'orm'],
  'đồng bộ dữ liệu': ['data-sync', 'replication'],
  'xử lý dữ liệu lớn': ['big-data', 'data-engineering'],

  // ── Messaging / communication ──
  'máy chủ chat': ['chat-server', 'messaging'],
  'nhắn tin tức thời': ['instant-messaging', 'realtime-chat'],

  // ── Monitoring / SRE ──
  'phát hiện sự cố': ['incident-detection', 'alerting'],
  'quản lý sự cố': ['incident-management', 'pagerduty'],
  'bảng trạng thái': ['status-page', 'uptime-monitor'],

  // ── Container / orchestration ──
  'quản lý container': ['container-management', 'container-orchestration'],
  'đăng ký container': ['container-registry', 'docker-registry'],

  // ── Network / proxy ──
  'proxy đảo ngược': ['reverse-proxy', 'load-balancer'],
  'máy chủ dns': ['dns-server'],

  // ── File / object storage ──
  'lưu trữ đối tượng': ['object-storage', 's3'],
  'chia sẻ tệp': ['file-sharing', 'cloud-storage'],

  // ── Auth / identity ──
  'quản lý định danh': ['identity-management', 'idp'],
  'đăng nhập một lần': ['sso', 'single-sign-on'],

  // ── Additional high-ROI Vietnamese developer search terms ──
  'tối ưu': ['optimization', 'optimized'],
  'tối ưu hóa': ['optimization', 'performance-tuning'],
  'máy chủ web': ['web-server', 'http-server'],
  'báo cáo lỗi': ['issue-tracker', 'bug-tracker'],
  'kiểm soát truy cập': ['access-control', 'rbac'],
  'phiên bản hóa': ['versioning', 'git'],
  'máy chủ tệp': ['file-server', 'nas'],
  'cổng api': ['api-gateway', 'rest-api'],
  'máy chủ proxy': ['proxy-server', 'reverse-proxy'],
  'quét bảo mật': ['security-scanning', 'vulnerability-scan'],
  'mã nguồn đóng': ['proprietary', 'closed-source'],
  'hiệu suất cao': ['high-performance', 'fast', 'optimized'],
  'chạy thử nghiệm': ['staging', 'preview'],
  'mở rộng': ['scaling', 'horizontal-scaling'],
  'thu nhỏ': ['micro', 'lightweight', 'minimal'],
  'tích hợp hệ thống': ['system-integration', 'integration'],
  'chạy song song': ['parallel', 'concurrency'],
  'biên tập mã': ['code-editor', 'ide'],
  'trình thông dịch': ['interpreter', 'runtime'],
  'thư mục': ['directory', 'folder'],
  'cài đặt': ['install', 'setup'],
  'cấu hình máy chủ': ['server-config', 'infrastructure-as-code'],
  'triển khai tự động': ['auto-deploy', 'continuous-deployment'],
  'kiểm tra tự động': ['automated-testing', 'ci'],
  'chế độ tối': ['dark-mode', 'theme'],
  'xác minh': ['verification', 'validation'],
  'quản lý gói': ['package-manager', 'package-management'],
  'bảo trì dự đoán': ['predictive-maintenance', 'monitoring'],
  'máy chủ tàng hình': ['stealth-server', 'privacy'],
  'sao chép dữ liệu': ['data-replication', 'backup'],
  // ── High-ROI additions: common Vietnamese developer queries missing from dict ──
  'tin nhắn': ['messaging', 'chat', 'notification'],
  'nhắn tin': ['messaging', 'instant-messaging', 'chat'],
  'dự án': ['project', 'project-management'],
  'quản lý dự án': ['project-management', 'kanban'],
  'hệ thống nhắn tin': ['messaging-system', 'chat'],
  'hàng đợi': ['queue', 'message-queue'],
  'luồng': ['thread', 'stream'],
  'sự kiện': ['event', 'event-driven'],
  'vô trạng thái': ['stateless'],
  'có trạng thái': ['stateful'],
  'cập nhật liên tục': ['continuous-deployment', 'rolling-update'],
  'truy xuất nguồn gốc': ['traceability', 'provenance'],
  'chấm điểm': ['scoring', 'rating'],
  'thu thập': ['collection', 'harvesting'],
  'trích xuất': ['extraction', 'etl'],
  'hợp nhất': ['merge', 'consolidation'],
  'loại bỏ': ['removal', 'cleanup'],
  'định tuyến': ['routing', 'router'],
  'phân phối': ['distribution', 'cdn'],
  'mở khóa': ['unlock', 'release'],
  'khóa': ['lock', 'encryption'],
  'phím tắt': ['shortcut', 'hotkey'],
  'giao thức': ['protocol'],
  'di chuyển': ['migration', 'transfer'],
  'thống nhất': ['unified', 'consolidated'],
  'quay lại': ['rollback', 'undo'],
  // ── Data visualization terms ──
  'đồ thị': ['chart', 'graph', 'visualization'],
  'biểu đồ': ['chart', 'visualization'],
  'vẽ đồ thị': ['charting', 'graphing'],
  'trực quan hóa dữ liệu': ['data-visualization', 'dashboard'],
  'dashboard dữ liệu': ['data-dashboard', 'visualization'],

  // ── VPN / privacy ──
  'mạng riêng ảo': ['vpn', 'wireguard'],

  // ── Home automation / IoT ──
  'nhà thông minh': ['home-automation', 'iot'],
  'tự động hóa nhà': ['home-automation', 'smart-home'],

  // ── Password / secrets ──
  'kho bí mật': ['secrets-manager', 'vault'],

  // ── Notes / wiki ──
  'ghi chú': ['notes', 'note-taking'],
  'hệ thống wiki': ['wiki', 'knowledge-base'],

  // ── High-frequency Vietnamese terms ──
  'ứng dụng': ['application', 'app'],
  'người dùng': ['user', 'user-management'],
  'dịch vụ': ['service', 'microservice'],
  'truy cập': ['access', 'access-control'],
  'tài khoản': ['account', 'user-account'],
  'quản trị': ['administration', 'admin'],
  'đăng ký': ['registration', 'signup'],
  'quản lý người dùng': ['user-management', 'identity-management'],
  'quản lý tài khoản': ['account-management', 'user-management'],
  'quản lý truy cập': ['access-control', 'rbac'],
  'dịch vụ web': ['web-service', 'api'],
  'xác thực người dùng': ['user-authentication', 'auth'],
  'dịch vụ vi mô': ['microservice', 'microservices'],
  'dịch vụ đám mây': ['cloud-service', 'saas'],
  'quản trị hệ thống': ['system-administration', 'sysadmin'],
  'quản trị viên': ['administrator', 'admin'],
  'đăng ký dịch vụ': ['service-registration', 'service-discovery'],
  'xác thực hai lớp': ['2fa', 'mfa', 'two-factor-authentication'],

  // ── Retail / POS / hospitality / food-service ──
  // These map Vietnamese business-domain terms to GitHub-friendly English keywords.
  // Without these, queries like "công cụ quản lý căn tin" produce romanized garbage
  // ("can tin") and irrelevant DevOps results. The longer compound entries are
  // matched first by the sliding-window translator, so order them before singles.
  'căn tin': ['canteen', 'cafeteria', 'food-service'],
  'quản lý căn tin': ['canteen-management', 'food-service-management'],
  'bán hàng': ['point-of-sale', 'pos', 'sales', 'ecommerce'],
  'quản lý bán hàng': ['sales-management', 'point-of-sale', 'pos'],
  'cửa hàng': ['store', 'shop', 'retail'],
  'quản lý cửa hàng': ['store-management', 'retail-management'],
  'quán': ['restaurant', 'cafe', 'shop'],
  'quán cafe': ['cafe', 'coffee-shop'],
  'quán ăn': ['restaurant', 'food-service'],
  'nhà hàng': ['restaurant', 'restaurant-management'],
  'quản lý nhà hàng': ['restaurant-management', 'restaurant-pos'],
  'thực đơn': ['menu', 'menu-management'],
  'đơn hàng': ['order', 'order-management'],
  'quản lý đơn hàng': ['order-management', 'order-tracking'],
  'tồn kho': ['inventory', 'stock'],
  'quản lý tồn kho': ['inventory-management', 'stock-management'],
  'kho hàng': ['warehouse', 'inventory'],
  'quản lý kho': ['warehouse-management', 'inventory-management'],
  'thu ngân': ['cashier', 'point-of-sale', 'pos'],
  'hóa đơn': ['invoice', 'receipt', 'billing'],
  'quản lý hóa đơn': ['invoice-management', 'billing'],
  'khách hàng': ['customer', 'crm'],
  'quản lý khách hàng': ['crm', 'customer-management'],
  'sản phẩm': ['product', 'product-management'],
  'quản lý sản phẩm': ['product-management', 'catalog'],
  'thanh toán': ['payment', 'checkout', 'billing'],
  'quản lý thanh toán': ['payment-management', 'billing'],
  'đặt món': ['order', 'food-ordering'],
  'đặt bàn': ['reservation', 'table-booking'],
  'giao hàng': ['delivery', 'shipping'],
  'quản lý giao hàng': ['delivery-management', 'shipping'],
  'đại lý': ['agent', 'distributor'],
  'bán lẻ': ['retail', 'point-of-sale'],
  'bán buôn': ['wholesale', 'b2b'],
  'siêu thị': ['supermarket', 'grocery', 'retail'],
  'chợ': ['market', 'marketplace'],
  'thương mại điện tử': ['ecommerce', 'e-commerce', 'online-store'],
  'cửa hàng online': ['online-store', 'ecommerce'],
  'quản lý cửa hàng online': ['ecommerce-management', 'online-store'],
  'gian hàng': ['booth', 'storefront', 'vendor'],
  'nhân viên': ['employee', 'staff'],
  'quản lý nhân viên': ['employee-management', 'staff-management'],
  'ca làm việc': ['shift', 'shift-scheduling'],
  'chấm công': ['time-tracking', 'attendance'],
  'quản lý ca làm việc': ['shift-management', 'staff-scheduling'],

  // ── Audio / media ──
  'trình đọc nhạc': ['music-player', 'audio'],
  'phát trực tiếp': ['streaming', 'live-streaming'],

  // ── CI/CD Runner entries ──
  'trình chạy': ['runner', 'executor', 'ci-cd'],
  'trình chạy ci': ['ci-runner', 'ci-cd'],
  'trình chạy tự động': ['automation-runner', 'workflow-runner'],
  'công cụ chạy': ['runner', 'executor', 'launcher'],

};

export const TECH_TERMS: Record<string, string[]> = {
  'docker': ['docker', 'containerization'],
  'kubernetes': ['kubernetes', 'k8s'],
  'k8s': ['kubernetes', 'k8s'],
  'ci/cd': ['ci-cd', 'continuous-integration'],
  'ci-cd': ['ci-cd', 'continuous-integration'],
  'cicd': ['ci-cd', 'continuous-integration'],
  'react': ['react', 'frontend'],
  'vue': ['vue', 'frontend'],
  // ── Additional TECH_TERMS: self-hosting community favorites ──
  'vaultwarden': ['vaultwarden', 'password-manager'],
  'homeassistant': ['home-assistant', 'home-automation'],
  'home assistant': ['home-assistant', 'home-automation'],
  'wireguard': ['wireguard', 'vpn'],
  'paperless': ['paperless', 'document-management'],
  'postgrest': ['postgrest', 'api'],
  'd3': ['d3', 'data-visualization'],
  'chartjs': ['chartjs', 'data-visualization'],
  'echarts': ['echarts', 'data-visualization'],
  'plotly': ['plotly', 'data-visualization'],
  'recharts': ['recharts', 'data-visualization'],
  'apexcharts': ['apexcharts', 'data-visualization'],
  'vega': ['vega', 'data-visualization'],
  'observable': ['observable', 'data-visualization'],
  'metabase': ['metabase', 'analytics', 'dashboard'],
  'superset': ['superset', 'analytics', 'data-visualization'],
  'redash': ['redash', 'analytics', 'dashboard'],

  'angular': ['angular', 'frontend'],
  'node': ['nodejs', 'node'],
  'nodejs': ['nodejs', 'node'],
  'python': ['python'],
  'golang': ['go', 'golang'],
  'rust': ['rust'],
  'mongodb': ['mongodb', 'database'],
  'postgresql': ['postgresql', 'database'],
  'postgres': ['postgresql', 'database'],
  'redis': ['redis', 'cache'],
  'nginx': ['nginx', 'web-server'],
  'terraform': ['terraform', 'infrastructure-as-code'],
  'git': ['git', 'version-control'],
  'linux': ['linux'],
  'rest': ['rest-api'],
  'graphql': ['graphql', 'api'],
  'api': ['api', 'rest-api'],
  'ml': ['machine-learning', 'ml'],
  'ai': ['artificial-intelligence', 'ai'],
  'llm': ['llm', 'language-model'],
  // ── Commonly appear in Vietnamese queries ──
  'typescript': ['typescript', 'frontend'],
  'javascript': ['javascript', 'frontend'],
  'java': ['java', 'backend'],
  'jenkins': ['jenkins', 'ci-cd'],
  'gitlab': ['gitlab', 'ci-cd'],
  'ansible': ['ansible', 'automation'],
  'elasticsearch': ['elasticsearch', 'search-engine'],
  'kafka': ['kafka', 'message-queue'],
  'rabbitmq': ['rabbitmq', 'message-queue'],
  'prometheus': ['prometheus', 'monitoring'],
  'grafana': ['grafana', 'monitoring'],
  'mysql': ['mysql', 'database'],
  'sqlite': ['sqlite', 'database'],
  'mariadb': ['mariadb', 'database'],
  'svelte': ['svelte', 'frontend'],
  'next.js': ['nextjs', 'frontend'],
  'nextjs': ['nextjs', 'frontend'],
  'express': ['express', 'backend'],
  'django': ['django', 'backend'],
  'flask': ['flask', 'backend'],
  'spring': ['spring', 'backend'],
  'flutter': ['flutter', 'mobile'],
  'react native': ['react-native', 'mobile'],
  'swift': ['swift', 'mobile'],
  'kotlin': ['kotlin', 'backend'],
  'argo': ['argo', 'ci-cd'],
  'helm': ['helm', 'kubernetes'],
  'vault': ['vault', 'secrets'],
  'consul': ['consul', 'service-discovery'],
  'tailscale': ['tailscale', 'vpn'],
  'traefik': ['traefik', 'proxy'],
  'caddy': ['caddy', 'web-server'],
  'apache': ['apache', 'web-server'],
  'hadoop': ['hadoop', 'big-data'],
  'spark': ['spark', 'big-data'],
  'airflow': ['airflow', 'workflow'],
  'vscode': ['vscode', 'editor'],
  // ── Additional high-ROI tech terms commonly seen in Vietnamese queries ──
  'copilot': ['copilot', 'ai-assistant'],
  'supabase': ['supabase', 'backend-as-a-service'],
  'firebase': ['firebase', 'backend-as-a-service'],
  'vercel': ['vercel', 'hosting'],
  'netlify': ['netlify', 'hosting'],
  'heroku': ['heroku', 'paas'],
  'digitalocean': ['digitalocean', 'cloud'],
  'aws': ['aws', 'cloud'],
  'gcp': ['gcp', 'cloud'],
  'azure': ['azure', 'cloud'],
  'opentelemetry': ['opentelemetry', 'observability'],
  'datadog': ['datadog', 'monitoring'],
  'sentry': ['sentry', 'error-tracking'],
  'storybook': ['storybook', 'ui'],
  'tailwind': ['tailwind', 'css-framework'],
  'bootstrap': ['bootstrap', 'css-framework'],
  'meilisearch': ['meilisearch', 'search-engine'],
  'typesense': ['typesense', 'search-engine'],
  'minio': ['minio', 'object-storage'],
  'cloudflare': ['cloudflare', 'cdn'],
  'nuxt': ['nuxt', 'frontend'],
  'remix': ['remix', 'frontend'],
  'astro': ['astro', 'frontend'],
  'solid': ['solidjs', 'frontend'],
  'deno': ['deno', 'runtime'],
  'bun': ['bun', 'runtime'],
  'railway': ['railway', 'paas'],
  'render': ['render', 'paas'],
  'k3s': ['k3s', 'kubernetes'],
  'istio': ['istio', 'service-mesh'],
  'linkerd': ['linkerd', 'service-mesh'],
  'pgvector': ['pgvector', 'vector-database'],
  'chroma': ['chromadb', 'vector-database'],
  'pinecone': ['pinecone', 'vector-database'],
  'weaviate': ['weaviate', 'vector-database'],
  'qdrant': ['qdrant', 'vector-database'],
  'langchain': ['langchain', 'llm-framework'],
  'ollama': ['ollama', 'llm'],
  'litellm': ['litellm', 'llm'],
  'vllm': ['vllm', 'inference'],
  'webassembly': ['webassembly', 'wasm'],
  'wasm': ['webassembly', 'wasm'],
  'edge-computing': ['edge-computing', 'edge'],
  'strapi': ['strapi', 'cms'],
  'wordpress': ['wordpress', 'cms'],
  'ghost': ['ghost', 'cms'],
  'plausible': ['plausible', 'analytics'],
  'umami': ['umami', 'analytics'],
  'matomo': ['matomo', 'analytics'],
  'n8n': ['n8n', 'workflow-automation'],
  'temporal': ['temporal', 'workflow'],
  'dapr': ['dapr', 'microservices'],
  'jaeger': ['jaeger', 'tracing'],
  'zipkin': ['zipkin', 'tracing'],
  'etcd': ['etcd', 'key-value'],
  'cockroach': ['cockroachdb', 'database'],
  'tidb': ['tidb', 'database'],
  'scylla': ['scylladb', 'database'],
  'influxdb': ['influxdb', 'time-series'],
  'timescaledb': ['timescaledb', 'time-series'],

  // ── Additional tech terms commonly mixed into Vietnamese queries ──
  'gitea': ['gitea', 'git-server'],
  'forgejo': ['forgejo', 'git-server'],
  'woodpecker': ['woodpecker', 'ci-cd'],
  'drone': ['drone', 'ci-cd'],
  'act': ['act-runner', 'ci-cd'],
  'harbor': ['harbor', 'container-registry'],
  'portainer': ['portainer', 'docker-management'],
  'uptime': ['uptime-kuma', 'monitoring'],
  'glitchtip': ['glitchtip', 'error-tracking'],
  'zitadel': ['zitadel', 'identity'],
  'keycloak': ['keycloak', 'identity', 'sso'],
  'authentik': ['authentik', 'identity', 'sso'],
  'outline': ['outline', 'wiki'],
  'bookstack': ['bookstack', 'wiki'],
  'hedgedoc': ['hedgedoc', 'collaborative-editor'],
  'gotify': ['gotify', 'push-notification'],
  'unifi': ['unifi', 'network-management'],
  // ── Additional tech terms for Vietnamese mixed-language queries ──
  'sveltekit': ['sveltekit', 'frontend'],
  'htmx': ['htmx', 'frontend'],
  'alpine': ['alpinejs', 'frontend'],
  'memcached': ['memcached', 'cache'],
  'clickhouse': ['clickhouse', 'database', 'olap'],
  'lucene': ['lucene', 'search-engine'],
  'rabbit': ['rabbitmq', 'message-queue'],
  'sqlite3': ['sqlite', 'database'],
  'tailwindcss': ['tailwind', 'css-framework'],
  'pytorch': ['pytorch', 'deep-learning'],
  'tensorflow': ['tensorflow', 'deep-learning'],
  'onnx': ['onnx', 'inference'],
  'fastapi': ['fastapi', 'backend'],
  'nestjs': ['nestjs', 'backend'],
  'trpc': ['trpc', 'api'],
  'prisma': ['prisma', 'orm'],
  'typeorm': ['typeorm', 'orm'],
  'sequelize': ['sequelize', 'orm'],
  'drizzle': ['drizzle-orm', 'orm'],
  'supertest': ['supertest', 'testing'],
  'playwright': ['playwright', 'testing', 'e2e'],
  'vitest': ['vitest', 'testing'],
  'jest': ['jest', 'testing'],
  'cypress': ['cypress', 'testing', 'e2e'],
  'puppeteer': ['puppeteer', 'testing', 'browser-automation'],
};

export const VIETNAMESE_GITHUB_SYNONYMS: Record<string, string[]> = {
  // Primary Vietnamese compound terms → GitHub-friendly synonyms
  'quản lý': ['management', 'manager', 'admin'],
  'giám sát': ['monitoring', 'observability', 'watch'],
  'máy chủ': ['server', 'host'],
  'mật khẩu': ['password', 'credential', 'auth'],
  'cơ sở dữ liệu': ['database', 'db'],
  'bảo mật': ['security', 'secure'],
  'triển khai': ['deployment', 'deploy', 'release'],
  'tự động': ['automation', 'automated', 'auto'],
  'mã nguồn mở': ['open-source', 'oss'],
  'ứng dụng': ['app', 'application'],
  'giao diện': ['interface', 'ui', 'dashboard'],
  'xây dựng': ['build', 'ci'],
  'kiểm thử': ['testing', 'test'],
  'tự host': ['self-hosted', 'self-host'],
  'riêng tư': ['self-hosted', 'private'],
  'phân tích': ['analytics', 'analysis'],
  'thông báo': ['notification', 'alert', 'alerting'],
  'nhật ký': ['logging', 'logs'],
  'sao lưu': ['backup', 'backup-restore'],
  'huấn luyện': ['training', 'train'],
  'suy luận': ['inference'],
  'mã hóa': ['encryption', 'crypto', 'tls'],
  'chứng thực': ['authentication', 'auth', 'login'],
  'phân quyền': ['authorization', 'rbac', 'permissions'],
  'tích hợp': ['integration'],
  'điều phối': ['orchestration'],
  'cân bằng tải': ['load-balancer', 'load-balancing'],
  // ── Newly added synonym mappings ──
  'phát triển': ['development', 'dev'],
  'lập trình': ['programming', 'development', 'coding'],
  'thư viện': ['library', 'lib'],
  'khung': ['framework', 'lib'],
  'gỡ lỗi': ['debugging', 'debugger'],
  'biên dịch': ['compiler', 'compilation'],
  'hạ tầng': ['infrastructure', 'infra'],
  'bảng điều khiển': ['dashboard', 'control-panel', 'admin'],
  'tác nhân': ['agent', 'bot'],
  'nhắc nhở': ['reminder', 'notification'],
  'tìm kiếm': ['search', 'search-engine'],
  'cộng đồng': ['community', 'open-source'],
  'thống kê': ['statistics', 'analytics', 'metrics'],
  'trực quan': ['visualization', 'dashboard'],
  'đóng gói': ['packaging', 'package', 'bundle'],
  'nhanh': ['fast', 'high-performance', 'performance'],
  'nhẹ': ['lightweight', 'minimal', 'micro'],
  'ổn định': ['stable', 'reliable', 'production-ready'],
  'mới nhất': ['latest', 'newest', 'modern'],
  'thay thế': ['alternative', 'replacement', 'migration'],
  'giải pháp': ['solution', 'platform'],
  'quy trình': ['workflow', 'pipeline', 'automation'],
  'tự động hóa': ['automation', 'automated', 'ci'],
  // ── Additional high-ROI Vietnamese→English synonym mappings ──
  'học sâu': ['deep-learning', 'neural-network'],
  'học máy': ['machine-learning', 'ml'],
  'trí tuệ nhân tạo': ['artificial-intelligence', 'ai'],
  'mô hình ngôn ngữ': ['language-model', 'llm'],
  'xử lý ngôn ngữ tự nhiên': ['nlp', 'natural-language-processing'],
  'thị giác máy tính': ['computer-vision', 'cv'],
  'tạo sinh': ['generative-ai', 'generative'],
  'cloud': ['cloud', 'cloud-native'],
  'đám mây': ['cloud', 'cloud-native'],
  'vùng chứa': ['container', 'docker'],
  'cổng kết nối': ['gateway', 'api-gateway'],
  'lưu trữ': ['storage', 'persistence'],
  'phục hồi': ['recovery', 'restore', 'disaster-recovery'],
  'tạo khuôn mẫu': ['template', 'scaffolding', 'boilerplate'],
  'quy mô lớn': ['scalable', 'high-scale', 'distributed'],
  'thời gian thực': ['realtime', 'real-time'],
  'xử lý đồng thời': ['concurrency', 'async', 'parallel'],
  'đồng bộ dữ liệu': ['sync', 'data-sync', 'replication'],
  'mã xác thực': ['otp', '2fa', 'mfa', 'authentication'],
  'phát hiện xâm nhập': ['ids', 'intrusion-detection', 'security-scanner'],
  'điểm truy cập': ['endpoint', 'api'],
  'quản lý cấu hình': ['configuration', 'config-management', 'infrastructure-as-code'],
  'biến số môi trường': ['env', 'environment-variable', 'config'],
  'trích xuất dữ liệu': ['etl', 'data-pipeline', 'scraping'],
  'tái cấu trúc': ['refactoring', 'rewrite', 'migration'],
  'hiệu suất cao': ['high-performance', 'fast', 'optimized'],
  'phi tập trung': ['decentralized', 'p2p', 'distributed'],
  'nén dữ liệu': ['compression', 'archive'],
  'chạy ngầm': ['daemon', 'background', 'service'],

  // ── Additional synonym mappings for compound Vietnamese phrases ──
  'quản lý mã nguồn': ['version-control', 'git', 'scm'],
  'máy chủ chat': ['chat-server', 'messaging', 'irc'],
  'máy chủ email': ['mail-server', 'smtp', 'imap'],
  'đăng ký container': ['container-registry', 'docker-registry'],
  'quản lý container': ['container-orchestration', 'kubernetes'],
  'máy chủ dns': ['dns-server', 'dns'],
  'lưu trữ đối tượng': ['object-storage', 's3', 'minio'],
  'quản lý định danh': ['identity-management', 'idp', 'sso'],
  'đăng nhập một lần': ['sso', 'single-sign-on', 'oauth'],
  'phát hiện sự cố': ['incident-detection', 'alerting'],
  'quản lý sự cố': ['incident-management', 'sre'],
  // ── Additional high-ROI synonym compounds for Vietnamese developer queries ──
  'máy chủ web': ['web-server', 'http-server'],
  'trạm làm việc': ['workstation', 'desktop'],
  'bảng trạng thái': ['status-page', 'uptime-monitor'],
  'cổng api': ['api-gateway', 'rest-api'],
  'máy chủ proxy': ['proxy-server', 'reverse-proxy'],
  'kiểm soát truy cập': ['access-control', 'rbac'],
  'phiên bản hóa': ['versioning', 'git'],
  'mã nguồn đóng': ['proprietary', 'closed-source'],
  'tối ưu hóa': ['optimization', 'performance-tuning'],
  'quét bảo mật': ['security-scanning', 'vulnerability-scan'],
  'báo cáo lỗi': ['issue-tracker', 'bug-tracker'],
  'máy chủ tệp': ['file-server', 'nas'],
  'máy chủ in': ['print-server'],
  // ── Additional compound synonyms for Vietnamese developer queries ──
  'công cụ': ['tool', 'cli', 'utility'],
  'hàng đợi': ['queue', 'message-queue', 'job-queue'],
  'luồng': ['thread', 'stream', 'concurrency'],
  'sự kiện': ['event', 'event-driven'],
  'xác thực': ['authentication', 'auth', 'verification'],
  'môi trường': ['environment', 'env', 'deployment'],
  'phụ thuộc': ['dependency', 'package-manager'],
  'chạy thử': ['preview', 'sandbox', 'staging'],
  'điều hướng': ['routing', 'navigation', 'router'],
  'biểu diễn': ['rendering', 'render', 'visualization'],
  'trạng thái': ['state', 'state-management'],
  'chuyển đổi': ['converter', 'transformer', 'migration'],
  'tạo mã': ['code-generation', 'scaffolding'],
  'trích xuất': ['extraction', 'parser', 'scraper'],
  'hợp nhất': ['merge', 'integration', 'unification'],
  'loại bỏ': ['deduplication', 'cleanup', 'pruning'],
  'định tuyến': ['routing', 'router', 'gateway'],
  'phân phối': ['distribution', 'delivery', 'cdn'],
  'mở khóa': ['unlock', 'licensing', 'activation'],
  'khóa': ['lock', 'encryption', 'mutex'],
  'phím tắt': ['shortcut', 'hotkey', 'keybinding'],
  'giao thức': ['protocol', 'http', 'grpc'],
  'di chuyển': ['migration', 'transfer', 'port'],
  'thống nhất': ['standardization', 'linting', 'formatting'],
  'phân tán': ['distributed', 'decentralized', 'p2p'],
  'tập trung': ['centralized', 'monolithic'],
  'dự án': ['project', 'project-management'],
  'quản lý dự án': ['project-management', 'task-management', 'kanban'],
  'hệ thống nhắn tin': ['messaging-system', 'chat'],
  'trực quan hóa': ['visualization', 'charting', 'dashboard'],
  // ── Data visualization synonyms ──
  'đồ thị': ['chart', 'graph', 'visualization'],
  'biểu đồ': ['chart', 'visualization', 'plot'],
  'vẽ đồ thị': ['charting', 'graphing', 'plotting'],
  'trực quan hóa dữ liệu': ['data-visualization', 'dataviz', 'dashboard'],

  // ── VPN / privacy synonyms ──
  'mạng riêng ảo': ['vpn', 'wireguard'],

  // ── Home automation / IoT synonyms ──
  'nhà thông minh': ['home-automation', 'smart-home', 'iot'],

  // ── Notes / wiki synonyms ──
  'ghi chú': ['notes', 'note-taking', 'notebook'],
  'hệ thống wiki': ['wiki', 'knowledge-base'],

  // ── High-frequency synonym entries ──
  'người dùng': ['user', 'user-management', 'identity'],
  'dịch vụ': ['service', 'microservice', 'api'],
  'truy cập': ['access', 'access-control', 'gateway'],
  'tài khoản': ['account', 'user-account', 'profile'],
  'quản trị': ['admin', 'administration', 'dashboard'],
  'đăng ký': ['registration', 'signup', 'onboarding'],
  'dịch vụ web': ['web-service', 'rest-api', 'api'],
  'xác thực người dùng': ['user-authentication', 'auth', 'login'],
  'dịch vụ vi mô': ['microservice', 'microservices', 'distributed'],
  'dịch vụ đám mây': ['cloud-service', 'saas', 'serverless'],
  'xác thực hai lớp': ['2fa', 'mfa', 'two-factor-auth'],
  'quản lý người dùng': ['user-management', 'identity-management', 'iam'],
  'quản lý truy cập': ['access-control', 'rbac', 'permissions'],
  'quản trị hệ thống': ['system-administration', 'sysadmin', 'ops'],
  'đăng ký dịch vụ': ['service-registry', 'service-discovery', 'consul'],

  // ── CI/CD Runner synonyms ──
  'trình chạy': ['runner', 'executor', 'ci-cd', 'workflow-runner', 'action-runner'],
  'trình chạy ci': ['ci-runner', 'github-actions', 'ci-cd'],
  'công cụ chạy': ['runner', 'executor', 'launcher'],

  // ── Retail / POS / hospitality synonyms ──
  // These expand Vietnamese business terms into GitHub-friendly variants so
  // buildSearchParamsArray produces diverse queries (e.g., "căn tin" → canteen,
  // cafeteria, food-service). Without this, only the primary dictionary
  // translation is searched.
  'căn tin': ['canteen', 'cafeteria', 'food-service'],
  'bán hàng': ['pos', 'point-of-sale', 'sales', 'ecommerce'],
  'cửa hàng': ['store', 'shop', 'retail', 'storefront'],
  'nhà hàng': ['restaurant', 'restaurant-management', 'restaurant-pos'],
  'tồn kho': ['inventory', 'stock', 'inventory-management'],
  'kho hàng': ['warehouse', 'inventory', 'warehouse-management'],
  'khách hàng': ['customer', 'crm', 'customer-management'],
  'thanh toán': ['payment', 'checkout', 'billing', 'payment-gateway'],
  'đơn hàng': ['order', 'order-management', 'order-tracking'],
  'thực đơn': ['menu', 'menu-management'],
  'hóa đơn': ['invoice', 'receipt', 'billing', 'invoice-management'],
  'giao hàng': ['delivery', 'shipping', 'delivery-management'],
  'bán lẻ': ['retail', 'pos', 'point-of-sale'],
  'thương mại điện tử': ['ecommerce', 'e-commerce', 'online-store', 'shop'],
  'nhân viên': ['employee', 'staff', 'hr'],
  'chấm công': ['time-tracking', 'attendance', 'time-clock'],

};

export const VIETNAMESE_INTENT_PATTERNS: Array<{ pattern: RegExp; intent: string }> = [
  // DevOps / CI/CD
  { pattern: /ci[\s/\\-]?cd|tích hợp liên tục|triển khai liên tục|đường ống|ống dẫn|xây dựng/i, intent: 'devops-tool' },
  // Monitoring / observability
  { pattern: /giám sát|theo dõi|quan sát|nhật ký|chỉ số|cảnh báo/i, intent: 'monitoring' },
  // Password management — MUST come before security-tool since "quản lý mật khẩu" also contains "mật khẩu"
  { pattern: /quản lý mật khẩu|kho mật khẩu|mật khẩu/i, intent: 'password-manager' },
  // Security tools — "mật khẩu" is removed here since password-manager takes priority for that term;
  // "bảo mật" (security) still catches general security queries
  { pattern: /bảo mật|mã hóa|chứng thực|phân quyền|an toàn|quản lý bí mật|quét lỗ hổng/i, intent: 'security-tool' },
  // Self-hosted
  { pattern: /tự host|tự chạy|riêng tư|tại chỗ|on-?premise/i, intent: 'self-hosted' },
  // Backup/DR — must come before database so "sao lưu dự phòng" → self-hosted not database
  { pattern: /sao lưu dự phòng|disaster.recovery|backup.solution|phục hồi dữ liệu/i, intent: 'self-hosted' },
  // Data visualization — must come before database so "trực quan dữ liệu" → library not database
  { pattern: /trực quan dữ liệu|trực quan hóa|dashboard.*dữ liệu|chart|biểu đồ|vẽ biểu đồ|đồ thị|trực quan/i, intent: 'data-visualization' },
  // Database
  { pattern: /cơ sở dữ liệu|dữ liệu|kho dữ liệu|sql|truy vấn|sao lưu|phục hồi/i, intent: 'database' },
  // ── User auth / identity ──
  { pattern: /quản lý người dùng|quản lý tài khoản|xác thực người dùng|xác thực hai lớp|đăng nhập một lần|đăng ký người dùng/i, intent: 'authentication' },
  // ── Access control ──
  { pattern: /quản lý truy cập|kiểm soát truy cập|phân quyền người dùng|rbac/i, intent: 'security-tool' },
  
  // AI/ML
  { pattern: / trí tuệ nhân tạo|học máy|học sâu|mô hình ngôn ngữ|xử lý ngôn ngữ tự nhiên|thị giác máy tính|tạo sinh|huấn luyện|suy luận|ai\b|ml\b|llm\b/i, intent: 'ai-ml-tool' },
  // Networking — must come before web-app so "proxy" and "gateway" don't get mis-classified
  { pattern: /mạng|tường lửa|cân bằng tải|vpn|proxy|dns|điều hướng|reverse.proxy|api.gateway/i, intent: 'networking-tool' },
  // CLI tool
  { pattern: /giao diện dòng lệnh|cli|command.line|terminal|shell/i, intent: 'cli-tool' },
  // Mobile
  { pattern: /ứng dụng di động|mobile|ios|android|điện thoại/i, intent: 'mobile-app' },
  // API design — must come before web-app so "thiết kế api" → 'api' not 'web-app'
  { pattern: /thiết kế api|api.design|graphql|openapi|swagger|rest.api/i, intent: 'api' },
  // Web framework — "api" is intentionally broad but comes after api and networking
  { pattern: /trang web|ứng dụng web|frontend|backend|api|rest-api|giao diện lập trình/i, intent: 'web-app' },
  // Library
  { pattern: /thư viện|khung|package|module|gói/i, intent: 'library' },
  // ── Newly added intent patterns for broader Vietnamese query coverage ──
  // General backup/recovery
  { pattern: /sao lưu|khôi phục|backup|phục hồi dữ liệu/i, intent: 'database' },
  // Authentication — catches login/auth queries
  { pattern: /đăng nhập|xác thực người dùng|oauth|sso|single.sign.on/i, intent: 'authentication' },
  // Logging — catches observability queries focused on logs
  { pattern: /nhật ký hệ thống|log.analysis|phân tích log|xem log/i, intent: 'monitoring' },
  // Config management — catches infrastructure-as-code queries
  { pattern: /quản lý cấu hình|configuration.management|iác.quyền.tự.động|ansible|terraform/i, intent: 'devops-tool' },
  // Chat/messaging — catches communication tools
  { pattern: /trò chuyện|chat|messaging|nhắn tin|thông báo tức thời/i, intent: 'messaging' },
  // Editor/IDE — catches development tool queries
  { pattern: /trình soạn thảo|editor|ide|môi trường phát triển/i, intent: 'cli-tool' },
  // ── Additional high-ROI intent patterns ──
  // Data pipeline / ETL
  { pattern: /etl|đường ống dữ liệu|xử lý dữ liệu|khai thác dữ liệu|data.pipeline/i, intent: 'database' },
  // Vector database / embeddings (common in AI-adjacent queries)
  { pattern: /vector.database|nhúng|embedding|chỉ số vector|tìm kiếm ngữ nghĩa/i, intent: 'ai-ml-tool' },
  // CMS / content management
  { pattern: /quản lý nội dung|cms|nội dung web/i, intent: 'web-app' },
  // Search engine
  { pattern: /tìm kiếm toàn văn|search.engine|full.text.search|máy tìm kiếm/i, intent: 'library' },
  // Web server / proxy
  { pattern: /serve.*tĩnh|reverse.proxy|load.balancer|máy chủ ảo|proxy server/i, intent: 'networking-tool' },
  // Error tracking / observability (distinct from monitoring)
  { pattern: /theo dõi lỗi|error.tracking|sentry|theo dõi ngoại lệ/i, intent: 'monitoring' },
  // Automation / workflow
  { pattern: /tự động hóa quy trình|workflow.engine|no.code|codeless/i, intent: 'devops-tool' },
  // Machine learning ops (distinct from AI/ML tool — more infra-focused)
  { pattern: /ml.ops|mlops|quản lý mô hình|model.registry|serving mô hình/i, intent: 'devops-tool' },
  // ── Additional intent patterns for Vietnamese self-hosting community ──
  // Git / code hosting — very common in VN self-hosted queries
  { pattern: /quản lý mã nguồn|kho mã nguồn|git.server|gitea|forgejo|code.hosting/i, intent: 'devops-tool' },
  // Identity / SSO — keycloak, zitadel, authentik are popular in VN
  { pattern: /quản lý định danh|đăng nhập một lần|identity.management|idp|single.sign/i, intent: 'authentication' },
  // Wiki / knowledge base — outline, bookstack
  { pattern: /wiki|kiến thức|tài liệu chung|hợp tác tài liệu/i, intent: 'web-app' },
  // Notification / push — gotify, ntfy
  { pattern: /thông báo đẩy|push.notification|nhắc nhở tự động|gotify|ntfy/i, intent: 'messaging' },
  // File sharing / sync — nextcloud, seafile
  { pattern: /chia sẻ tệp|đồng bộ tệp|file.sharing|cloud.storage|nextcloud/i, intent: 'self-hosted' },
  // Project management
  { pattern: /quản lý dự án|project.management|kanban|bảng công việc/i, intent: 'web-app' },
  // ── Service discovery / microservices ──
  { pattern: /dịch vụ vi mô|đăng ký dịch vụ|khám phá dịch vụ|service.discovery/i, intent: 'devops-tool' },
  // ── Cloud services ──
  { pattern: /dịch vụ đám mây|cloud.service|saas|serverless|function.as.a/i, intent: 'devops-tool' },
  // ── Web service ──
  { pattern: /dịch vụ web|web.service|restful|soap.api/i, intent: 'api' },
  // ── System administration ──
  { pattern: /quản trị hệ thống|quản trị viên|sysadmin|system.administration/i, intent: 'devops-tool' },
  // ── CI/CD Runners ──
  { pattern: /trình chạy|trình thực thi|ci.runner|action.runner|executor/i, intent: 'devops-tool' },

  // ── Additional high-ROI intent patterns for common Vietnamese queries ──
  // Performance / profiling — "tối ưu" (optimize) queries are very common
  { pattern: /tối ưu|hiệu suất|nhanh nhất|tối ưu hóa|benchmark|xuất sắc/i, intent: 'devops-tool' },
  // Lightweight / minimal — common modifier in VN queries ("thư viện nhẹ")
  { pattern: /nhẹ|nhẹ lòng|tối thiểu|minimalist|ít phụ thuộc|zero.dependency/i, intent: 'library' },
  // Desktop app — "ứng dụng máy tính" currently has no match
  { pattern: /ứng dụng máy tính|ứng dụng desktop|desktop.app|electron|tauri/i, intent: 'desktop-app' },
  // Scaling / distributed — common in VN queries about enterprise needs
  { pattern: /mở rộng|quy mô lớn|phân tán|cluster|scaling|high.availability/i, intent: 'devops-tool' },
  // Container runtime — catches "chạy container", "container runtime" queries
  { pattern: /chạy container|container.runtime|podman|containerd|crun/i, intent: 'containerization' },
  // Version control — "quản lý phiên bản" alone (not just compound "quản lý mã nguồn")
  { pattern: /quản lý phiên bản|phiên bản hóa|version.control|git.hook/i, intent: 'devops-tool' },
  // Data pipeline / ETL — broader patterns for data engineering queries
  { pattern: /xử lý dữ liệu lớn|big.data|data.lake|data.warehouse|etl.pipeline|airflow/i, intent: 'database' },
  // Knowledge / wiki — common in VN self-hosting community queries
  { pattern: /hệ thống tri thức|knowledge.base|outline|bookstack|notion/i, intent: 'web-app' },
  // ── Additional high-ROI Vietnamese intent patterns (common developer queries) ──
  // Project management — "quản lý dự án" is extremely common
  { pattern: /quản lý dự án|project.management|kanban|bảng công việc|bảng kanban/i, intent: 'web-app' },
  // Email server — common self-hosting query
  { pattern: /máy chủ email|email.server|mail.server|smtp|imap|thư điện tử/i, intent: 'self-hosted' },
  // Documentation/generator — "tài liệu", "trình tạo" queries
  { pattern: /trình tạo tài liệu|doc.generator|static.site|tạo trang|tạo tài liệu/i, intent: 'library' },
  // State management — common frontend query
  { pattern: /quản lý trạng thái|state.management|quản lý state/i, intent: 'library' },
  // Testing tool — "công cụ kiểm thử" distinct from "kiểm thử" alone
  { pattern: /công cụ kiểm thử|kiểm thử tự động|e2e.*test|unit.test|testing.framework/i, intent: 'testing' },
  // Event/streaming — "xử lý sự kiện" data pipeline queries
  { pattern: /xử lý sự kiện|event.driven|stream.processing|message.queue|hàng đợi tin nhắn/i, intent: 'library' },
  // PDF/document processing — common utility query
  { pattern: /xử lý pdf|pdf.*tool|chuyển đổi pdf|doc.*processing|trích xuất văn bản/i, intent: 'library' },
  // DNS/network resolution — distinct from general networking queries
  { pattern: /phân giải dns|dns.*resolver|máy chủ dns|dns.server/i, intent: 'networking-tool' },
  // ── Retail / POS / hospitality / food-service ──
  // These business-domain queries should NOT fall through to devops-tool/web-app
  // defaults. Map them to 'web-app' intent (closest match in INTENT_TOPIC_CLUSTERS
  // for application-style repos) with retail-specific topic clusters handled in
  // the ranking engine via INTENT_TOPIC_CLUSTERS['retail-pos'].
  { pattern: /căn tin|bán hàng|cửa hàng|bán lẻ|bán buôn|thu ngân|hóa đơn|đơn hàng|tồn kho|kho hàng|siêu thị|gian hàng|thương mại điện tử|cửa hàng online/i, intent: 'retail-pos' },
  { pattern: /nhà hàng|quán ăn|quán cafe|thực đơn|đặt món|đặt bàn|quản lý nhà hàng/i, intent: 'retail-pos' },
  { pattern: /khách hàng|sản phẩm|thanh toán|giao hàng|nhân viên|chấm công|ca làm việc/i, intent: 'retail-pos' },
];

export const VIETNAMESE_REFINEMENTS: Record<string, { english: string; type: 'emphasis' | 'raw-sort'; emphasis?: import('../../shared/types').WeightEmphasis; sortKey?: 'stars' | 'updated_at' | 'forks'; sortDesc?: boolean }> = {
  // Language preferences
  'ưu tiên go': { english: 'prefer Go', type: 'emphasis', emphasis: { semanticMatch: 1.5, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 3.0, licenseCompatibility: 1.0 } },
  'ưu tiên rust': { english: 'prefer Rust', type: 'emphasis', emphasis: { semanticMatch: 1.5, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 3.0, licenseCompatibility: 1.0 } },
  'ưu tiên python': { english: 'prefer Python', type: 'emphasis', emphasis: { semanticMatch: 1.5, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 3.0, licenseCompatibility: 1.0 } },
  'ưu tiên typescript': { english: 'prefer TypeScript', type: 'emphasis', emphasis: { semanticMatch: 1.5, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 3.0, licenseCompatibility: 1.0 } },

  // Domain preferences
  'thiên về devops': { english: 'more DevOps', type: 'emphasis', emphasis: { semanticMatch: 2.0, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.5, languageMatch: 1.0, licenseCompatibility: 1.0 } },
  'thiên về backend': { english: 'more backend', type: 'emphasis', emphasis: { semanticMatch: 2.0, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.5, languageMatch: 1.0, licenseCompatibility: 1.0 } },

  // Negative adjustments
  'ít kubernetes hơn': { english: 'less Kubernetes', type: 'emphasis', emphasis: { semanticMatch: 0.5, starsScore: 1.5, activityScore: 1.5, readmeRelevance: 1.0, languageMatch: 1.5, licenseCompatibility: 1.0 } },
  'ít docker hơn': { english: 'less Docker', type: 'emphasis', emphasis: { semanticMatch: 0.5, starsScore: 1.5, activityScore: 1.5, readmeRelevance: 1.0, languageMatch: 1.5, licenseCompatibility: 1.0 } },

  // License preferences
  'chỉ mã nguồn mở': { english: 'open source only', type: 'emphasis', emphasis: { semanticMatch: 1.0, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 1.0, licenseCompatibility: 3.0 } },
  'giấy phép mit': { english: 'MIT license', type: 'emphasis', emphasis: { semanticMatch: 1.0, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.0, languageMatch: 1.0, licenseCompatibility: 3.0 } },

  // Deployment preferences
  'hỗ trợ docker': { english: 'Docker support', type: 'emphasis', emphasis: { semanticMatch: 2.0, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.5, languageMatch: 1.0, licenseCompatibility: 1.0 } },
  'tự host': { english: 'self-hosted', type: 'emphasis', emphasis: { semanticMatch: 2.0, starsScore: 1.0, activityScore: 1.0, readmeRelevance: 1.5, languageMatch: 1.0, licenseCompatibility: 1.0 } },
};
