// DuckMon: следит за звуком Discord через Windows Core Audio и приглушает чужие приложения.
// Собирается встроенным csc.exe из .NET Framework 4 (синтаксис C# 5).
//
// stdout (JSON-строка ~30 раз в секунду):
//   {"o":0.12,"m":0.03,"call":1,"dc":1,"ext":2}
//   o    — пиковый уровень звука, который воспроизводит Discord (голоса собеседников)
//   m    — пиковый уровень микрофона, который захватывает Discord (твой голос)
//   call — 1, если Discord сейчас держит микрофон (ты в голосовом канале)
//   dc   — 1, если у Discord есть хоть одна аудиосессия
//   ext  — сколько сессий внешних приложений сейчас под управлением
// stdin:
//   targets spotify,chrome   — какие процессы приглушать (без .exe)
//   duck 0.35                — множитель громкости для них (1 = не трогать)
//   quit                     — вернуть громкость и выйти

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Tishe
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorCom { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IntPtr store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator enumerator);
        [PreserveSig] int RegisterSessionNotification(IntPtr notification);
        [PreserveSig] int UnregisterSessionNotification(IntPtr notification);
        [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr notification);
        [PreserveSig] int UnregisterDuckNotification(IntPtr notification);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid ctx);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid ctx);
        [PreserveSig] int GetGroupingParam(out Guid param);
        [PreserveSig] int SetGroupingParam(ref Guid param, ref Guid ctx);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint pid);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioMeterInformation
    {
        [PreserveSig] int GetPeakValue(out float peak);
        [PreserveSig] int GetMeteringChannelCount(out int count);
        [PreserveSig] int GetChannelsPeakValues(int count, IntPtr values);
        [PreserveSig] int QueryHardwareSupport(out int mask);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid ctx);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    class Session
    {
        public string Key;
        public string Proc;
        public bool Capture;
        public IAudioSessionControl2 Control;
        public IAudioMeterInformation Meter;
        public ISimpleAudioVolume Volume;
        public uint Pid;
        public string Device;
    }

    // Программы, которые пишут весь звук системы (NVIDIA Instant Replay, OBS, Medal…), Windows показывает
    // так же, как Discord: пик их сессии — это пик всего микса, вместе с голосами. Если сложить их
    // с остальными программами, вычитание съедает голоса целиком. Такие «зеркала» узнаём по поведению:
    // пик совпадает с пиком Discord, когда рядом звучит программа с заметно другим уровнем
    // (настоящая программа совпасть с миксом в этот момент не может), и не вычитаем их.
    static class Mirrors
    {
        const int Need = 8, Max = 40;
        static readonly Dictionary<string, int> score = new Dictionary<string, int>();
        // Известные записыватели звука считаем зеркалами сразу: пока звучит только музыка,
        // по поведению их не отличить от самого плеера, а голос съедался бы с первой фразы
        static readonly HashSet<string> Known = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "nvcontainer" };

        public static void Seed(string key, string proc)
        {
            if (proc != null && Known.Contains(proc) && !score.ContainsKey(key)) score[key] = Max;
        }

        public static bool Is(string key)
        {
            int s;
            return score.TryGetValue(key, out s) && s >= Need;
        }

        static bool Same(float a, float d) { return Math.Abs(a - d) <= Math.Max(0.0002f, d * 0.01f); }

        // d — пик Discord на устройстве, peaks — пики остальных сессий вывода там же.
        // Возвращает сумму пиков программ, чей звук Discord захватил, без зеркал.
        public static float OthersSum(float d, List<KeyValuePair<string, float>> peaks)
        {
            if (peaks == null) return 0;
            if (d >= 0.005f)
            {
                bool otherSound = false;
                foreach (var p in peaks)
                    if (p.Value >= Math.Max(0.002f, d * 0.25f) && !Same(p.Value, d)) { otherSound = true; break; }
                foreach (var p in peaks)
                {
                    int s;
                    score.TryGetValue(p.Key, out s);
                    if (Same(p.Value, d)) { if (otherSound) s = Math.Min(Max, s + 1); }
                    else if (Math.Abs(p.Value - d) > d * 0.2f) s = Math.Max(0, s - 1);
                    score[p.Key] = s;
                }
            }
            float sum = 0;
            foreach (var p in peaks) if (!Is(p.Key)) sum += p.Value;
            return sum;
        }
    }

    // Активное окно: чей это процесс. Плеер по имени узнаёт игру (src/games.js) и прячет остров.
    // Имя спрашиваем только когда сменился процесс — остальное время это два дешёвых вызова
    static class Foreground
    {
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

        static uint lastPid;
        static string lastName = "";

        public static string Name()
        {
            try
            {
                uint pid;
                GetWindowThreadProcessId(GetForegroundWindow(), out pid);
                if (pid == 0) return "";
                if (pid != lastPid)
                {
                    lastPid = pid;
                    try { using (var p = Process.GetProcessById((int)pid)) lastName = p.ProcessName; } catch { lastName = ""; }
                }
                return lastName;
            }
            catch { return ""; }
        }

        // для JSON: кавычки и обратные косые экранируем, управляющие символы выкидываем
        public static string Json(string s)
        {
            var sb = new StringBuilder();
            foreach (char c in s)
            {
                if (c == '"' || c == '\\') sb.Append('\\');
                if (c >= ' ') sb.Append(c);
            }
            return sb.ToString();
        }
    }

    static class Program
    {
        const int eRender = 0, eCapture = 1, DEVICE_STATE_ACTIVE = 1, CLSCTX_ALL = 23, AudioSessionStateActive = 1;
        static Guid IID_IAudioSessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
        static Guid EventContext = new Guid("5a1b7f3e-7d5c-4e1c-9a51-7e15e0000001");

        static readonly object Sync = new object();
        static volatile bool quit;
        static volatile bool rescanRequested = true;
        static HashSet<string> targets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        static float duck = 1f;

        static List<Session> sessions = new List<Session>();
        // Громкость внешних сессий до приглушения: ключ = instance id сессии
        static Dictionary<string, float> originals = new Dictionary<string, float>();
        static Dictionary<string, float> applied = new Dictionary<string, float>();
        static Dictionary<uint, string> procNames = new Dictionary<uint, string>();

        static bool debug;

        [MTAThread]
        static int Main(string[] args)
        {
            debug = Array.IndexOf(args, "--debug") >= 0;
            Console.OutputEncoding = new UTF8Encoding(false);
            var reader = new Thread(ReadStdin);
            reader.IsBackground = true;
            reader.Start();

            IMMDeviceEnumerator enumerator;
            try { enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); }
            catch (Exception e) { Console.Error.WriteLine("init failed: " + e.Message); return 1; }

            var sw = Stopwatch.StartNew();
            long lastScan = -100000;
            var inv = CultureInfo.InvariantCulture;
            long lastDebug = -1;

            while (!quit)
            {
                if (rescanRequested || sw.ElapsedMilliseconds - lastScan > 1500)
                {
                    rescanRequested = false;
                    lastScan = sw.ElapsedMilliseconds;
                    try { Rescan(enumerator); } catch (Exception e) { Console.Error.WriteLine("scan: " + e.Message); }
                }

                float micPeak = 0;
                bool inCall = false, discord = false;
                int ext = 0;
                float factor;
                lock (Sync) factor = duck;

                // Discord (эхоподавление, стрим со звуком) захватывает весь звук колонок, и Windows
                // засчитывает этот захват в его же сессию. Поэтому пик сессии Discord ≈ голоса + всё,
                // что играют другие программы. Считаем по каждому устройству: пик Discord и сумму
                // пиков остальных программ, а голосом считаем только то, что сверх этой суммы.
                var discordPeak = new Dictionary<string, float>();
                var othersPeaks = new Dictionary<string, List<KeyValuePair<string, float>>>();

                foreach (var s in sessions)
                {
                    try
                    {
                        float p = 0;
                        bool metered = s.Meter != null && s.Meter.GetPeakValue(out p) == 0;
                        if (IsDiscord(s.Proc))
                        {
                            discord = true;
                            if (s.Capture)
                            {
                                if (metered) micPeak = Math.Max(micPeak, p);
                                int st;
                                if (s.Control.GetState(out st) == 0 && st == AudioSessionStateActive) inCall = true;
                            }
                            else if (metered)
                            {
                                float cur;
                                discordPeak.TryGetValue(s.Device, out cur);
                                discordPeak[s.Device] = Math.Max(cur, p);
                            }
                        }
                        else if (!s.Capture)
                        {
                            if (metered)
                            {
                                List<KeyValuePair<string, float>> list;
                                if (!othersPeaks.TryGetValue(s.Device, out list)) othersPeaks[s.Device] = list = new List<KeyValuePair<string, float>>();
                                list.Add(new KeyValuePair<string, float>(s.Key, p));
                                Mirrors.Seed(s.Key, s.Proc);
                            }
                            if (s.Volume != null && IsTarget(s.Proc))
                            {
                                ext++;
                                ApplyVolume(s, factor);
                            }
                        }
                    }
                    catch { rescanRequested = true; }
                }

                float outPeak = 0, rawPeak = 0, mixPeak = 0;
                foreach (var kv in discordPeak)
                {
                    List<KeyValuePair<string, float>> list;
                    othersPeaks.TryGetValue(kv.Key, out list);
                    float others = Mirrors.OthersSum(kv.Value, list);
                    rawPeak = Math.Max(rawPeak, kv.Value);
                    mixPeak = Math.Max(mixPeak, others);
                    // Небольшой запас на то, что счётчики снимаются не в один и тот же миг
                    outPeak = Math.Max(outPeak, kv.Value - others * 1.1f);
                }
                if (outPeak < 0) outPeak = 0;

                if (debug && sw.ElapsedMilliseconds / 500 != lastDebug)
                {
                    lastDebug = sw.ElapsedMilliseconds / 500;
                    foreach (var s in sessions)
                    {
                        float p = -1; int st = -1;
                        try { if (s.Meter != null) s.Meter.GetPeakValue(out p); s.Control.GetState(out st); } catch { }
                        Console.Error.WriteLine((s.Capture ? "CAP " : Mirrors.Is(s.Key) ? "MIR " : "OUT ") + s.Proc + " pid=" + s.Pid + " state=" + st +
                            " peak=" + p.ToString("0.0000", inv) + " dev=" + (s.Device.Length > 12 ? s.Device.Substring(s.Device.Length - 12) : s.Device));
                    }
                    Console.Error.WriteLine("--");
                }

                // Отпускаем сессии, которые больше не в списке целей
                if (factor >= 0.999f && originals.Count > 0) RestoreAll();

                Console.Out.Write("{\"o\":" + outPeak.ToString("0.0000", inv) +
                                  ",\"m\":" + micPeak.ToString("0.0000", inv) +
                                  ",\"raw\":" + rawPeak.ToString("0.0000", inv) +
                                  ",\"mix\":" + mixPeak.ToString("0.0000", inv) +
                                  ",\"call\":" + (inCall ? 1 : 0) +
                                  ",\"dc\":" + (discord ? 1 : 0) +
                                  ",\"ext\":" + ext +
                                  ",\"fg\":\"" + Foreground.Json(Foreground.Name()) + "\"}\n");
                Console.Out.Flush();
                Thread.Sleep(33);
            }

            RestoreAll();
            return 0;
        }

        static bool IsDiscord(string proc)
        {
            return proc != null && proc.StartsWith("discord", StringComparison.OrdinalIgnoreCase);
        }

        static bool IsTarget(string proc)
        {
            if (proc == null) return false;
            lock (Sync) return targets.Contains(proc);
        }

        static void ApplyVolume(Session s, float factor)
        {
            if (factor >= 0.999f)
            {
                Restore(s);
                return;
            }
            float orig;
            if (!originals.TryGetValue(s.Key, out orig))
            {
                if (s.Volume.GetMasterVolume(out orig) != 0) return;
                originals[s.Key] = orig;
            }
            float want = Clamp01(orig * factor);
            float last;
            if (applied.TryGetValue(s.Key, out last) && Math.Abs(last - want) < 0.004f) return;
            if (s.Volume.SetMasterVolume(want, ref EventContext) == 0) applied[s.Key] = want;
        }

        static void Restore(Session s)
        {
            float orig;
            if (!originals.TryGetValue(s.Key, out orig)) return;
            try { s.Volume.SetMasterVolume(orig, ref EventContext); } catch { }
            originals.Remove(s.Key);
            applied.Remove(s.Key);
        }

        static void RestoreAll()
        {
            foreach (var s in sessions)
                if (s.Volume != null && originals.ContainsKey(s.Key)) Restore(s);
            originals.Clear();
            applied.Clear();
        }

        static float Clamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

        static string ProcName(uint pid)
        {
            string name;
            if (procNames.TryGetValue(pid, out name)) return name;
            try { name = Process.GetProcessById((int)pid).ProcessName; }
            catch { name = null; }
            procNames[pid] = name;
            return name;
        }

        static void Rescan(IMMDeviceEnumerator enumerator)
        {
            var found = new List<Session>();
            var seen = new HashSet<string>();
            procNames.Clear();
            ScanFlow(enumerator, eRender, found, seen);
            ScanFlow(enumerator, eCapture, found, seen);

            // Сессии, которые мы приглушили, но они пропали из новой выборки (перестали быть целью) — вернуть громкость
            foreach (var old in sessions)
            {
                if (old.Volume == null || !originals.ContainsKey(old.Key)) continue;
                bool stillTarget = false;
                foreach (var n in found) if (n.Key == old.Key && IsTarget(n.Proc)) { stillTarget = true; break; }
                if (!stillTarget) Restore(old);
            }
            sessions = found;
        }

        static void ScanFlow(IMMDeviceEnumerator enumerator, int flow, List<Session> found, HashSet<string> seen)
        {
            IMMDeviceCollection devices;
            if (enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE, out devices) != 0 || devices == null) return;
            int count;
            devices.GetCount(out count);
            for (int d = 0; d < count; d++)
            {
                IMMDevice device;
                if (devices.Item(d, out device) != 0 || device == null) continue;
                string devId;
                if (device.GetId(out devId) != 0) devId = "?";
                object mgrObj;
                if (device.Activate(ref IID_IAudioSessionManager2, CLSCTX_ALL, IntPtr.Zero, out mgrObj) != 0 || mgrObj == null) continue;
                var mgr = (IAudioSessionManager2)mgrObj;
                IAudioSessionEnumerator sessEnum;
                if (mgr.GetSessionEnumerator(out sessEnum) != 0 || sessEnum == null) continue;
                int n;
                sessEnum.GetCount(out n);
                for (int i = 0; i < n; i++)
                {
                    try
                    {
                        object raw;
                        if (sessEnum.GetSession(i, out raw) != 0 || raw == null) continue;
                        var ctl = (IAudioSessionControl2)raw;
                        uint pid;
                        // Системные звуки и сессии нескольких процессов дают pid 0 / код успеха ≠ 0
                        if (ctl.GetProcessId(out pid) < 0) pid = 0;
                        string proc = pid == 0 ? "system" : ProcName(pid);
                        // На выводе нужны все сессии — их звук вычитается из захвата Discord
                        bool wanted = flow == eRender || IsDiscord(proc);
                        if (!wanted) continue;
                        string key;
                        ctl.GetSessionInstanceIdentifier(out key);
                        key = (flow == eCapture ? "c|" : "r|") + (key ?? pid.ToString());
                        if (!seen.Add(key)) continue;
                        var s = new Session();
                        s.Key = key;
                        s.Proc = proc;
                        s.Pid = pid;
                        s.Device = devId;
                        s.Capture = flow == eCapture;
                        s.Control = ctl;
                        s.Meter = raw as IAudioMeterInformation;
                        s.Volume = raw as ISimpleAudioVolume;
                        found.Add(s);
                    }
                    catch { }
                }
            }
        }

        static void ReadStdin()
        {
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (line.Length == 0) continue;
                    int sp = line.IndexOf(' ');
                    string cmd = sp < 0 ? line : line.Substring(0, sp);
                    string arg = sp < 0 ? "" : line.Substring(sp + 1).Trim();
                    if (cmd == "quit") break;
                    if (cmd == "targets")
                    {
                        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                        foreach (var t in arg.Split(','))
                        {
                            var name = t.Trim();
                            if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name.Substring(0, name.Length - 4);
                            if (name.Length > 0 && !IsDiscord(name)) set.Add(name);
                        }
                        lock (Sync) targets = set;
                        rescanRequested = true;
                    }
                    else if (cmd == "duck")
                    {
                        float v;
                        if (float.TryParse(arg, NumberStyles.Float, CultureInfo.InvariantCulture, out v))
                            lock (Sync) duck = Clamp01(v);
                    }
                }
            }
            catch { }
            quit = true; // stdin закрылся — родитель умер, возвращаем громкость и выходим
        }
    }
}
