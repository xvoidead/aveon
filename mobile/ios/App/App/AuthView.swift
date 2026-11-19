import SwiftUI

// Вход и регистрация: поля и кнопки те же, что на компьютере, но нативные.
struct AuthView: View {
    @ObservedObject var engine = Engine.shared
    @State private var auth = AuthState()
    @State private var login = ""
    @State private var password = ""
    @State private var password2 = ""
    @State private var code = ""
    @State private var loaded = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(auth.title.isEmpty ? "Вход" : auth.title)
                        .font(T.title1)
                        .foregroundColor(.white)
                    if !auth.sub.isEmpty {
                        Text(auth.sub)
                            .font(T.subhead)
                            .foregroundColor(.white.opacity(0.6))
                    }
                }

                if auth.showLogin {
                    field("Логин", text: $login, secure: false)
                }
                if auth.showPass {
                    field("Пароль", text: $password, secure: true)
                }
                if auth.showPass2 {
                    field("Пароль ещё раз", text: $password2, secure: true)
                }
                if auth.code {
                    codeField
                }

                if !auth.error.isEmpty {
                    Text(auth.error)
                        .font(T.footnote)
                        .foregroundColor(Pal.apple.danger)
                }

                HStack(spacing: 10) {
                    if auth.showGo {
                        Button {
                            submit()
                        } label: {
                            HStack(spacing: 8) {
                                if auth.busy { ProgressView().controlSize(.small).tint(.black) }
                                Text(auth.go.isEmpty ? "Готово" : auth.go)
                                    .font(T.subheadM)
                            }
                            .foregroundColor(.black)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                            .background(Capsule().fill(Color.white))
                        }
                        .buttonStyle(.plain)
                        .disabled(auth.busy)
                    }
                }

                HStack {
                    if auth.showForgot {
                        Button {
                            engine.send("authForgot")
                            Task { await load(force: true) }
                        } label: {
                            Text("забыл пароль").font(T.footnote).foregroundColor(Pal.apple.accent)
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                    Button {
                        engine.send("authSwitch")
                        Task { await load(force: true) }
                    } label: {
                        Text(auth.other.isEmpty ? "другой вход" : auth.other)
                            .font(T.footnote)
                            .foregroundColor(.white.opacity(0.6))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 30)
        }
        .task { await load() }
    }

    private func field(_ title: String, text: Binding<String>, secure: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(T.footnoteM)
                .foregroundColor(.white.opacity(0.6))
            if secure {
                SecureField("", text: text)
                    .font(T.body)
                    .foregroundColor(.white)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 13).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.1)))
            } else {
                TextField("", text: text)
                    .font(T.body)
                    .foregroundColor(.white)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 13).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.1)))
            }
        }
    }

    private var codeField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Код из письма")
                .font(T.footnoteM)
                .foregroundColor(.white.opacity(0.6))
            HStack(spacing: 8) {
                ForEach(0..<6, id: \.self) { i in
                    Text(codeChar(i))
                        .font(T.title3)
                        .foregroundColor(.white)
                        .frame(width: 38, height: 46)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(0.1)))
                }
            }
            TextField("Код", text: $code)
                .font(T.body)
                .foregroundColor(.white)
                .keyboardType(.numberPad)
                .textFieldStyle(.plain)
                .opacity(0.001)
                .frame(height: 1)
                .onChange(of: code) { value in
                    let digits = String(value.filter { $0.isNumber }.prefix(6))
                    if digits != code { code = digits }
                    engine.send("authCode", [digits])
                }
        }
    }

    /// Одна ячейка кода из шести цифр.
    private func codeChar(_ i: Int) -> String {
        let chars = Array(code)
        return i < chars.count ? String(chars[i]) : ""
    }

    private func submit() {
        engine.send("authSubmit", ["", login, password, password2])
        Task { await load(force: true) }
    }

    private func load(force: Bool = false) async {
        if loaded && !force { return }
        guard let o = await engine.obj("authData") else { return }
        let a = AuthState(o)
        auth = a
        if login.isEmpty { login = a.login }
        loaded = true
    }
}
