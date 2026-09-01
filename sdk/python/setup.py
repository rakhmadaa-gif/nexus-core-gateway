from setuptools import setup, find_packages

setup(
    name="nexus-gateway-sdk",
    version="1.0.0",
    description="Python SDK for Nexus Gateway — M2M Legal-Code Services for Web3",
    long_description=(
        "Nexus Gateway SDK provides native tool wrappers for CrewAI and LangChain. "
        "Generate bilingual (EN/ID) legal contracts, audited Solidity smart contracts, "
        "and Digital Twin v3.1 mapping. Free Solidity security checker included."
    ),
    long_description_content_type="text/plain",
    author="Nexus.Legal.ContractDrafter",
    license="MIT",
    packages=find_packages(),
    python_requires=">=3.8",
    install_requires=[
        # No hard dependencies — uses stdlib urllib
        # Optional: pip install crewai for CrewAI tools
        # Optional: pip install langchain for LangChain tools
    ],
    extras_require={
        "crewai": ["crewai>=0.30.0"],
        "langchain": ["langchain>=0.1.0"],
        "all": ["crewai>=0.30.0", "langchain>=0.1.0"],
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Topic :: Internet :: WWW/HTTP :: HTTP Servers",
        "Topic :: Security :: Cryptography",
        "Framework :: AsyncIO",
    ],
    url="https://github.com/rakhmadaa-gif/nexus-core-gateway",
    project_urls={
        "Documentation": "https://github.com/rakhmadaa-gif/nexus-core-gateway#readme",
        "Source": "https://github.com/rakhmadaa-gif/nexus-core-gateway",
        "Tracker": "https://github.com/rakhmadaa-gif/nexus-core-gateway/issues",
    },
)
