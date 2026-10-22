using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Knotes.Desktop
{
    internal static class Program
    {
        internal static readonly Version CurrentVersion = typeof(Program).Assembly.GetName().Version;
        internal const string UpdateRepository = "daadygod-dev/knotes";

        private static Mutex instanceMutex;

        [STAThread]
        private static void Main()
        {
            bool createdNew;
            instanceMutex = new Mutex(true, "KNOTES.Desktop.Singleton", out createdNew);
            if (!createdNew)
            {
                ActivateExistingWindow();
                return;
            }

            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs args)
            {
                MessageBox.Show(
                    args.Exception.Message,
                    "KNOTES",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            };

            Application.Run(new DesktopForm());
            GC.KeepAlive(instanceMutex);
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr FindWindow(string className, string windowName);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr handle, int command);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr handle);

        private static void ActivateExistingWindow()
        {
            for (int attempt = 0; attempt < 25; attempt++)
            {
                IntPtr handle = FindWindow(null, "KNOTES");
                if (handle != IntPtr.Zero)
                {
                    ShowWindow(handle, 9);
                    SetForegroundWindow(handle);
                    return;
                }
                Thread.Sleep(200);
            }
        }
    }

    internal sealed class DesktopForm : Form
    {
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(
            IntPtr windowHandle,
            int attribute,
            ref int value,
            int valueSize
        );

        private const int PreferredPort = 4173;
        private const int PortAttempts = 10;
        private const string UpdateAssetName = "KNOTES-win-x64.zip";
        private const string ChecksumAssetName = "SHA256SUMS.txt";
        private readonly string baseDirectory;
        private readonly string updateDirectory;
        private readonly string updateLogPath;
        private readonly HttpClient http = new HttpClient();
        private readonly Label loading;
        private WebView2 webView;
        private HttpClient updateHttp;
        private Process serverProcess;
        private bool ownsServer;
        private bool closing;
        private bool updatePromptOpen;
        private string appUrl;

        public DesktopForm()
        {
            baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
            http.Timeout = TimeSpan.FromSeconds(2);
            updateDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "KNOTES"
            );
            try
            {
                Directory.CreateDirectory(updateDirectory);
            }
            catch
            {
                updateDirectory = Path.Combine(baseDirectory, "data", "updates");
                Directory.CreateDirectory(updateDirectory);
            }
            updateLogPath = Path.Combine(updateDirectory, "update.log");
            updateHttp = new HttpClient();
            updateHttp.Timeout = TimeSpan.FromMinutes(10);
            updateHttp.DefaultRequestHeaders.UserAgent.ParseAdd(
                "KNOTES/" + Program.CurrentVersion.ToString(3)
            );
            updateHttp.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");

            Text = "KNOTES";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1280, 820);
            MinimumSize = new Size(900, 600);
            try
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
            }

            loading = new Label();
            loading.Dock = DockStyle.Fill;
            loading.Text = "Starting KNOTES...";
            loading.TextAlign = ContentAlignment.MiddleCenter;
            loading.Font = new Font("Segoe UI", 14f, FontStyle.Regular);
            Controls.Add(loading);

            ApplyTheme();
            SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
            Shown += async delegate
            {
                ApplyTheme();
                await StartApplication();
            };
            FormClosing += OnFormClosing;
        }

        private static bool IsDarkTheme()
        {
            try
            {
                using (
                    RegistryKey key = Registry.CurrentUser.OpenSubKey(
                        @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
                    )
                )
                {
                    object value = key == null ? null : key.GetValue("AppsUseLightTheme");
                    return value is int && (int)value == 0;
                }
            }
            catch
            {
                return false;
            }
        }

        private void ApplyTheme()
        {
            bool dark = IsDarkTheme();
            Color background = dark
                ? Color.FromArgb(24, 24, 27)
                : Color.FromArgb(250, 247, 240);
            Color foreground = dark
                ? Color.FromArgb(244, 244, 245)
                : Color.FromArgb(46, 41, 33);

            BackColor = background;
            ForeColor = foreground;
            loading.BackColor = background;
            loading.ForeColor = foreground;
            if (webView != null)
            {
                webView.DefaultBackgroundColor = background;
            }

            if (IsHandleCreated)
            {
                int enabled = dark ? 1 : 0;
                DwmSetWindowAttribute(Handle, 20, ref enabled, sizeof(int));
                DwmSetWindowAttribute(Handle, 19, ref enabled, sizeof(int));
            }
        }

        private void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs args)
        {
            if (IsDisposed)
            {
                return;
            }
            if (InvokeRequired)
            {
                BeginInvoke(new Action(ApplyTheme));
            }
            else
            {
                ApplyTheme();
            }
        }

        private async Task StartApplication()
        {
            try
            {
                string serverPath = Path.Combine(baseDirectory, "KNOTES-server.exe");
                if (!File.Exists(serverPath))
                {
                    throw new FileNotFoundException(
                        "KNOTES-server.exe is missing. Rebuild the Windows app."
                    );
                }

                int port = await FindRunningKnotes();
                if (port == 0)
                {
                    port = FindFreePort();
                    StartServer(serverPath, port);
                    await WaitUntilReady(port);
                }

                appUrl = "http://127.0.0.1:" + port;
                await InitializeWebView();
            }
            catch (Exception error)
            {
                loading.Text = "KNOTES could not start.";
                MessageBox.Show(
                    error.Message,
                    "KNOTES",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                Close();
            }
        }

        private async Task<int> FindRunningKnotes()
        {
            for (int offset = 0; offset < PortAttempts; offset++)
            {
                int port = PreferredPort + offset;
                if (await IsKnotesHealthy(port))
                {
                    return port;
                }
            }
            return 0;
        }

        private async Task<bool> IsKnotesHealthy(int port)
        {
            try
            {
                string payload = await http.GetStringAsync(
                    "http://127.0.0.1:" + port + "/api/health"
                );
                return payload.Contains("\"app\":\"knotes\"");
            }
            catch
            {
                return false;
            }
        }

        private static int FindFreePort()
        {
            for (int offset = 0; offset < PortAttempts; offset++)
            {
                int port = PreferredPort + offset;
                TcpListener listener = null;
                try
                {
                    listener = new TcpListener(IPAddress.Loopback, port);
                    listener.Start();
                    return port;
                }
                catch (SocketException)
                {
                }
                finally
                {
                    if (listener != null)
                    {
                        listener.Stop();
                    }
                }
            }
            throw new InvalidOperationException(
                "KNOTES could not find a free local port."
            );
        }

        private void StartServer(string serverPath, int port)
        {
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = serverPath;
            startInfo.WorkingDirectory = baseDirectory;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;
            startInfo.EnvironmentVariables["PORT"] = port.ToString();
            startInfo.EnvironmentVariables["HOST"] = "127.0.0.1";
            startInfo.EnvironmentVariables["KNOTES_NO_OPEN"] = "1";

            serverProcess = Process.Start(startInfo);
            if (serverProcess == null)
            {
                throw new InvalidOperationException("KNOTES-server.exe could not be started.");
            }
            ownsServer = true;
        }

        private async Task WaitUntilReady(int port)
        {
            DateTime deadline = DateTime.UtcNow.AddSeconds(30);
            while (DateTime.UtcNow < deadline)
            {
                if (serverProcess.HasExited)
                {
                    throw new InvalidOperationException(
                        "KNOTES-server.exe stopped before the app was ready (exit code "
                            + serverProcess.ExitCode
                            + ")."
                    );
                }
                if (await IsKnotesHealthy(port))
                {
                    return;
                }
                await Task.Delay(250);
            }
            throw new TimeoutException("KNOTES took too long to start.");
        }

        private async Task InitializeWebView()
        {
            webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            webView.DefaultBackgroundColor = BackColor;
            Controls.Add(webView);
            webView.BringToFront();

            string userDataFolder = Path.Combine(baseDirectory, "data", "webview2");
            Directory.CreateDirectory(userDataFolder);

            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(
                null,
                userDataFolder,
                null
            );
            await webView.EnsureCoreWebView2Async(environment);

            CoreWebView2 core = webView.CoreWebView2;
            core.Profile.PreferredColorScheme = CoreWebView2PreferredColorScheme.Auto;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = true;
            ApplyTheme();
            core.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs args)
            {
                args.State =
                    args.PermissionKind == CoreWebView2PermissionKind.ClipboardRead
                        ? CoreWebView2PermissionState.Allow
                        : CoreWebView2PermissionState.Deny;
            };
            core.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs args)
            {
                args.Handled = true;
                OpenExternal(args.Uri);
            };
            core.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs args)
            {
                if (!args.Uri.StartsWith(appUrl, StringComparison.OrdinalIgnoreCase))
                {
                    args.Cancel = true;
                    OpenExternal(args.Uri);
                }
            };
            core.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs args)
            {
                if (closing)
                {
                    return;
                }
                MessageBox.Show(
                    "The KNOTES window stopped unexpectedly. Restart the app to continue.",
                    "KNOTES",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                Close();
            };

            loading.Visible = false;
            webView.Source = new Uri(appUrl);
            Activate();
            BeginUpdateCheck();
        }

        private async void BeginUpdateCheck()
        {
            await CheckForUpdatesAsync();
        }

        private static void OpenExternal(string uri)
        {
            Uri parsed;
            if (!Uri.TryCreate(uri, UriKind.Absolute, out parsed))
            {
                return;
            }
            if (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps)
            {
                return;
            }
            try
            {
                Process.Start(new ProcessStartInfo(parsed.AbsoluteUri) { UseShellExecute = true });
            }
            catch
            {
            }
        }

        private string ReadSetting(string key)
        {
            string value = Environment.GetEnvironmentVariable(key);
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }

            string envPath = Path.Combine(baseDirectory, ".env");
            if (!File.Exists(envPath))
            {
                return "";
            }
            try
            {
                foreach (string rawLine in File.ReadAllLines(envPath))
                {
                    string line = rawLine.Trim();
                    if (line.Length == 0 || line.StartsWith("#"))
                    {
                        continue;
                    }
                    int separator = line.IndexOf('=');
                    if (separator <= 0 || line.Substring(0, separator).Trim() != key)
                    {
                        continue;
                    }
                    string candidate = line.Substring(separator + 1).Trim();
                    if (
                        candidate.Length >= 2
                        && (candidate[0] == '"' || candidate[0] == '\'')
                        && candidate[candidate.Length - 1] == candidate[0]
                    )
                    {
                        candidate = candidate.Substring(1, candidate.Length - 2);
                    }
                    return candidate;
                }
            }
            catch
            {
            }
            return "";
        }

        private string UpdateApiUrl()
        {
            string overridden = ReadSetting("KNOTES_UPDATE_API");
            if (!string.IsNullOrWhiteSpace(overridden))
            {
                return overridden;
            }
            string repository = ReadSetting("KNOTES_UPDATE_REPO");
            if (string.IsNullOrWhiteSpace(repository))
            {
                repository = Program.UpdateRepository;
            }
            return "https://api.github.com/repos/" + repository + "/releases/latest";
        }

        private static bool IsTrustedUpdateUrl(string value)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri))
            {
                return false;
            }
            if (uri.Scheme == Uri.UriSchemeHttps)
            {
                return true;
            }
            return uri.Scheme == Uri.UriSchemeHttp
                && (uri.Host == "127.0.0.1" || uri.Host == "localhost");
        }

        private void LogUpdate(string message)
        {
            try
            {
                File.AppendAllText(
                    updateLogPath,
                    DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)
                        + " "
                        + message
                        + Environment.NewLine
                );
            }
            catch
            {
            }
        }

        private sealed class UpdateState
        {
            public DateTime LastCheckUtc { get; set; }
            public string SkippedVersion { get; set; }
            public string PendingVersion { get; set; }
            public string PendingDirectory { get; set; }
        }

        private sealed class GitHubAsset
        {
            public string name { get; set; }
            public string browser_download_url { get; set; }
            public long size { get; set; }
        }

        private sealed class GitHubRelease
        {
            public string tag_name { get; set; }
            public string html_url { get; set; }
            public bool draft { get; set; }
            public bool prerelease { get; set; }
            public GitHubAsset[] assets { get; set; }
        }

        private string UpdateStatePath
        {
            get { return Path.Combine(updateDirectory, "update-state.json"); }
        }

        private UpdateState LoadUpdateState()
        {
            try
            {
                if (File.Exists(UpdateStatePath))
                {
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    UpdateState state = serializer.Deserialize<UpdateState>(
                        File.ReadAllText(UpdateStatePath)
                    );
                    if (state != null)
                    {
                        return state;
                    }
                }
            }
            catch
            {
            }
            return new UpdateState();
        }

        private void SaveUpdateState(UpdateState state)
        {
            try
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                File.WriteAllText(UpdateStatePath, serializer.Serialize(state));
            }
            catch
            {
            }
        }

        private async Task CheckForUpdatesAsync()
        {
            if (updatePromptOpen || closing || ReadSetting("KNOTES_UPDATE") == "0")
            {
                return;
            }

            updatePromptOpen = true;
            try
            {
                await Task.Delay(4000);
                if (closing)
                {
                    return;
                }

                UpdateState state = LoadUpdateState();
                Version pendingVersion;
                if (
                    Version.TryParse(state.PendingVersion, out pendingVersion)
                    && pendingVersion > Program.CurrentVersion
                )
                {
                    if (
                        !string.IsNullOrWhiteSpace(state.PendingDirectory)
                        && Directory.Exists(state.PendingDirectory)
                    )
                    {
                        DialogResult install = MessageBox.Show(
                            this,
                            "KNOTES "
                                + pendingVersion.ToString(3)
                                + " is ready to install.\n\nRestart now?",
                            "Update KNOTES",
                            MessageBoxButtons.YesNo,
                            MessageBoxIcon.Information
                        );
                        if (install == DialogResult.Yes)
                        {
                            ApplyUpdate(state);
                        }
                        return;
                    }
                    state.PendingVersion = null;
                    state.PendingDirectory = null;
                    SaveUpdateState(state);
                }

                if (
                    state.LastCheckUtc != DateTime.MinValue
                    && DateTime.UtcNow - state.LastCheckUtc < TimeSpan.FromHours(24)
                )
                {
                    return;
                }
                state.LastCheckUtc = DateTime.UtcNow;
                SaveUpdateState(state);

                string apiUrl = UpdateApiUrl();
                if (!IsTrustedUpdateUrl(apiUrl))
                {
                    LogUpdate("Update check skipped: untrusted API URL.");
                    return;
                }

                GitHubRelease release;
                using (HttpResponseMessage response = await updateHttp.GetAsync(apiUrl))
                {
                    if (response.StatusCode == HttpStatusCode.NotFound)
                    {
                        return;
                    }
                    response.EnsureSuccessStatusCode();
                    string json = await response.Content.ReadAsStringAsync();
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    release = serializer.Deserialize<GitHubRelease>(json);
                }

                if (release == null || release.draft || release.prerelease)
                {
                    return;
                }
                Version remoteVersion = ParseReleaseVersion(release.tag_name);
                if (remoteVersion == null || remoteVersion <= Program.CurrentVersion)
                {
                    return;
                }
                if (remoteVersion.ToString(3) == state.SkippedVersion)
                {
                    return;
                }

                GitHubAsset archive = FindAsset(release, UpdateAssetName);
                GitHubAsset checksums = FindAsset(release, ChecksumAssetName);
                if (
                    archive == null
                    || checksums == null
                    || !IsTrustedUpdateUrl(archive.browser_download_url)
                    || !IsTrustedUpdateUrl(checksums.browser_download_url)
                )
                {
                    LogUpdate("Update skipped: release assets are missing or untrusted.");
                    return;
                }

                if (!CanWriteApplicationDirectory())
                {
                    MessageBox.Show(
                        this,
                        "KNOTES "
                            + remoteVersion.ToString(3)
                            + " is available, but this copy is in a read-only folder.\n\n"
                            + "Download the new version from "
                            + release.html_url
                            + " instead.",
                        "Update KNOTES",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Information
                    );
                    return;
                }

                DialogResult download = MessageBox.Show(
                    this,
                    "KNOTES "
                        + remoteVersion.ToString(3)
                        + " is available.\n\nDownload and install it now?",
                    "Update KNOTES",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Information
                );
                if (download != DialogResult.Yes)
                {
                    state.SkippedVersion = remoteVersion.ToString(3);
                    SaveUpdateState(state);
                    return;
                }

                string stagingDirectory;
                try
                {
                    stagingDirectory = await DownloadAndVerifyUpdate(
                        release,
                        remoteVersion,
                        archive,
                        checksums
                    );
                }
                catch (Exception error)
                {
                    LogUpdate("Update download failed: " + error.Message);
                    MessageBox.Show(
                        this,
                        "The update could not be downloaded or verified.\n\n"
                            + error.Message
                            + "\n\nTry again later or download it from "
                            + release.html_url
                            + ".",
                        "Update KNOTES",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }
                state.PendingVersion = remoteVersion.ToString(3);
                state.PendingDirectory = stagingDirectory;
                SaveUpdateState(state);

                DialogResult restart = MessageBox.Show(
                    this,
                    "KNOTES "
                        + remoteVersion.ToString(3)
                        + " is ready to install.\n\nRestart now?",
                    "Update KNOTES",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Information
                );
                if (restart == DialogResult.Yes)
                {
                    ApplyUpdate(state);
                }
            }
            catch (Exception error)
            {
                LogUpdate("Update check failed: " + error);
            }
            finally
            {
                updatePromptOpen = false;
            }
        }

        private static GitHubAsset FindAsset(GitHubRelease release, string name)
        {
            if (release.assets == null)
            {
                return null;
            }
            foreach (GitHubAsset asset in release.assets)
            {
                if (string.Equals(asset.name, name, StringComparison.OrdinalIgnoreCase))
                {
                    return asset;
                }
            }
            return null;
        }

        private static Version ParseReleaseVersion(string tag)
        {
            if (string.IsNullOrWhiteSpace(tag))
            {
                return null;
            }
            string value = tag.Trim();
            if (value.StartsWith("v", StringComparison.OrdinalIgnoreCase))
            {
                value = value.Substring(1);
            }
            int metadata = value.IndexOf('+');
            if (metadata >= 0)
            {
                value = value.Substring(0, metadata);
            }
            if (value.IndexOf('-') >= 0)
            {
                return null;
            }
            string[] parts = value.Split('.');
            if (parts.Length < 2 || parts.Length > 3)
            {
                return null;
            }
            int[] numbers = new int[3];
            for (int index = 0; index < parts.Length; index++)
            {
                if (!int.TryParse(parts[index], out numbers[index]) || numbers[index] < 0)
                {
                    return null;
                }
            }
            return new Version(numbers[0], numbers[1], numbers[2], 0);
        }

        private bool CanWriteApplicationDirectory()
        {
            string probe = Path.Combine(
                baseDirectory,
                ".knotes-write-test-" + Guid.NewGuid().ToString("N")
            );
            try
            {
                File.WriteAllText(probe, "test");
                File.Delete(probe);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private async Task<string> DownloadAndVerifyUpdate(
            GitHubRelease release,
            Version remoteVersion,
            GitHubAsset archive,
            GitHubAsset checksums
        )
        {
            string zipPath = Path.Combine(updateDirectory, "update.zip");
            string checksumPath = Path.Combine(updateDirectory, "SHA256SUMS.txt");
            string stagingDirectory = Path.Combine(
                updateDirectory,
                "staging-" + remoteVersion.ToString(3)
            );

            if (File.Exists(zipPath))
            {
                File.Delete(zipPath);
            }
            if (File.Exists(checksumPath))
            {
                File.Delete(checksumPath);
            }
            if (Directory.Exists(stagingDirectory))
            {
                Directory.Delete(stagingDirectory, true);
            }

            UpdateProgressForm progress = new UpdateProgressForm(remoteVersion.ToString(3));
            progress.Show(this);
            try
            {
                await DownloadFile(
                    checksums.browser_download_url,
                    checksumPath,
                    null
                );
                await DownloadFile(
                    archive.browser_download_url,
                    zipPath,
                    progress.ReportProgress
                );
            }
            finally
            {
                progress.Close();
            }

            string expectedHash = FindChecksum(File.ReadAllText(checksumPath), UpdateAssetName);
            string actualHash = ComputeSha256(zipPath);
            if (
                string.IsNullOrWhiteSpace(expectedHash)
                || !string.Equals(expectedHash, actualHash, StringComparison.OrdinalIgnoreCase)
            )
            {
                File.Delete(zipPath);
                throw new InvalidDataException("The downloaded update failed checksum verification.");
            }

            Directory.CreateDirectory(stagingDirectory);
            try
            {
                ExtractArchive(zipPath, stagingDirectory, remoteVersion);
            }
            catch
            {
                Directory.Delete(stagingDirectory, true);
                throw;
            }
            finally
            {
                try
                {
                    File.Delete(zipPath);
                    File.Delete(checksumPath);
                }
                catch
                {
                }
            }
            LogUpdate(
                "Downloaded and verified KNOTES "
                    + remoteVersion.ToString(3)
                    + " from "
                    + release.html_url
            );
            return stagingDirectory;
        }

        private async Task DownloadFile(
            string url,
            string destination,
            Action<int> progress
        )
        {
            using (
                HttpResponseMessage response = await updateHttp.GetAsync(
                    url,
                    HttpCompletionOption.ResponseHeadersRead
                )
            )
            {
                response.EnsureSuccessStatusCode();
                long total = response.Content.Headers.ContentLength ?? -1;
                using (
                    Stream source = await response.Content.ReadAsStreamAsync()
                )
                using (
                    FileStream target = new FileStream(
                        destination,
                        FileMode.Create,
                        FileAccess.Write,
                        FileShare.None,
                        81920,
                        true
                    )
                )
                {
                    byte[] buffer = new byte[81920];
                    long received = 0;
                    int read;
                    while ((read = await source.ReadAsync(buffer, 0, buffer.Length)) > 0)
                    {
                        await target.WriteAsync(buffer, 0, read);
                        received += read;
                        if (progress != null && total > 0)
                        {
                            progress((int)Math.Min(100, received * 100 / total));
                        }
                    }
                }
            }
        }

        private static string FindChecksum(string checksumText, string fileName)
        {
            foreach (string rawLine in checksumText.Split(new[] { '\r', '\n' }))
            {
                string line = rawLine.Trim();
                if (line.Length == 0)
                {
                    continue;
                }
                string[] parts = line.Split(
                    new[] { ' ', '\t' },
                    StringSplitOptions.RemoveEmptyEntries
                );
                if (parts.Length < 2 || parts[0].Length != 64)
                {
                    continue;
                }
                string name = parts[parts.Length - 1].TrimStart('*');
                if (string.Equals(name, fileName, StringComparison.OrdinalIgnoreCase))
                {
                    return parts[0];
                }
            }
            return null;
        }

        private static string ComputeSha256(string path)
        {
            using (SHA256 sha = SHA256.Create())
            using (FileStream stream = File.OpenRead(path))
            {
                byte[] hash = sha.ComputeHash(stream);
                StringBuilder value = new StringBuilder(hash.Length * 2);
                foreach (byte item in hash)
                {
                    value.Append(item.ToString("x2", CultureInfo.InvariantCulture));
                }
                return value.ToString();
            }
        }

        private static void ExtractArchive(
            string zipPath,
            string stagingDirectory,
            Version remoteVersion
        )
        {
            string stagingRoot = Path.GetFullPath(stagingDirectory);
            string stagingPrefix = stagingRoot.TrimEnd(Path.DirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            long expandedSize = 0;

            using (ZipArchive archive = ZipFile.OpenRead(zipPath))
            {
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    expandedSize += entry.Length;
                    if (expandedSize > 512L * 1024 * 1024)
                    {
                        throw new InvalidDataException("The update archive is too large.");
                    }

                    string relative = entry.FullName.Replace('\\', '/');
                    if (relative.EndsWith("/", StringComparison.Ordinal))
                    {
                        continue;
                    }
                    if (relative.StartsWith("/", StringComparison.Ordinal) || relative.Contains(":"))
                    {
                        throw new InvalidDataException("The update archive contains an invalid path.");
                    }
                    string[] segments = relative.Split('/');
                    foreach (string segment in segments)
                    {
                        if (segment.Length == 0 || segment == "." || segment == "..")
                        {
                            throw new InvalidDataException(
                                "The update archive contains an invalid path."
                            );
                        }
                    }

                    string destination = Path.GetFullPath(
                        Path.Combine(
                            stagingDirectory,
                            relative.Replace('/', Path.DirectorySeparatorChar)
                        )
                    );
                    if (!destination.StartsWith(stagingPrefix, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidDataException(
                            "The update archive contains an invalid path."
                        );
                    }
                    string parent = Path.GetDirectoryName(destination);
                    if (!string.IsNullOrEmpty(parent))
                    {
                        Directory.CreateDirectory(parent);
                    }
                    entry.ExtractToFile(destination, true);
                }
            }

            string launcher = Path.Combine(stagingDirectory, "KNOTES.exe");
            string server = Path.Combine(stagingDirectory, "KNOTES-server.exe");
            string core = Path.Combine(
                stagingDirectory,
                "Microsoft.Web.WebView2.Core.dll"
            );
            string winForms = Path.Combine(
                stagingDirectory,
                "Microsoft.Web.WebView2.WinForms.dll"
            );
            string loader = Path.Combine(stagingDirectory, "WebView2Loader.dll");
            if (
                !File.Exists(launcher)
                || !File.Exists(server)
                || !File.Exists(core)
                || !File.Exists(winForms)
                || !File.Exists(loader)
            )
            {
                throw new InvalidDataException("The update archive is incomplete.");
            }

            Version stagedVersion;
            if (
                !Version.TryParse(FileVersionInfo.GetVersionInfo(launcher).FileVersion, out stagedVersion)
                || stagedVersion < remoteVersion
            )
            {
                throw new InvalidDataException(
                    "The update archive does not match the release version."
                );
            }
        }

        private void ApplyUpdate(UpdateState state)
        {
            string staging = state.PendingDirectory;
            if (string.IsNullOrWhiteSpace(staging) || !Directory.Exists(staging))
            {
                MessageBox.Show(
                    this,
                    "The downloaded update is no longer available. Try again later.",
                    "Update KNOTES",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
                state.PendingVersion = null;
                state.PendingDirectory = null;
                SaveUpdateState(state);
                return;
            }

            string script =
                "$ErrorActionPreference = 'Stop'\r\n"
                + "Wait-Process -Id "
                + Process.GetCurrentProcess().Id
                + " -Timeout 90 -ErrorAction SilentlyContinue\r\n"
                + "Start-Sleep -Milliseconds 1200\r\n"
                + "$source = '"
                + EscapePowerShell(staging)
                + "'\r\n"
                + "$destination = '"
                + EscapePowerShell(baseDirectory)
                + "'\r\n"
                + "$log = '"
                + EscapePowerShell(updateLogPath)
                + "'\r\n"
                + "$state = '"
                + EscapePowerShell(UpdateStatePath)
                + "'\r\n"
                + "try {\r\n"
                + "  Get-ChildItem -LiteralPath $source -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force }\r\n"
                + "  Remove-Item -LiteralPath $state -Force -ErrorAction SilentlyContinue\r\n"
                + "  Remove-Item -LiteralPath $source -Recurse -Force -ErrorAction SilentlyContinue\r\n"
                + "  Start-Process -FilePath (Join-Path $destination 'KNOTES.exe')\r\n"
                + "} catch {\r\n"
                + "  Add-Content -LiteralPath $log -Value ((Get-Date).ToUniversalTime().ToString('o') + ' Update install failed: ' + $_.Exception.Message)\r\n"
                + "  Add-Type -AssemblyName System.Windows.Forms\r\n"
                + "  [System.Windows.Forms.MessageBox]::Show('KNOTES could not install the update. Download it again from GitHub Releases.', 'KNOTES', 'OK', 'Error') | Out-Null\r\n"
                + "}\r\n";

            try
            {
                string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
                ProcessStartInfo startInfo = new ProcessStartInfo();
                startInfo.FileName = "powershell.exe";
                startInfo.Arguments =
                    "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand "
                    + encoded;
                startInfo.UseShellExecute = false;
                startInfo.CreateNoWindow = true;
                startInfo.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(startInfo);
            }
            catch (Exception error)
            {
                LogUpdate("Could not start updater: " + error.Message);
                MessageBox.Show(
                    this,
                    "KNOTES could not start the updater. Download the update from GitHub Releases.",
                    "Update KNOTES",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            closing = true;
            Close();
        }

        private static string EscapePowerShell(string value)
        {
            return value.Replace("'", "''");
        }

        private void OnFormClosing(object sender, FormClosingEventArgs args)
        {
            closing = true;
            SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
            if (webView != null)
            {
                webView.Dispose();
            }
            http.Dispose();
            if (updateHttp != null)
            {
                updateHttp.Dispose();
            }
            if (ownsServer && serverProcess != null && !serverProcess.HasExited)
            {
                try
                {
                    serverProcess.Kill();
                    serverProcess.WaitForExit(3000);
                }
                catch
                {
                }
            }
        }
    }

    internal sealed class UpdateProgressForm : Form
    {
        private readonly string version;
        private readonly ProgressBar progressBar;
        private readonly Label statusLabel;

        public UpdateProgressForm(string version)
        {
            this.version = version;
            Text = "Updating KNOTES";
            StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ShowInTaskbar = false;
            ControlBox = false;
            ClientSize = new Size(430, 120);
            Padding = new Padding(20);

            statusLabel = new Label();
            statusLabel.AutoSize = false;
            statusLabel.Dock = DockStyle.Top;
            statusLabel.Height = 38;
            statusLabel.Text = "Downloading KNOTES " + version + "...";
            Controls.Add(statusLabel);

            progressBar = new ProgressBar();
            progressBar.Dock = DockStyle.Top;
            progressBar.Height = 18;
            progressBar.Minimum = 0;
            progressBar.Maximum = 100;
            progressBar.Style = ProgressBarStyle.Continuous;
            Controls.Add(progressBar);
        }

        public void ReportProgress(int percent)
        {
            if (IsDisposed)
            {
                return;
            }
            if (InvokeRequired)
            {
                BeginInvoke(new Action<int>(ReportProgress), percent);
                return;
            }
            int value = Math.Max(0, Math.Min(100, percent));
            progressBar.Value = value;
            statusLabel.Text =
                "Downloading KNOTES " + version + "... " + value.ToString() + "%";
        }
    }
}
