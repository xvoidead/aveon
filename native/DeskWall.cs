// DeskWall: вешает окно живых обоев авеона за иконки рабочего стола (как Wallpaper Engine).
// Собирается встроенным csc.exe при первом включении (src/livewall.js).
//   DeskWall.exe attach <hwnd>  — сделать окно частью рабочего стола
//   DeskWall.exe refresh        — перерисовать обычные обои (после выключения живых)
using System;
using System.Runtime.InteropServices;
using System.Text;

class DeskWall
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr res);
    [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SystemParametersInfo(uint action, uint param, StringBuilder pv, uint flags);
    delegate bool EnumProc(IntPtr h, IntPtr l);

    static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "refresh")
        {
            // SPI_GETDESKWALLPAPER → SPI_SETDESKWALLPAPER с тем же файлом: Windows перерисует фон
            var path = new StringBuilder(520);
            SystemParametersInfo(0x0073, 520, path, 0);
            SystemParametersInfo(0x0014, 0, path, 0x02);
            Console.WriteLine("ok");
            return 0;
        }
        if (args.Length < 2 || args[0] != "attach") { Console.Error.WriteLine("usage: attach <hwnd> | refresh"); return 2; }

        IntPtr me = new IntPtr(long.Parse(args[1]));
        IntPtr progman = FindWindow("Progman", null);
        IntPtr res;
        // Просим проводник создать WorkerW за иконками (то же делает Windows при смене обоев)
        SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(0x1), 0, 1000, out res);
        SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out res);

        IntPtr worker = IntPtr.Zero;
        // Windows 11 24H2 и новее: WorkerW — дочернее окно Progman
        IntPtr inner = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        if (inner != IntPtr.Zero) worker = inner;
        else
        {
            // Раньше: WorkerW — соседнее окно сразу после того, где лежат иконки (SHELLDLL_DefView)
            EnumWindows((h, l) =>
            {
                if (FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
                    worker = FindWindowEx(IntPtr.Zero, h, "WorkerW", null);
                return true;
            }, IntPtr.Zero);
        }
        if (worker == IntPtr.Zero) { Console.Error.WriteLine("Не нашёл слой рабочего стола (WorkerW)"); return 1; }
        SetParent(me, worker);
        Console.WriteLine("ok");
        return 0;
    }
}
