package com.habitgarden.config;

import com.habitgarden.user.CustomOAuth2UserService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.util.matcher.AntPathRequestMatcher;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final CustomOAuth2UserService oAuth2UserService;

    public SecurityConfig(CustomOAuth2UserService oAuth2UserService) {
        this.oAuth2UserService = oAuth2UserService;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                // Public: the app shell, static assets, login endpoints, and /api/me
                .requestMatchers(
                        "/", "/index.html", "/style.css", "/app.js", "/favicon.ico",
                        // PWA assets — the browser fetches these while logged out,
                        // so a 401 here silently kills the install prompt.
                        "/manifest.json", "/sw.js", "/icons/**",
                        "/error", "/login/**", "/oauth2/**", "/api/me"
                ).permitAll()
                // Everything else (the real API) needs a logged-in session
                .anyRequest().authenticated()
            )
            .oauth2Login(oauth -> oauth
                .userInfoEndpoint(info -> info.userService(oAuth2UserService))
                .defaultSuccessUrl("/", true)
            )
            .logout(logout -> logout
                .logoutSuccessUrl("/")
                .permitAll()
            )
            // Return 401 for unauthenticated /api/** calls instead of redirecting
            // to Google (which would break fetch()).
            .exceptionHandling(ex -> ex.defaultAuthenticationEntryPointFor(
                    new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED),
                    new AntPathRequestMatcher("/api/**")
            ))
            // Simple session-cookie app for a single origin: CSRF is disabled to keep
            // the JSON API easy to call. See README if you later add other clients.
            .csrf(csrf -> csrf.disable());

        return http.build();
    }
}
