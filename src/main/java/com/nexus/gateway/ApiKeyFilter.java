    package com.nexus.gateway;

    import jakarta.servlet.FilterChain;
    import jakarta.servlet.ServletException;
    import jakarta.servlet.http.HttpServletRequest;
    import jakarta.servlet.http.HttpServletResponse;
    import org.springframework.beans.factory.annotation.Value;
    import org.springframework.stereotype.Component;
    import org.springframework.web.filter.OncePerRequestFilter;
    import java.io.IOException;

    @Component
    public class ApiKeyFilter extends OncePerRequestFilter {

        @Value("${API_KEY}")
        private String apiKey;

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
                throws ServletException, IOException {
            
            String requestKey = request.getHeader("x-api-key");

            if (apiKey.equals(requestKey)) {
                filterChain.doFilter(request, response);
            } else {
                response.setStatus(401);
                response.setContentType("application/json");
                response.getWriter().write("{\"error\": \"API Key tidak valid atau tidak ada\"}");
            }
        }
    }
