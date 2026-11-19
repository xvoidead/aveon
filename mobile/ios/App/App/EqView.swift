import SwiftUI
import Foundation

// Эквалайзер: полосы, пресеты и свои настройки. На компьютере это отдельное окно поверх
// плеера, на телефоне — обычный экран: звук тот же, полосы те же.
struct EqView: View {
    @ObservedObject var engine = Engine.shared
    @Environment(\.dismiss) private var dismiss

    @State private var eq = EqState()
    @State private var name = ""
    @State private var showName = false
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    preamp
                    bands
                    presets
                    mine
                }
                .padding(.horizontal, 18)
                .padding(.top, 6)
                .padding(.bottom, 40)
            }
            .background(Pal.apple.bg)
            .navigationTitle("Эквалайзер")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Готово") { dismiss() }
                        .foregroundColor(Pal.apple.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await load() }
        .alert("Свои полосы", isPresented: $showName) {
            TextField("Название", text: $name)
            Button("Отмена", role: .cancel) { name = "" }
            Button("Сохранить") { saveMine() }
        }
    }

    // ---------- вкл/выкл ----------

    private var header: some View {
        HStack(spacing: 12) {
            Toggle(isOn: Binding(
                get: { eq.enabled },
                set: { engine.send("eqSet", [["enabled": $0]]) }
            )) {
                Text("Эквалайзер")
                    .font(T.headline)
                    .foregroundColor(.white)
            }
            .tint(Pal.apple.accent)
            Spacer()
            Text(eq.name.isEmpty ? "свои полосы" : eq.name)
                .font(T.footnote)
                .foregroundColor(.white.opacity(0.6))
        }
    }

    // ---------- предусиление ----------

    private var preamp: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Предусиление")
                    .font(T.subheadM)
                    .foregroundColor(.white)
                Spacer()
                Text(String(format: "%+.1f дБ", eq.preamp))
                    .font(T.footnote)
                    .foregroundColor(.white.opacity(0.6))
                    .monospacedDigit()
            }
            Slider(
                value: Binding(
                    get: { eq.preamp },
                    set: { eq.preamp = $0 }
                ),
                in: -eq.max...eq.max
            )
            .onEditingChanged { editing in
                if !editing { apply() }
            }
            .tint(Pal.apple.accent)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .glass(corner: 18)
    }

    // ---------- полосы ----------

    private var bands: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Полосы")
            VStack(spacing: 4) {
                ForEach(Array(eq.freqs.enumerated()), id: \.offset) { index, freq in
                    bandRow(index: index, freq: freq)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .glass(corner: 18)
        }
    }

    private func bandRow(index: Int, freq: Int) -> some View {
        let gain = index < eq.gains.count ? eq.gains[index] : 0
        return HStack(spacing: 12) {
            Text(freqLabel(freq))
                .font(T.caption)
                .foregroundColor(.white.opacity(0.6))
                .frame(width: 52, alignment: .leading)
            Slider(
                value: Binding(
                    get: { index < eq.gains.count ? eq.gains[index] : 0 },
                    set: { value in
                        var gains = eq.gains
                        while gains.count <= index { gains.append(0) }
                        gains[index] = value
                        eq.gains = gains
                    }
                ),
                in: -eq.max...eq.max
            )
            .onEditingChanged { editing in
                if !editing { apply() }
            }
            .tint(Pal.apple.accent)
            Text(String(format: "%+.0f", gain))
                .font(T.caption)
                .foregroundColor(.white.opacity(0.6))
                .monospacedDigit()
                .frame(width: 34, alignment: .trailing)
        }
    }

    private func freqLabel(_ hz: Int) -> String {
        hz >= 1000 ? "\(hz / 1000)к" : "\(hz)"
    }

    // ---------- пресеты ----------

    private var presets: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Пресеты")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(eq.presets) { preset in
                        Button {
                            engine.send("eqSet", [["preset": preset.id]])
                            Task { await load(force: true) }
                        } label: {
                            Text(preset.name)
                                .font(T.footnoteM)
                                .foregroundColor(eq.preset == preset.id ? .black : .white)
                                .padding(.horizontal, 13).padding(.vertical, 8)
                                .background(Capsule().fill(eq.preset == preset.id ? Color.white : Color.white.opacity(0.12)))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // ---------- свои пресеты ----------

    private var mine: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Свои", action: "Сохранить") {
                showName = true
            }
            let custom = eq.presets.filter { $0.mine }
            if custom.isEmpty {
                Text("Своих пресетов пока нет — подкрути полосы и сохрани")
                    .font(T.footnote)
                    .foregroundColor(.white.opacity(0.5))
            } else {
                VStack(spacing: 0) {
                    ForEach(custom) { preset in
                        HStack(spacing: 12) {
                            Button {
                                engine.send("eqSet", [["preset": preset.id]])
                                Task { await load(force: true) }
                            } label: {
                                Text(preset.name)
                                    .font(T.subheadM)
                                    .foregroundColor(.white)
                            }
                            .buttonStyle(.plain)
                            Spacer()
                            Button {
                                engine.send("eqShare", [preset.id])
                            } label: {
                                Image(systemName: "square.and.arrow.up")
                                    .font(.system(size: 14))
                                    .foregroundColor(.white.opacity(0.6))
                            }
                            .buttonStyle(.plain)
                            Button {
                                engine.send("eqDeleteMine", [preset.id])
                                Task { await load(force: true) }
                            } label: {
                                Image(systemName: "trash")
                                    .font(.system(size: 14))
                                    .foregroundColor(Pal.apple.danger)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.vertical, 9)
                    }
                }
                .padding(.horizontal, 14)
                .glass(corner: 18)
            }
        }
    }

    // ---------- движок ----------

    private func apply() {
        engine.send("eqSet", [["gains": eq.gains, "preamp": eq.preamp]])
    }

    private func saveMine() {
        let title = name.trimmingCharacters(in: .whitespaces)
        name = ""
        guard !title.isEmpty else { return }
        engine.send("eqSaveMine", [title])
        Task { await load(force: true) }
    }

    private func load(force: Bool = false) async {
        if loaded && !force { return }
        guard let o = await engine.obj("eq") else { return }
        eq = EqState(o)
        loaded = true
    }
}
