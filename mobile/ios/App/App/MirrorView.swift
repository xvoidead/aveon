import SwiftUI

// «Зеркало» панели движка: дерево из заголовков, текста, кнопок и полей.
// Рисуем его нативными элементами SwiftUI — так панель настроек на телефоне выглядит
// как обычный список iOS, а работает всё то же, что на компьютере.
struct MirrorView: View {
    @ObservedObject var engine = Engine.shared
    let node: MNode

    var body: some View {
        switch node.t {
        case "h":
            Text(node.s)
                .font(node.o.int("lvl") <= 2 ? T.title3 : T.headline)
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, node.o.int("lvl") <= 2 ? 10 : 4)
        case "p":
            Text(node.s)
                .font(T.subhead)
                .foregroundColor(.white.opacity(0.75))
                .frame(maxWidth: .infinity, alignment: .leading)
        case "text":
            Text(node.s)
                .font(T.subhead)
                .foregroundColor(.white.opacity(node.has("b") ? 1 : 0.75))
                .frame(maxWidth: .infinity, alignment: .leading)
        case "img":
            RemoteImage(url: node.o.str("src"), corner: 10)
                .frame(maxHeight: 220)
                .frame(maxWidth: .infinity)
                .clipped()
        case "btn":
            button
        case "switch":
            toggle
        case "range":
            slider
        case "input":
            input
        case "select":
            select
        case "seg":
            segment
        case "field":
            VStack(alignment: .leading, spacing: 8) {
                if !node.o.str("label").isEmpty {
                    Text(node.o.str("label"))
                        .font(T.footnoteM)
                        .foregroundColor(.white.opacity(0.6))
                }
                ForEach(Array(node.kids.enumerated()), id: \.offset) { _, kid in
                    MirrorView(node: kid)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 2)
        case "nav", "list", "box", "form":
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(node.kids.enumerated()), id: \.offset) { _, kid in
                    MirrorView(node: kid)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(node.kids.enumerated()), id: \.offset) { _, kid in
                    MirrorView(node: kid)
                }
            }
        }
    }

    private var button: some View {
        Button {
            engine.send("tap", [node.id])
        } label: {
            HStack(spacing: 8) {
                if !node.o.str("icon").isEmpty {
                    Image(systemName: node.o.str("icon"))
                        .font(.system(size: 13, weight: .semibold))
                }
                Text(node.s)
                    .font(T.subhead)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 4)
                if !node.o.str("count").isEmpty {
                    Text(node.o.str("count")).font(T.footnote).opacity(0.6)
                }
            }
            .foregroundColor(node.has("danger") ? Pal.apple.danger : (node.has("primary") ? .black : .white))
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(node.has("primary") ? Color.white : Color.white.opacity(0.1))
            )
        }
        .buttonStyle(.plain)
        .opacity(node.o.flag("disabled") ? 0.4 : 1)
        .disabled(node.o.flag("disabled"))
    }

    private var toggle: some View {
        Toggle(isOn: Binding(
            get: { node.o.flag("on") },
            set: { engine.send("setVal", [node.id, $0]) }
        )) {
            Text(node.o.str("label"))
                .font(T.subhead)
                .foregroundColor(.white)
        }
        .tint(Pal.apple.accent)
        .disabled(node.o.flag("disabled"))
    }

    private var slider: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(node.o.str("label"))
                    .font(T.subhead)
                    .foregroundColor(.white)
                Spacer()
                Text(node.o.str("val"))
                    .font(T.footnote)
                    .foregroundColor(.white.opacity(0.6))
                    .monospacedDigit()
            }
            Slider(
                value: Binding(
                    get: { node.o.num("v") },
                    set: { engine.send("setVal", [node.id, $0, false]) }
                ),
                in: node.o.num("min")...max(node.o.num("max", 100), node.o.num("min") + 0.001)
            )
            .tint(Pal.apple.accent)
            .onEditingChanged { editing in
                if !editing { engine.send("setVal", [node.id, node.o.num("v"), true]) }
            }
        }
    }

    private var input: some View {
        TextField(node.o.str("ph").isEmpty ? node.o.str("label") : node.o.str("ph"),
                  text: Binding(
                    get: { node.o.str("v") },
                    set: { engine.send("setVal", [node.id, $0, false]) }
                  ))
            .font(T.body)
            .foregroundColor(.white)
            .textFieldStyle(.plain)
            .padding(.horizontal, 13).padding(.vertical, 11)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.1)))
            .onSubmit { engine.send("setVal", [node.id, node.o.str("v"), true]) }
    }

    private var select: some View {
        Menu {
            ForEach(node.o.arr("opts").enumerated(), id: \.offset) { _, opt in
                Button(opt.str("s")) { engine.send("setVal", [node.id, opt.str("v")]) }
            }
        } label: {
            HStack {
                Text(node.o.str("label"))
                    .font(T.subhead)
                    .foregroundColor(.white)
                Spacer()
                Text(currentOption)
                    .font(T.subhead)
                    .foregroundColor(.white.opacity(0.6))
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.white.opacity(0.4))
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.08)))
        }
    }

    private var currentOption: String {
        let v = node.o.str("v")
        return node.o.arr("opts").first { $0.str("v") == v }?.str("s") ?? v
    }

    private var segment: some View {
        HStack(spacing: 6) {
            ForEach(Array(node.kids.enumerated()), id: \.offset) { _, kid in
                Button {
                    engine.send("tap", [kid.id])
                } label: {
                    Text(kid.s)
                        .font(T.footnoteM)
                        .foregroundColor(kid.o.flag("on") ? .black : .white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(kid.o.flag("on") ? Color.white : Color.white.opacity(0.1))
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Панель движка (настройки, «слушать вместе», теги трека…) — как шторка в iOS.
struct PanelSheet: View {
    @ObservedObject var engine = Engine.shared
    let panel: PanelState

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(panel.kids.enumerated()), id: \.offset) { _, kid in
                        MirrorView(node: kid)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)
                .padding(.bottom, 40)
            }
            .background(Pal.apple.bg)
            .navigationTitle(panel.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if panel.closable {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Button {
                            engine.send("panelClose", [panel.key])
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.white.opacity(0.5))
                        }
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}
