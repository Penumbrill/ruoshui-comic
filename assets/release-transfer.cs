using System;
using System.IO;
using System.Net;
using System.Linq;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

public static class RuoshuiReleaseTransfer {
    public static long ChunkBytes = 64L * 1024 * 1024;
    public static int TimeoutMilliseconds = 15000;
    public static int ReadTimeoutMilliseconds = 45000;
    public static int RetryDelayMilliseconds = 1000;
    sealed class Route { public string Url; public IWebProxy Proxy; public double Speed; public bool Ranges; }
    static void Safe(string file) {
        if ((File.Exists(file) || Directory.Exists(file)) && (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("Linked download cache path");
    }
    static string Hash(string file) {
        using (var hash = SHA256.Create()) using (var input = File.OpenRead(file))
            return BitConverter.ToString(hash.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
    }
    static HttpWebResponse Open(Route route, long start, long end, int timeout = 0) {
        var request = (HttpWebRequest)WebRequest.Create(route.Url);
        request.Proxy = route.Proxy; request.UserAgent = "RuoshuiComic-Installer"; request.Accept = "application/octet-stream";
        request.Timeout = timeout > 0 ? timeout : TimeoutMilliseconds; request.ReadWriteTimeout = ReadTimeoutMilliseconds;
        request.AddRange(start, end); return (HttpWebResponse)request.GetResponse();
    }
    static void Range(HttpWebResponse response, long start, long end, long size) {
        if ((int)response.StatusCode != 206 || response.Headers["Content-Range"] != "bytes " + start + "-" + end + "/" + size)
            throw new IOException("Incorrect download range");
        if ((response.ContentType ?? "").Contains("text/html") || (response.ContentType ?? "").Contains("json"))
            throw new IOException("Source returned metadata instead of a package");
    }
    static Route Probe(Route route, long size) {
        try {
            long length = Math.Min(4L * 1024 * 1024, size), bytes = 0;
            var watch = Stopwatch.StartNew();
            using (var response = Open(route, 0, length - 1, Math.Min(8000, TimeoutMilliseconds))) {
                route.Ranges = (int)response.StatusCode == 206;
                if (route.Ranges) Range(response, 0, length - 1, size);
                else if ((int)response.StatusCode != 200 || (response.ContentType ?? "").Contains("text/")) return null;
                using (var input = response.GetResponseStream()) {
                    input.ReadTimeout = Math.Min(ReadTimeoutMilliseconds, 8000);
                    var buffer = new byte[256 * 1024];
                    while (bytes < length) {
                        int read = input.Read(buffer, 0, (int)Math.Min(buffer.Length, length - bytes));
                        if (read == 0) return null;
                        bytes += read; if (watch.ElapsedMilliseconds > 10000) break;
                    }
                }
            }
            route.Speed = bytes / Math.Max(.001, watch.Elapsed.TotalSeconds); return route;
        } catch { return null; }
    }
    static List<Route> Routes(string[] urls, IWebProxy[] proxies, long size, bool preferProxy) {
        var options = new List<Route>();
        proxies = (proxies ?? new IWebProxy[0]).Concat(new IWebProxy[] { null }).Distinct().ToArray();
        foreach (var url in urls) foreach (var proxy in proxies) {
            var actual = proxy != null && proxy.IsBypassed(new Uri(url)) ? null : proxy;
            if (!options.Any(r => r.Url == url && r.Proxy == actual)) options.Add(new Route { Url = url, Proxy = actual });
        }
        var usable = new List<Route>(); var gate = new object();
        Parallel.ForEach(options, new ParallelOptions { MaxDegreeOfParallelism = 4 }, option => {
            var result = Probe(option, size); if (result != null) lock (gate) usable.Add(result);
        });
        if (usable.Count == 0) throw new IOException("No reachable release download source");
        var ordered = usable.OrderByDescending(r => r.Speed).ToList();
        var primary = options.Count > 0 ? usable.FirstOrDefault(r => r == options[0]) : null;
        if (preferProxy && primary != null && primary.Speed >= ordered[0].Speed * .8) {
            ordered.Remove(primary); ordered.Insert(0, primary);
        }
        return ordered;
    }
    static void Publish(string staging, string file, long size, string sha) {
        if (new FileInfo(staging).Length != size || Hash(staging) != sha.ToLowerInvariant()) {
            File.Move(staging, staging + ".invalid-" + DateTime.UtcNow.Ticks);
            throw new IOException("Package SHA256 mismatch; invalid content quarantined");
        }
        Safe(file); if (File.Exists(file)) File.Delete(file); File.Move(staging, file);
    }
    static void Single(List<Route> routes, string file, long size, string sha) {
        string staging = file + ".single"; Safe(staging);
        if (!File.Exists(staging) && File.Exists(file) && new FileInfo(file).Length < size) File.Copy(file, staging);
        for (int attempt = 0; attempt < 8; attempt++) {
            var route = routes[attempt % routes.Count];
            try {
                long offset = File.Exists(staging) ? new FileInfo(staging).Length : 0;
                if (offset == size) { Publish(staging, file, size, sha); return; }
                if (offset > size) throw new IOException("Invalid cached package length");
                using (var response = Open(route, offset, size - 1)) {
                    if ((int)response.StatusCode == 206) Range(response, offset, size - 1, size);
                    else if ((int)response.StatusCode == 200) offset = 0;
                    else throw new IOException("Release source rejected request");
                    using (var input = response.GetResponseStream())
                    using (var output = new FileStream(staging, offset > 0 ? FileMode.Append : FileMode.Create, FileAccess.Write)) {
                        var buffer = new byte[256 * 1024]; int read;
                        try { while ((read = input.Read(buffer, 0, buffer.Length)) > 0) {
                            if (offset + read > size) throw new IOException("Package exceeds expected size");
                            output.Write(buffer, 0, read); offset += read;
                        }} finally { output.Flush(true); }
                    }
                }
                Publish(staging, file, size, sha); return;
            } catch { if (attempt == 7) throw; Thread.Sleep(Math.Min(5, attempt + 1) * RetryDelayMilliseconds); }
        }
    }
    public static void Download(string[] urls, IWebProxy[] proxies, string file, long size, string sha, bool preferProxy) {
        if (size <= 0 || !System.Text.RegularExpressions.Regex.IsMatch(sha, "^[a-fA-F0-9]{64}$")) throw new IOException("Invalid transfer manifest");
        foreach (var url in urls) if (new Uri(url).Scheme != "https" && !new Uri(url).IsLoopback) throw new IOException("Insecure release URL");
        ServicePointManager.DefaultConnectionLimit = Math.Max(16, ServicePointManager.DefaultConnectionLimit);
        ServicePointManager.Expect100Continue = false;
        Safe(file); Safe(file + ".lock");
        using (var transferLock = new FileStream(file + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) {
            var routes = Routes(urls, proxies, size, preferProxy);
            Console.WriteLine("Source: " + new Uri(routes[0].Url).Host);
            if (!routes[0].Ranges) { Single(routes, file, size, sha); return; }
            string parts = file + ".parts-" + sha.Substring(0, 16) + "-" + ChunkBytes; Safe(parts); Directory.CreateDirectory(parts);
            int count = (int)((size + ChunkBytes - 1) / ChunkBytes); var names = new string[count];
            long legacy = File.Exists(file) ? new FileInfo(file).Length : 0;
            for (int index = 0; index < count; index++) {
                names[index] = Path.Combine(parts, index.ToString("D6") + ".part"); Safe(names[index]);
                long start = index * ChunkBytes, length = Math.Min(ChunkBytes, size - start);
                if (!File.Exists(names[index]) && legacy < size && legacy > start) {
                    using (var input = File.OpenRead(file)) using (var output = File.Create(names[index])) {
                        input.Position = start; long left = Math.Min(length, legacy - start); var buffer = new byte[256 * 1024];
                        while (left > 0) { int read = input.Read(buffer, 0, (int)Math.Min(buffer.Length, left)); if (read == 0) break; output.Write(buffer, 0, read); left -= read; }
                        output.Flush(true);
                    }
                }
                if (File.Exists(names[index]) && new FileInfo(names[index]).Length > length) throw new IOException("Invalid partial range length");
            }
            long initial = names.Sum(name => File.Exists(name) ? new FileInfo(name).Length : 0), bytes = initial;
            int lastPercent = -5; var watch = Stopwatch.StartNew(); var progressGate = new object();
            Parallel.ForEach(Enumerable.Range(0, count), new ParallelOptions { MaxDegreeOfParallelism = 4 }, index => {
                long start = index * ChunkBytes, length = Math.Min(ChunkBytes, size - start);
                for (int attempt = 0; attempt < 8; attempt++) {
                    long offset = File.Exists(names[index]) ? new FileInfo(names[index]).Length : 0;
                    if (offset == length) return;
                    var route = routes[attempt % routes.Count];
                    try {
                        using (var response = Open(route, start + offset, start + length - 1)) {
                            Range(response, start + offset, start + length - 1, size);
                            using (var input = response.GetResponseStream())
                            using (var output = new FileStream(names[index], FileMode.Append, FileAccess.Write, FileShare.Read)) {
                                var buffer = new byte[256 * 1024];
                                try { while (offset < length) {
                                    int read = input.Read(buffer, 0, (int)Math.Min(buffer.Length, length - offset));
                                    if (read == 0) throw new IOException("Download disconnected");
                                    output.Write(buffer, 0, read); offset += read; long total = Interlocked.Add(ref bytes, read);
                                    int percent = (int)(100 * total / size);
                                    lock (progressGate) if (percent >= lastPercent + 5) { lastPercent = percent; Console.WriteLine("Downloaded " + percent + "%; " + ((total - initial) / 1048576.0 / Math.Max(.1, watch.Elapsed.TotalSeconds)).ToString("F1") + " MiB/s"); }
                                }} finally { output.Flush(true); }
                            }
                        }
                        return;
                    } catch { if (attempt == 7) throw; Thread.Sleep(Math.Min(5, attempt + 1) * RetryDelayMilliseconds); }
                }
            });
            string assembly = file + ".assembling"; Safe(assembly);
            using (var output = File.Create(assembly)) {
                foreach (var name in names) using (var input = File.OpenRead(name)) input.CopyTo(output);
                output.Flush(true);
            }
            try { Publish(assembly, file, size, sha); }
            catch { Directory.Move(parts, parts + ".invalid-" + DateTime.UtcNow.Ticks); if (File.Exists(file)) File.Move(file, file + ".invalid-" + DateTime.UtcNow.Ticks); throw; }
            foreach (var name in names) File.Delete(name); Directory.Delete(parts, false);
            Console.WriteLine("Package SHA256 verified");
        }
    }
}
